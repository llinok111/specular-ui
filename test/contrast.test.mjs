/**
 * Contrast tests — the token layer is a promise, so it gets asserted.
 *
 * Glass is the hard case for text: the visible background is "page + tint", and
 * a muted label that looks fine on one ambience fails on another. These tests
 * compute WCAG ratios directly from tokens.css, so changing a hex to taste
 * breaks the build instead of shipping unreadable captions.
 *
 *   node --test test/contrast.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const raw = await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

const AA = 4.5;

function vars(selector) {
  const start = css.indexOf(selector);
  assert.ok(start >= 0, `missing block ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out = {};
  for (const line of css.slice(open + 1, close).split(";")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const rgb = (h) => {
  const v = h.trim().replace("#", "");
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
};

const lum = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

const contrast = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};

const blend = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const AMBIENCES = ["dusk", "studio", "neon", "paper"];
const PAGES = ["--sp-page-1", "--sp-page-2", "--sp-page-3"];
const INKS = ["--sp-ink-1", "--sp-ink-2", "--sp-ink-3"];

// The visible background of a glass surface is the page tinted by the
// ambience. 0.4 is the effective alpha of tint + sheen for the default
// materials; it is deliberately pessimistic, not the prettiest number.
const TINT_ALPHA = 0.4;

for (const name of AMBIENCES) {
  test(`${name}: every ink token clears AA on every page step and on glass`, () => {
    const v = vars(`[data-sp-ambience="${name}"]`);
    const tint = rgb(v["--sp-ambient-tint"]);
    const failures = [];
    for (const page of PAGES) {
      const bg = rgb(v[page]);
      const glass = blend(tint, bg, TINT_ALPHA);
      for (const ink of INKS) {
        const fg = rgb(v[ink]);
        const onPage = contrast(fg, bg);
        const onGlass = contrast(fg, glass);
        const min = Math.min(onPage, onGlass);
        if (min < AA) {
          failures.push(`${ink} on ${page} = ${min.toFixed(2)}:1`);
        }
      }
    }
    assert.deepEqual(failures, [], failures.join("\n"));
  });
}

test("ink levels stay ordered: 1 is strongest, 3 is quietest", () => {
  for (const name of AMBIENCES) {
    const v = vars(`[data-sp-ambience="${name}"]`);
    const isLight = name === "paper";
    const l1 = lum(rgb(v["--sp-ink-1"]));
    const l2 = lum(rgb(v["--sp-ink-2"]));
    const l3 = lum(rgb(v["--sp-ink-3"]));
    if (isLight) {
      // On a light page the hierarchy runs dark → light.
      assert.ok(l1 < l2, `${name}: ink-1 must be darker than ink-2`);
      assert.ok(l2 < l3, `${name}: ink-2 must be darker than ink-3`);
    } else {
      assert.ok(l1 > l2, `${name}: ink-1 must be lighter than ink-2`);
      assert.ok(l2 > l3, `${name}: ink-2 must be lighter than ink-3`);
    }
  }
});

test("ink-2 and ink-3 stay visually separable", () => {
  for (const name of AMBIENCES) {
    const v = vars(`[data-sp-ambience="${name}"]`);
    const d = Math.abs(lum(rgb(v["--sp-ink-2"])) - lum(rgb(v["--sp-ink-3"])));
    assert.ok(d > 0.02, `${name}: ink-2 and ink-3 collapsed into one level (Δ${d.toFixed(3)})`);
  }
});

test("accent ink is readable on the accent fill", () => {
  for (const name of AMBIENCES) {
    const v = vars(`[data-sp-ambience="${name}"]`);
    const ratio = contrast(rgb(v["--sp-ambient-accent-ink"]), rgb(v["--sp-ambient-accent"]));
    // Primary buttons use this pair at 13–17px semibold; AA large is 3:1, and
    // we hold to that because the fill is saturated, not a text surface.
    assert.ok(ratio >= 3, `${name}: accent ink ${ratio.toFixed(2)}:1 on accent fill`);
  }
});
