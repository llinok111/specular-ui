/**
 * specular-ui · signed distance field & refraction fragments
 *
 * Derived from `liquid-glass-react` (https://github.com/rdev/liquid-glass-react,
 * MIT, Copyright 2025 MAX ROVENSKY), which in turn adapted
 * https://github.com/shuding/liquid-glass.
 *
 * What changed and why:
 *   - the hard-coded 0.3 / 0.2 / 0.6 / 0.15 constants became a parameterised
 *     fragment factory, so one implementation serves every refraction profile;
 *   - fragments can now declare a neutral region (`skip`), which lets the
 *     generator write a constant pixel there instead of running two smoothsteps.
 *     This is mathematically exact, not an approximation: outside the band the
 *     displacement really is zero.
 *   - the field is computed as a plain typed array in a pure function, with no
 *     canvas and no DOM, so the maths is unit-testable in Node.
 *
 * The numbers live in normalised UV space (0..1 across the element), so a
 * profile looks identical on a 44px pill and a 900px panel.
 */

/** Hermite ramp. Returns 0 at `a`, 1 at `b`, works with `a > b`. */
export function smoothStep(a, b, t) {
  const denom = b - a;
  let x = denom === 0 ? 0 : (t - a) / denom;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}

function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}

/**
 * Rounded-rectangle signed distance, in UV units.
 * Negative inside, positive outside. `halfW`/`halfH` are half-extents, not
 * full sizes — this matches the upstream call site, where the glass spans
 * roughly ±0.3 of the element.
 */
export function roundedRectSDF(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  const outside = hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(Math.max(qx, qy), 0) + outside - radius;
}

/** A fragment that never displaces anything, for measuring busywork in tests. */
export const neutralFragment = (uv) => ({ x: uv.x, y: uv.y, skip: true });

/**
 * Build a lens fragment.
 *
 * @param {object} [opts]
 * @param {number} [opts.halfW=0.30]  half-width of the lens plate, UV units
 * @param {number} [opts.halfH=0.20]  half-height of the lens plate
 * @param {number} [opts.radius=0.60] corner radius of the plate
 * @param {number} [opts.inner=0.15]  distance from the plate edge at which
 *                                    bending starts; small values keep the
 *                                    centre perfectly flat
 * @param {number} [opts.band=0.80]   width of the bend ramp
 * @param {number} [opts.focus=0.50]  UV point the rim pulls toward
 */
export function makeLensFragment({
  halfW = 0.3,
  halfH = 0.2,
  radius = 0.6,
  inner = 0.15,
  band = 0.8,
  focus = 0.5,
} = {}) {
  const fragment = (uv) => {
    const ix = uv.x - 0.5;
    const iy = uv.y - 0.5;
    const d = roundedRectSDF(ix, iy, halfW, halfH, radius);

    // Inside the flat zone the bend is exactly zero, so we can bail out.
    if (d <= inner) return { x: focus, y: focus, skip: true };

    const displacement = smoothStep(band, 0, d - inner);
    const scaled = smoothStep(0, 1, displacement);
    return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 };
  };
  fragment.profile = "lens";
  return fragment;
}

/**
 * A concentric-ring fragment. Instead of one plate it produces two nested
 * bends, which reads as a thicker, more "moulded" glass — closer to a
 * physical lens element than to a sheet.
 */
export function makeDoubleLensFragment({
  halfW = 0.3,
  halfH = 0.2,
  radius = 0.6,
  inner = 0.12,
  band = 0.8,
} = {}) {
  const outer = makeLensFragment({ halfW, halfH, radius, inner, band });
  const innerRing = makeLensFragment({
    halfW: halfW * 0.62,
    halfH: halfH * 0.62,
    radius: radius * 0.62,
    inner: inner * 0.5,
    band: band * 0.55,
  });

  const fragment = (uv) => {
    const a = outer(uv);
    if (a.skip) {
      const b = innerRing(uv);
      if (b.skip) return a;
      return { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
    }
    return a;
  };
  fragment.profile = "double-lens";
  return fragment;
}

/**
 * A directional fragment: displacement magnitude decays along a vector, which
 * makes the glass look like it is being viewed at a grazing angle. Useful for
 * navbars and side panels where a symmetric lens looks artificially centred.
 */
export function makeGrazingFragment({ halfW = 0.34, halfH = 0.22, radius = 0.4, angle = 0 } = {}) {
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const fragment = (uv) => {
    const ix = uv.x - 0.5;
    const iy = uv.y - 0.5;
    const d = roundedRectSDF(ix, iy, halfW, halfH, radius);
    if (d <= 0) return { x: 0.5, y: 0.5, skip: true };
    const ramp = smoothStep(0.42, 0, d);
    const bias = 0.5 + 0.5 * (ix * ax + iy * ay) * 2;
    const scaled = smoothStep(0, 1, ramp * (0.55 + 0.45 * bias));
    return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 };
  };
  fragment.profile = "grazing";
  return fragment;
}

