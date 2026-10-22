/**
 * specular-ui · refraction atlas
 *
 * Turns a lens profile + element size into a reusable SVG `filter: url(#…)`.
 *
 * Three things make this affordable, none of which the upstream implementation
 * did:
 *
 *   1. SIZE QUANTISATION. Fields are generated on a 16px grid, so a 300×48
 *      button and a 296×44 button share one displacement map. Element sizes are
 *      effectively continuous; the maps are not.
 *
 *   2. RESOLUTION CAP. A displacement map is a low-frequency signal. Rendering
 *      it at `maxSide` and letting `feImage` scale it costs a fraction of a
 *      full-size field and is visually indistinguishable.
 *
 *   3. FILTER SHARING. The identity of a filter is (profile, quantised size,
 *      scale, aberration). Twenty buttons of the same size produce one filter,
 *      one PNG, one cache entry.
 *
 * Everything is refcounted through an LRU so a long-lived page cannot grow the
 * SVG defs without bound.
 */

import { computeDisplacementField, makeBoxLens } from "./sdf.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Quantise a length onto the generation grid so near-identical sizes share. */
export function quantise(value, grid = 16) {
  return Math.max(grid, Math.round(value / grid) * grid);
}

/**
 * Resolve a field size that keeps the element's aspect ratio but respects the
 * texture budget. Returns integers, never below 8px on the short side.
 */
export function fieldSize(width, height, maxSide = 512) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const longest = Math.max(w, h);
  const k = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(8, Math.round(w * k)),
    height: Math.max(8, Math.round(h * k)),
  };
}

/**
 * Filter region geometry.
 *
 * The region is grown by 25% on every side so the displacement has pixels to
 * pull in from outside the element. That growth is the reason `feImage` cannot
 * use `width="100%"`: those percentages resolve against the FILTER REGION, not
 * the element, so `100%` would stretch the map to 1.5× the surface and offset
 * it by a quarter width. The map must instead be placed at the element's rect
 * inside the region, expressed as a fraction of the region.
 */
// `feImage` geometry resolves against the element's user space, not the filter
// region, so the map is simply pinned to the full border box. (An earlier build
// divided by the region span, which shrank the map to 2/3 and shifted it by a
// quarter width — the lens then read as "no effect at all".)
const MAP_POS = "0%";
const MAP_SIZE = "100%";

function buildFilterMarkup(id, { url, scale }) {
  return (
    `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" ` +
    `color-interpolation-filters="sRGB">` +
    `<feImage href="${url}" x="${MAP_POS}" y="${MAP_POS}" ` +
    `width="${MAP_SIZE}" height="${MAP_SIZE}" ` +
    `preserveAspectRatio="none" result="SP_MAP"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="SP_MAP" ` +
    `scale="${Number(scale).toFixed(2)}" ` +
    `xChannelSelector="R" yChannelSelector="B"/>` +
    `</filter>`
  );
}

export class RefractionAtlas {
  /**
   * @param {object} [opts]
   * @param {number} [opts.grid=16]        quantisation grid in CSS px
   * @param {number} [opts.maxSide=512]    resolution cap of a generated field
   * @param {number} [opts.capacity=24]    max live filters
     */
  constructor({ grid = 16, maxSide = 512, capacity = 24 } = {}) {
    this.grid = grid;
    this.maxSide = maxSide;
    this.capacity = capacity;
    this.entries = new Map(); // key -> { id, hits, el }
    this.seq = 0;
    this.misses = 0;
    this.hits = 0;
    this.root = null;
    this.disabled = typeof document === "undefined";
  }

  get stats() {
    return {
      live: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      capacity: this.capacity,
    };
  }

