/**
 * Unit tests — deterministic, no browser, no DOM.
 *
 * The rule here: anything that can be a pure function is a pure function, so it
 * gets tested directly. Canvas encoding, ResizeObserver and pointer plumbing
 * are covered by test/browser.test.mjs instead.
 *
 *   node --test test/unit.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeDisplacementField,
  makeDoubleLensFragment,
  makeGrazingFragment,
  makeBoxLens,
  makeLensFragment,
  neutralFragment,
  neutralRatio,
  roundedRectSDF,
  smoothStep,
} from "../src/core/sdf.js";
import { fieldSize, quantise } from "../src/core/displacement.js";
import { TIER, FrameGovernor, explain, resolveTier } from "../src/core/capability.js";
import { MATERIAL_IDS, isMaterial, resolveMaterial } from "../src/core/materials.js";

// ------------------------------------------------------------------ maths ---

test("smoothStep is clamped and monotonic in both directions", () => {
  assert.equal(smoothStep(0, 1, -5), 0);
  assert.equal(smoothStep(0, 1, 5), 1);
  assert.equal(smoothStep(0, 1, 0), 0);
  assert.equal(smoothStep(0, 1, 1), 1);
  assert.equal(smoothStep(0, 1, 0.5), 0.5);
  // Reversed edges invert the ramp, which is how the lens drives its bend.
  assert.equal(smoothStep(1, 0, 0), 1);
  assert.equal(smoothStep(1, 0, 1), 0);
  assert.ok(smoothStep(0, 1, 0.25) < smoothStep(0, 1, 0.75));
});

test("roundedRectSDF is negative inside, positive outside, zero on the edge", () => {
  // A plain box: half-extents 0.3 / 0.2, no radius.
  assert.ok(roundedRectSDF(0, 0, 0.3, 0.2, 0) < 0, "centre is inside");
  assert.ok(roundedRectSDF(0, 0.19, 0.3, 0.2, 0) < 0, "near top edge is inside");
  assert.ok(roundedRectSDF(0, 0.21, 0.3, 0.2, 0) > 0, "beyond top edge is outside");
  assert.ok(roundedRectSDF(0.4, 0, 0.3, 0.2, 0) > 0, "beyond right edge is outside");
  // A corner cut by a radius must read as outside even though both axes are
  // within their extents.
  const corner = roundedRectSDF(0.29, 0.19, 0.3, 0.2, 0.12);
  assert.ok(corner > 0, "rounded corner is outside the shape");
});

// -------------------------------------------------------------- fragments ---

test("lens fragment is exactly neutral in the flat centre", () => {
  const f = makeLensFragment();
  const centre = f({ x: 0.5, y: 0.5 });
  assert.equal(centre.skip, true);
  assert.equal(centre.x, 0.5);
  assert.equal(centre.y, 0.5);

  // A point just inside the plate edge must bend.
  const rim = f({ x: 0.02, y: 0.02 });
  assert.ok(!rim.skip, "rim is not neutral");
  assert.notEqual(rim.x, 0.02);
});

test("lens fragment points are pulled toward the focus", () => {
  const f = makeLensFragment();
  const p = f({ x: 0.95, y: 0.5 });
  assert.ok(!p.skip);
  assert.ok(Math.abs(p.x - 0.5) < Math.abs(0.95 - 0.5), "sample moves toward centre");
});

test("double lens and grazing fragments declare distinct profiles", () => {
  const d = makeDoubleLensFragment();
  const g = makeGrazingFragment();
  assert.equal(d.profile, "double-lens");
  assert.equal(g.profile, "grazing");
  // Grazing is directional: opposite corners must not resolve identically.
  const a = g({ x: 0.02, y: 0.5 });
  const b = g({ x: 0.98, y: 0.5 });
  assert.notDeepEqual([a.x, a.y], [b.x, b.y]);
});

// ----------------------------------------------------------- field builder ---

test("field has the requested shape and full alpha", () => {
  const field = computeDisplacementField(64, 32, makeLensFragment());
  assert.equal(field.width, 64);
  assert.equal(field.height, 32);
  assert.equal(field.data.length, 64 * 32 * 4);
  for (let i = 3; i < field.data.length; i += 4) {
    assert.equal(field.data[i], 255, "alpha must stay opaque");
  }
});

test("neutral pixels encode a zero displacement", () => {
  const field = computeDisplacementField(32, 32, neutralFragment);
  assert.equal(field.skipped, 32 * 32);
  for (let i = 0; i < field.data.length; i += 4) {
    assert.equal(field.data[i], 128);
    assert.equal(field.data[i + 1], 128);
  }
});

test("G and B carry the same vertical displacement, R carries horizontal", () => {
  const field = computeDisplacementField(48, 48, makeLensFragment());
  let checked = 0;
  for (let i = 0; i < field.data.length; i += 4) {
    assert.equal(field.data[i + 1], field.data[i + 2], "G and B must match");
    checked++;
  }
  assert.ok(checked > 0);
});

test("the centre of a lens field is flat, the rim is not", () => {
  const w = 80;
  const h = 80;
  const field = computeDisplacementField(w, h, makeLensFragment());
  const at = (x, y) => field.data[(y * w + x) * 4];
  assert.equal(at(40, 40), 128, "centre is neutral");
  assert.notEqual(at(1, 40), 128, "left rim is displaced");
});

test("edge fade keeps the outermost column from hitting the rail", () => {
  const field = computeDisplacementField(64, 64, makeLensFragment(), { edgeFade: true });
  const first = field.data[0];
  // Column 0 is multiplied by 0, so it must land on the neutral value even
  // though the fragment displaces heavily there.
  assert.equal(first, 128);
});

test("analytic normalisation reports a divisor derived from the box", () => {
  const field = computeDisplacementField(100, 40, makeLensFragment(), { normalize: "analytic" });
  assert.equal(field.maxScale, 50, "half of the longer side");
});

test("an explicit maxShift bypasses scanning entirely", () => {
  const field = computeDisplacementField(120, 60, makeBoxLens({ width: 120, height: 60, band: 18, shift: 12 }), {
    maxShift: 12,
  });
  assert.equal(field.maxScale, 12);
  // The peak inside the rim must reach the top of the range.
  const row = 30;
  const left = field.data[(row * field.width + 1) * 4];
  assert.ok(left < 40 || left > 215, `rim should saturate, got ${left}`);
});

test("auto normalisation finds the observed maximum", () => {
  const analytic = computeDisplacementField(100, 40, makeLensFragment(), { normalize: "analytic" });
  const auto = computeDisplacementField(100, 40, makeLensFragment(), { normalize: "auto" });
  assert.ok(auto.maxScale > 0);
  assert.notEqual(auto.maxScale, analytic.maxScale);
});

test("neutralRatio reports the skipped share", () => {
  const field = computeDisplacementField(50, 50, makeLensFragment());
  const ratio = neutralRatio(field);
  // The default plate has a large corner radius, so the flat region is a
  // rounded diamond rather than a rectangle: ~23% of the box is neutral.
  assert.ok(ratio > 0.15, `expected a flat interior, got ${ratio}`);
  assert.ok(ratio < 1, "the rim must not be neutral");
});

test("a tighter inner threshold widens the neutral region", () => {
  const wide = neutralRatio(computeDisplacementField(60, 60, makeLensFragment({ inner: 0.3 })));
  const tight = neutralRatio(computeDisplacementField(60, 60, makeLensFragment({ inner: 0.02 })));
  assert.ok(wide > tight, `inner=0.3 (${wide}) should skip more than inner=0.02 (${tight})`);
});

test("degenerate sizes are coerced, never crash", () => {
  const field = computeDisplacementField(0, 0, makeLensFragment());
  assert.equal(field.width, 1);
  assert.equal(field.height, 1);
});

// ------------------------------------------------------------- atlas keys ---

test("quantise snaps onto the generation grid", () => {
  assert.equal(quantise(131, 16), 128);
  assert.equal(quantise(136, 16), 144);
  assert.equal(quantise(1, 16), 16, "never below one grid step");
});

test("fieldSize respects the resolution cap and keeps aspect", () => {
  const big = fieldSize(1600, 400, 512);
  assert.equal(Math.max(big.width, big.height), 512);
  assert.ok(Math.abs(big.width / big.height - 4) < 0.1);

  const small = fieldSize(200, 100, 512);
  assert.equal(small.width, 200);
  assert.equal(small.height, 100);

  const tiny = fieldSize(2, 2, 512);
  assert.ok(tiny.width >= 8 && tiny.height >= 8, "never below the sampling floor");
});

// ----------------------------------------------------------- tier decision ---

const baseCaps = {
  backdropFilter: true,
  svgFilter: true,
  displacement: true,
  conic: true,
  colorMix: true,
  deviceMemory: 16,
  cores: 16,
  coarsePointer: false,
  reducedMotion: false,
  reducedTransparency: false,
  reducedData: false,
  saveData: false,
  viewport: { w: 1440, h: 900 },
};

test("a capable desktop gets full fidelity", () => {
  assert.equal(resolveTier(baseCaps), TIER.FULL);
});

test("missing backdrop-filter forces the static tier", () => {
  assert.equal(resolveTier({ ...baseCaps, backdropFilter: false }), TIER.STATIC);
});

test("missing displacement support drops to lite, not static", () => {
  assert.equal(resolveTier({ ...baseCaps, displacement: false }), TIER.LITE);
});

test("reduced transparency is honoured above device class", () => {
  assert.equal(resolveTier({ ...baseCaps, reducedTransparency: true }), TIER.LITE);
});

test("data saver is honoured", () => {
  assert.equal(resolveTier({ ...baseCaps, saveData: true }), TIER.LITE);
});

test("low memory or few cores fall to lite", () => {
  assert.equal(resolveTier({ ...baseCaps, deviceMemory: 2 }), TIER.LITE);
  assert.equal(resolveTier({ ...baseCaps, cores: 2 }), TIER.LITE);
});

test("a small phone lands on balanced", () => {
  assert.equal(
    resolveTier({ ...baseCaps, coarsePointer: true, viewport: { w: 390, h: 844 } }),
    TIER.BALANCED
  );
});

test("a tablet with memory to spare stays on full", () => {
  assert.equal(
    resolveTier({ ...baseCaps, coarsePointer: true, deviceMemory: 8, viewport: { w: 1024, h: 768 } }),
    TIER.FULL
  );
});

test("missing conic-gradient degrades to balanced", () => {
  assert.equal(resolveTier({ ...baseCaps, conic: false }), TIER.BALANCED);
});

test("a null record never throws", () => {
  assert.equal(resolveTier(null), TIER.STATIC);
});

test("explain always returns at least one line", () => {
  assert.ok(explain(baseCaps).length >= 1);
  assert.deepEqual(explain(null), ["no capability record"]);
});

// ------------------------------------------------------------- frame guard ---

test("FrameGovernor exposes start() and does not shadow it with instance state", () => {
  // Regression: an earlier build assigned `this.start = 0` in the constructor,
  // which silently replaced the start method with a number.
  const g = new FrameGovernor({});
  assert.equal(typeof g.start, "function");
  assert.notEqual(typeof g._windowStart, "undefined");
});

test("FrameGovernor does nothing at the lowest tier", () => {
  let called = false;
  const g = new FrameGovernor({ onDowngrade: () => (called = true) });
  g.start(0, () => 0);
  assert.equal(called, false);
  assert.equal(g.raf, null);
});

// -------------------------------------------------------------- materials ---

test("material ids are stable and resolvable", () => {
  assert.deepEqual(MATERIAL_IDS, ["liquid", "metal", "frost", "holo"]);
  for (const id of MATERIAL_IDS) assert.ok(isMaterial(id));
});

test("unknown materials degrade instead of throwing", () => {
  assert.equal(resolveMaterial("ghost-ish"), "liquid");
  assert.equal(resolveMaterial(undefined), "liquid");
  assert.equal(resolveMaterial(null), "liquid");
  assert.equal(isMaterial("nope"), false);
});
