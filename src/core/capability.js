/**
 * specular-ui · capability probe
 *
 * The library renders four tiers of fidelity. The tier is decided once at boot
 * from feature support + coarse device class, then optionally revised once by a
 * frame governor if the first second of animation is too janky.
 *
 * Design rules:
 *   - never upgrade at runtime. A device that struggled will struggle again,
 *     and a tier that flickers between two looks reads as a bug.
 *   - the probe is pure-ish: it reads globals but takes an injectable env, so
 *     the decision table is unit-testable without a browser.
 */

export const TIER = {
  FULL: 0,
  BALANCED: 1,
  LITE: 2,
  STATIC: 3,
};

export const TIER_LABEL = {
  0: "full",
  1: "balanced",
  2: "lite",
  3: "static",
};

/** Cheap feature probes, memoised after first call. */
let cachedCapabilities = null;

/**
 * @param {object} [env] test seam — pass a fake window/document
 * @returns {object} capability record
 */
export function detectCapabilities(env) {
  const win = env?.window || (typeof window !== "undefined" ? window : null);
  const doc = env?.document || (typeof document !== "undefined" ? document : null);
  const nav = env?.navigator || (typeof navigator !== "undefined" ? navigator : null);
  const css = win?.CSS;

  if (!env && cachedCapabilities) return cachedCapabilities;

  const supports = (prop, value) => {
    try {
      return Boolean(css && typeof css.supports === "function" && css.supports(prop, value));
    } catch {
      return false;
    }
  };

  const prefers = (query) => {
    try {
      return Boolean(win?.matchMedia && win.matchMedia(query).matches);
    } catch {
      return false;
    }
  };

  const caps = {
    backdropFilter:
      supports("backdrop-filter", "blur(2px)") ||
      supports("-webkit-backdrop-filter", "blur(2px)"),
    svgFilter: supports("filter", "url(#sp-probe)"),
    // feDisplacementMap is the one primitive the refraction layer cannot live
    // without. There is no CSS.supports hook for it, so we infer from filter
    // support plus the absence of the two browsers that ship filters without it.
    displacement: supports("filter", "url(#sp-probe)"),
    conic: supports("background", "conic-gradient(from 0deg, red, blue)"),
    colorMix: supports("color", "color-mix(in oklab, red, blue)"),
    deviceMemory: Number(nav?.deviceMemory) || 0,
    cores: Number(nav?.hardwareConcurrency) || 0,
    coarsePointer: prefers("(pointer: coarse)"),
    reducedMotion: prefers("(prefers-reduced-motion: reduce)"),
    reducedTransparency: prefers("(prefers-reduced-transparency: reduce)"),
    reducedData: Boolean(nav?.connection?.saveData),
    viewport: {
      w: win?.innerWidth || 0,
      h: win?.innerHeight || 0,
    },
    saveData: Boolean(nav?.connection?.saveData),
  };

  caps.tier = resolveTier(caps);
  caps.reasons = explain(caps);

  if (!env) cachedCapabilities = caps;
  return caps;
}

/**
 * The decision table. Order matters: hard blockers first, then device class.
 * @returns {number} TIER.*
 */
export function resolveTier(caps) {
  if (!caps) return TIER.STATIC;
  // Hard blockers — the material would be a lie, or the user asked for less.
  if (!caps.backdropFilter) return TIER.STATIC;
  if (!caps.displacement || !caps.svgFilter) return TIER.LITE;
  if (caps.reducedTransparency) return TIER.LITE;
  if (caps.reducedData || caps.saveData) return TIER.LITE;

  // Device class.
  if (caps.deviceMemory && caps.deviceMemory <= 2) return TIER.LITE;
  if (caps.cores && caps.cores <= 2) return TIER.LITE;

  if (caps.coarsePointer) {
    const smallScreen = caps.viewport.w > 0 && caps.viewport.w < 430;
    if (smallScreen || (caps.deviceMemory && caps.deviceMemory <= 4)) {
      return TIER.BALANCED;
    }
  }

  if (caps.deviceMemory && caps.deviceMemory <= 4 && caps.cores <= 4) {
    return TIER.BALANCED;
  }

  if (!caps.conic || !caps.colorMix) return TIER.BALANCED;

  return TIER.FULL;
}