  /** Lazily create the single <svg> that holds every filter definition. */
  _ensureRoot() {
    if (this.root && this.root.isConnected) return this.root;
    if (typeof document === "undefined") return null;
    let root = document.getElementById("sp-filter-defs");
    if (!root) {
      root = document.createElementNS(SVG_NS, "svg");
      root.setAttribute("id", "sp-filter-defs");
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("focusable", "false");
      root.style.cssText =
        "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
      (document.body || document.documentElement).appendChild(root);
    }
    this.root = root;
    return root;
  }

  /**
   * Get (or build) a filter for a surface.
   *
   * @param {object} req
   * @param {number} req.width              element width in CSS px
   * @param {number} req.height             element height in CSS px
   * @param {object|string} [req.profile]   fragment factory name or instance
   * @param {number} [req.scale=58]         displacement scale in px
   * @param {number} [req.aberration=0.3]   reserved for the CSS fringe; part of
   *        the cache key so a per-surface fringe never reuses a stale filter
   * @returns {string|null} a CSS `url(#id)` value, or null when unavailable
   */
  filterFor(req) {
    if (this.disabled || typeof document === "undefined") return null;

    const { width, height, scale = 58, aberration = 0.3 } = req;
    if (!(width > 0) || !(height > 0)) return null;
    if (scale <= 0) return null;

    const qw = quantise(width, this.grid);
    const qh = quantise(height, this.grid);
    // Scale is quantised too: sub-pixel differences are invisible.
    const qs = Math.round(scale / 4) * 4;
    const qa = Math.round(aberration * 8) / 8;
    const fragment = resolveFragment(req.profile, { width: qw, height: qh, scale: qs });
    const key = `${fragment.profile}|${qw}x${qh}|${qs}|${qa}`;

    const hit = this.entries.get(key);
    if (hit) {
      this.hits++;
      // Refresh LRU position.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return `url(#${hit.id})`;
    }

    const root = this._ensureRoot();
    if (!root) return null;

    this.misses++;
    const size = fieldSize(qw, qh, this.maxSide);
    const field = computeDisplacementField(size.width, size.height, fragment);

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const image = ctx.createImageData(size.width, size.height);
    image.data.set(field.data);
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL("image/png");

    const id = `sp-f${++this.seq}`;
    const host = document.createElementNS(SVG_NS, "g");
    host.innerHTML = buildFilterMarkup(id, { url, scale: qs });
    while (host.firstChild) root.appendChild(host.firstChild);

    this.entries.set(key, { id, hits: 0, size: `${qw}x${qh}` });
    this._evict();
    return `url(#${id})`;
  }

  _evict() {
    while (this.entries.size > this.capacity) {
      const [oldestKey, entry] = this.entries.entries().next().value;
      this.entries.delete(oldestKey);
      if (typeof document !== "undefined") {
        const el = document.getElementById(entry.id);
        if (el) el.remove();
      }
    }
  }

  /** Drop every cached filter. Call when the theme changes the lens profile. */
  clear() {
    this.entries.clear();
    if (this.root) this.root.replaceChildren();
    this.hits = 0;
    this.misses = 0;
  }
}

/**
 * Build the lens for a specific surface.
 *
 * Profiles are no longer shared by name: the bend band is a pixel measurement,
 * so a 44px pill and a 900px panel need different fragments. The atlas key
 * already includes the quantised size, so this is built once per cached size.
 *
 * `band` scales with the shorter side — a small control needs a tight rim, a
 * large panel can carry a wide one — and is clamped so it never eats the whole
 * surface or collapses to a hairline.
 */
function resolveFragment(profile, { width, height, scale }) {
  const name = typeof profile === "string" ? profile : "lens";
  const short = Math.min(width, height);
  const ratio = { lens: 0.3, "lens-soft": 0.44, "lens-tight": 0.18, "lens-deep": 0.38 }[name] ?? 0.3;
  const band = Math.max(10, Math.min(64, short * ratio));
  const radius = name === "lens-tight" ? short * 0.5 : short * 0.22;
  return makeBoxLens({ width, height, band, radius, strength: Math.min(1, scale / 48) });
}

export const defaultAtlas = new RefractionAtlas();
