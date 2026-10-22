/**
 * specular-ui — lighting-first material components
 *
 * Usage:
 *   <link rel="stylesheet" href="specular-ui.css">
 *   <script type="module" src="specular-ui.js"></script>
 *
 * The module auto-initialises on import (capability probe → tier → light),
 * unless the <html> element carries `data-sp-auto="false"`.
 */

import "./elements/button.js";
import "./elements/card.js";
import "./elements/panel.js";
import "./elements/navbar.js";
import "./elements/tabs.js";
import "./elements/input.js";
import "./elements/switch.js";
import "./elements/dialog.js";

import {
  TIER,
  TIER_LABEL,
  applyTier,
  detectCapabilities,
  explain,
  FrameGovernor,
} from "./core/capability.js";
import { defaultAtlas, RefractionAtlas, quantise, fieldSize } from "./core/displacement.js";
import { light, SpecularLight } from "./core/light.js";
import { configure, getConfig, SpecularElement } from "./elements/base.js";
import {
  AMBIENCES,
  AMBIENCE_IDS,
  applyAmbience,
  MATERIALS,
  MATERIAL_IDS,
  resolveMaterial,
} from "./core/materials.js";
import {
  computeDisplacementField,
  makeDoubleLensFragment,
  makeGrazingFragment,
  makeLensFragment,
  roundedRectSDF,
  smoothStep,
} from "./core/sdf.js";

export {
  TIER,
  TIER_LABEL,
  FrameGovernor,
  RefractionAtlas,
  SpecularElement,
  SpecularLight,
  AMBIENCES,
  AMBIENCE_IDS,
  MATERIALS,
  MATERIAL_IDS,
  applyAmbience,
  applyTier,
  computeDisplacementField,
  defaultAtlas,
  detectCapabilities,
  explain,
  fieldSize,
  light,
  makeDoubleLensFragment,
  makeGrazingFragment,
  makeLensFragment,
  quantise,
  resolveMaterial,
  roundedRectSDF,
  smoothStep,
};

let started = false;

/**
 * Boot the library.
 * @param {object} [opts]
 * @param {number} [opts.tier]        force a tier (0..3) instead of probing
 * @param {boolean} [opts.tilt=false] attempt device-orientation light steering
 * @param {boolean} [opts.governor=true] allow one runtime downgrade on jank
 * @param {object} [opts.atlas]       custom RefractionAtlas
 * @returns {{tier:number, tierLabel:string, reasons:string[], capabilities:object}}
 */
export function init(opts = {}) {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) {
    return { tier: TIER.STATIC, tierLabel: "static", reasons: ["no document"], capabilities: null };
  }

  const caps = detectCapabilities();
  const requested = Number.isFinite(opts.tier) ? Math.max(0, Math.min(3, opts.tier)) : caps.tier;
  applyTier(requested, root);
  configure({ tier: requested, atlas: opts.atlas || defaultAtlas });

  if (opts.atlas) {
    // A custom atlas may want a different chromatic default.
    defaultAtlas.chromatic = true;
  }

  light.attach();
  if (opts.tilt) light.enableTilt();

  const result = {
    tier: requested,
    tierLabel: TIER_LABEL[requested],
    reasons: explain(caps),
    capabilities: caps,
  };

  if (opts.governor !== false && typeof requestAnimationFrame !== "undefined") {
    const governor = new FrameGovernor({
      onDowngrade: (next, fps) => {
        setTier(next);
        root.dataset.spGovernor = `downgraded:${fps}fps`;
      },
    });
    governor.start(requested);
    result.governor = governor;
  }

  started = true;
  root.dataset.spReady = "true";
  return result;
}

/**
 * Change fidelity at runtime. Updates the token tier and re-syncs every mounted
 * surface, because a surface only builds its filter when it knows the tier.
 */
export function setTier(tier) {
  const next = Math.max(0, Math.min(3, tier | 0));
  applyTier(next, typeof document !== "undefined" ? document.documentElement : null);
  configure({ tier: next });
  if (typeof document !== "undefined") {
    for (const el of document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar")) {
      el._lastSize = "";
      el._queueRefraction?.();
    }
  }
  return next;
}

/** Everything a debug panel wants to know, in one call. */
export function diagnostics() {
  const cfg = getConfig();
  return {
    tier: cfg.tier,
    tierLabel: TIER_LABEL[cfg.tier],
    atlas: cfg.atlas.stats,
    light: light.vector,
    capabilities: detectCapabilities(),
    elements: typeof document !== "undefined"
      ? document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar").length
      : 0,
  };
}

/** Replace the ambient environment (dusk / studio / neon / paper). */
export function setAmbience(id) {
  return applyAmbience(id);
}

/**
 * Turn the SVG displacement layer on or off.
 *
 * Off by default, and that is a measured decision rather than a default of
 * convenience: Chrome and Safari do not feed the result of `backdrop-filter`
 * into `filter: url(#…)`, so a displacement map applied to a glass surface has
 * no backdrop pixels to move. Nothing throws — the filter simply paints
 * nothing. Enable it only on surfaces that paint their own content, or on a
 * future engine that composes the two.
 */
export function setRefraction(on) {
  configure({ refraction: on ? "on" : "off" });
  defaultAtlas.clear();
  if (typeof document !== "undefined") {
    for (const el of document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar")) {
      el._lastSize = "";
      el._queueRefraction?.();
    }
  }
  return Boolean(on);
}

/**
 * Scale the chromatic fringe (0 = neutral glass, 1 = pronounced).
 *
 * The fringe is composited in CSS rather than in the SVG filter: a three-pass
 * displacement stack costs ~4× per surface and darkens curved edges, because
 * SVG filters blend in premultiplied alpha. See materials.css for the model.
 */
export function setFringe(strength) {
  const v = Math.max(0, Math.min(1.2, Number(strength)));
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--sp-aberration", v.toFixed(2));
  }
  return v;
}

// ---------------------------------------------------------------------------
// Auto-init
// ---------------------------------------------------------------------------

function boot() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.spAuto === "false") return;
  if (started) return;
  init({
    tilt: root.dataset.spTilt === "auto",
    governor: root.dataset.spGovernor !== "off",
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