/**
 * Compute a displacement field as RGBA bytes.
 *
 * R = horizontal displacement, G/B = vertical (B is duplicated because
 * `feDisplacementMap` can be told to read either channel and older WebKit only
 * honours B), A = opaque.
 *
 * @param {number} width   field width in pixels
 * @param {number} height  field height in pixels
 * @param {(uv:{x:number,y:number}) => {x:number,y:number,skip?:boolean}} fragment
 * @param {object} [opts]
 * @param {"analytic"|"auto"} [opts.normalize="auto"]
 *        auto:     divisor is the observed maximum — two passes. The lens bend
 *                  is concentrated in a narrow rim, so its real range is a few
 *                  percent of the box; dividing by the geometric bound (w/2)
 *                  would flatten the map to ±3/255 and the filter would have
 *                  nothing to displace. This is the default for that reason.
 *        analytic: divisor is the geometric bound (w/2, h/2) — one pass, kept
 *                  for callers that need a normalisation independent of content
 * @param {number} [opts.maxShift] explicit peak displacement in px. When set,
 *        the field is normalised against it instead of being scanned, which
 *        keeps the map's dynamic range tied to the filter's `scale` attribute.
 * @param {boolean} [opts.edgeFade=true] fade displacement to zero in the
 *        outermost pixels so the filter has no hard seam
 * @returns {{data: Uint8ClampedArray, width: number, height: number, maxScale: number, skipped: number}}
 */
export function computeDisplacementField(width, height, fragment, opts = {}) {
  const { normalize = "auto", edgeFade = true, maxShift = 0 } = opts;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  let skipped = 0;
  let maxScale = 0;

  if (!maxShift && normalize === "auto") {
    // Pass 1 — find the largest displacement so normalisation is data-driven.
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const pos = fragment({ x: x / w, y: v });
        if (pos.skip) continue;
        const dx = Math.abs(pos.x * w - x);
        const dy = Math.abs(pos.y * h - y);
        if (dx > maxScale) maxScale = dx;
        if (dy > maxScale) maxScale = dy;
      }
    }
    if (maxScale < 1) maxScale = 1;
  }

  const scaleX = maxShift || (normalize === "auto" ? maxScale : w * 0.5);
  const scaleY = maxShift || (normalize === "auto" ? maxScale : h * 0.5);

  let i = 0;
  for (let y = 0; y < h; y++) {
    const v = y / h;
    for (let x = 0; x < w; x++) {
      const pos = fragment({ x: x / w, y: v });
      let r = 0.5;
      let g = 0.5;

      if (!pos.skip) {
        let dx = pos.x * w - x;
        let dy = pos.y * h - y;
        if (edgeFade) {
          // Fade over 2px so feImage has no seam against the element border.
          const edge = Math.min(x, y, w - x - 1, h - y - 1);
          const f = edge < 2 ? edge / 2 : 1;
          dx *= f;
          dy *= f;
        }
        r = dx / scaleX + 0.5;
        g = dy / scaleY + 0.5;
      } else {
        skipped++;
      }

      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = g * 255;
      data[i + 3] = 255;
      i += 4;
    }
  }

  return { data, width: w, height: h, maxScale: maxShift || (normalize === "auto" ? maxScale : Math.max(scaleX, scaleY)), skipped };
}

/** Fraction of pixels a fragment declares neutral — used by tests and the perf budget. */
export function neutralRatio(field) {
  const total = field.width * field.height;
  return total === 0 ? 0 : field.skipped / total;
}

/**
 * Box lens, built in PIXEL space.
 *
 * This is the profile the library actually uses, and it exists because the UV
 * profile above cannot work with `backdrop-filter`. Two hard facts drove the
 * redesign, both established by measurement (see test/optical.test.mjs):
 *
 *   1. `backdrop-filter` only samples the backdrop INSIDE the element's border
 *      box. A bend band that sits beyond the visible rim has nothing to bend,
 *      and a UV-shaped plate on a wide element puts exactly that band outside
 *      the left and right edges.
 *
 *   2. Sampling toward the centre compresses the visible content into a band at
 *      the rim and pushes everything outward underneath it. Because the clipped
 *      region stops at the border, the result reads as a smear rather than as
 *      glass — the bar pattern visibly breaks instead of bending.
 *
 * So the band runs from the border INWARD, and it samples OUTWARD. Just inside
 * the rim the backdrop is pulled in from beyond the edge, exactly as a convex
 * glass edge does, and the distortion decays to nothing at `band` inside. The
 * displacement is therefore strongest where a real bezel is thickest, zero in
 * the middle, and entirely inside the region the browser is willing to sample.
 *
 * @param {object} opts
 * @param {number} opts.width   element width in px
 * @param {number} opts.height  element height in px
 * @param {number} [opts.band=24]      width of the bend band, px
 * @param {number} [opts.radius=0]     corner radius, px
 * @param {number} [opts.shift=18]  peak displacement in px, outward at the rim
 */
export function makeBoxLens({ width, height, band = 24, radius = 0, shift = 18 } = {}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.max(0, Math.min(radius, Math.min(hw, hh)));
  const bandPx = Math.max(2, Math.min(band, Math.min(hw, hh)));
  const peak = Math.max(0, shift);

  const fragment = (uv) => {
    const px = (uv.x - 0.5) * w;
    const py = (uv.y - 0.5) * h;
    // SDF of the element's own box: negative inside, zero on the border.
    const d = roundedRectSDF(px, py, hw, hh, r);
    const inside = -d; // 0 at the border, grows toward the centre
    if (inside >= bandPx) return { x: 0.5, y: 0.5, skip: true };

    const t = Math.max(0, Math.min(1, inside / bandPx));
    // t = 0 at the border, 1 at the inner edge of the band. Inverted smoothstep:
    // the bend is maximal at the rim and eases to zero inward.
    const eased = 1 - t;
    const bulge = eased * eased * (3 - 2 * eased);
    const dx = (px < 0 ? -1 : 1) * bulge * peak;
    const dy = (py < 0 ? -1 : 1) * bulge * peak;
    return { x: (px + dx) / w + 0.5, y: (py + dy) / h + 0.5, shift: peak };
  };
  fragment.profile = "box-lens";
  return fragment;
}