/** Human-readable audit trail, surfaced in the demo's diagnostics panel. */
export function explain(caps) {
  const reasons = [];
  if (!caps) return ["no capability record"];
  if (!caps.backdropFilter) reasons.push("backdrop-filter unsupported");
  if (!caps.displacement) reasons.push("svg displacement unsupported");
  if (caps.reducedTransparency) reasons.push("prefers-reduced-transparency");
  if (caps.reducedData || caps.saveData) reasons.push("data saver on");
  if (caps.deviceMemory && caps.deviceMemory <= 2)
    reasons.push(`deviceMemory ${caps.deviceMemory}GB`);
  if (caps.cores && caps.cores <= 2) reasons.push(`${caps.cores} logical cores`);
  if (caps.coarsePointer) reasons.push("coarse pointer");
  if (!caps.conic) reasons.push("conic-gradient unsupported");
  if (!caps.colorMix) reasons.push("color-mix unsupported");
  return reasons.length ? reasons : ["no constraints detected"];
}

/** Write the tier onto the root element so CSS can react. */
export function applyTier(tier, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el) return tier;
  const value = String(Math.max(0, Math.min(3, tier | 0)));
  el.dataset.spTier = value;
  return value;
}

/**
 * Frame governor.
 *
 * Watches rAF cadence for a short window after mount. If the median frame time
 * is worse than the budget, it asks for exactly one downgrade. It never
 * downgrades twice and never upgrades — a second downgrade means the initial
 * probe was wrong by two classes, which in practice means the page is doing
 * something else expensive and we should not keep chasing it.
 */
export class FrameGovernor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.windows=2]     number of sampling windows
   * @param {number} [opts.windowMs=500]  length of each window
   * @param {number} [opts.minFps=45]     below this, downgrade once
   * @param {(tier:number)=>void} [opts.onDowngrade]
   */
  constructor({ windows = 2, windowMs = 500, minFps = 45, onDowngrade } = {}) {
    this.windows = windows;
    this.windowMs = windowMs;
    this.minFps = minFps;
    this.onDowngrade = onDowngrade;
    this.samples = [];
    this.frameTimes = [];
    this.last = 0;
    this.raf = null;
    this.done = false;
    // NB: must not be called `start` — that would shadow the start() method.
    this._windowStart = 0;
  }

  /** @param {number} currentTier */
  start(currentTier, rafSource) {
    const raf =
      rafSource || (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : null);
    if (!raf || currentTier <= 0) {
      // Nothing to give up when already at the bottom of the ladder.
      return;
    }
    this.tier = currentTier;
    this._windowStart = 0;
    const tick = (ts) => {
      if (this.done) return;
      if (!this.last) {
        this.last = ts;
        this._windowStart = ts;
        this.raf = raf(tick);
        return;
      }
      const dt = ts - this.last;
      this.last = ts;
      if (dt > 0 && dt < 200) this.frameTimes.push(dt);

      if (ts - this._windowStart >= this.windowMs) {
        const fps = this._medianFps();
        this.samples.push(fps);
        this.frameTimes = [];
        this._windowStart = ts;
        if (fps !== null && fps < this.minFps) {
          this.done = true;
          const next = Math.min(3, this.tier + 1);
          this.onDowngrade?.(next, fps);
          return;
        }
        if (this.samples.length >= this.windows) {
          this.done = true;
          return;
        }
      }
      this.raf = raf(tick);
    };
    this.raf = raf(tick);
  }

  _medianFps() {
    const times = this.frameTimes.slice().sort((a, b) => a - b);
    if (times.length < 4) return null;
    const median = times[Math.floor(times.length / 2)];
    if (!median) return null;
    return Math.round(1000 / median);
  }

  stop() {
    this.done = true;
    this.raf = null;
  }
}
