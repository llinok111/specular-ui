/**
 * specular-ui · element base
 *
 * Components are light-DOM custom elements. Two consequences, both deliberate:
 *
 *   - Theme tokens inherit normally. A `<sp-button>` inside a dark section, a
 *     `<button>` next to it and a plain `<div>` all resolve the same variables.
 *     No `::part` gymnastics, no `adoptedStyleSheets` plumbing.
 *   - The interactive element is a REAL `<button>`, `<nav>` or `<div role>`.
 *     Keyboard, form submission, focus order and screen-reader semantics come
 *     from the platform instead of being re-implemented badly.
 *
 * The shell is built once, then mutations are applied as attributes/dataset so
 * the browser can style them declaratively. No virtual DOM, no re-render.
 */

import { defaultAtlas } from "../core/displacement.js";
import { resolveMaterial, refractionSpec } from "../core/materials.js";

let sharedConfig = {
  atlas: defaultAtlas,
  tier: 0,
};

export function configure(next) {
  sharedConfig = { ...sharedConfig, ...next };
}

export function getConfig() {
  return sharedConfig;
}

const LAYER_MARKUP =
  '<span class="sp-surface" aria-hidden="true">' +
  '<span class="sp-tint"></span>' +
  '<span class="sp-grain"></span>' +
  '<span class="sp-aniso"></span>' +
  '<span class="sp-chroma"></span>' +
  '<span class="sp-film"></span>' +
  "</span>" +
  '<span class="sp-sheen" aria-hidden="true"></span>' +
  '<span class="sp-edge" aria-hidden="true"></span>';

/** The four optical layers, shared by every component shell. */
export function surfaceMarkup() {
  return LAYER_MARKUP;
}

export class SpecularElement extends HTMLElement {
  /** Subclasses override: the inner markup with a `<slot>` stand-in node. */
  static shell = "";
  static hostStyle = "";
  /** Default material when the attribute is absent. */
  static defaultMaterial = "liquid";

  static get observedAttributes() {
    return ["material", "variant", "size", "disabled", "loading"];
  }

  constructor() {
    super();
    this._mounted = false;
    this._ro = null;
    this._raf = 0;
    this._lastSize = "";
    this._material = SpecularElement.defaultMaterial;
  }

  connectedCallback() {
    if (!this._isBuilt()) this._mount();
    if (!this.hasAttribute("data-sp-lobe")) this.setAttribute("data-sp-lobe", "");
    this._applyMaterial();
    this._observe();
    this._queueRefraction();
  }

  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._isBuilt() || oldValue === newValue) return;
    if (name === "material") {
      this._applyMaterial();
      this._queueRefraction();
      return;
    }
    if (name === "variant" || name === "size" || name === "tone") {
      // Mirror onto the inner shell so selectors stay flat (`.sp-el[data-size]`)
      // and the host keeps its own attribute for authoring/overrides.
      this._mirror(name);
      return;
    }
    if (name === "disabled") {
      const inner = this._control();
      if (inner && "disabled" in inner) inner.disabled = newValue !== null;
      this.setAttribute("aria-disabled", newValue !== null ? "true" : "false");
      if (newValue === null) this.removeAttribute("aria-disabled");
      return;
    }
    if (name === "loading") {
      this._setState("loading", newValue !== null ? "true" : "false");
      this.setAttribute("aria-busy", newValue !== null ? "true" : "false");
      if (newValue === null) this.removeAttribute("aria-busy");
      return;
    }
  }

  /**
   * Is the shell still ours?
   *
   * Neither an instance flag nor a `.sp-surface` lookup is safe here. A parent
   * moves its children while mounting (a navbar relocates its action slot), so
   * an instance flag can be flipped before the DOM exists; and `querySelector`
   * happily finds a *nested* component's surface, which made a <sp-card> that
   * contained a <sp-button> believe it was already built and skip mounting
   * entirely. Holding a reference to the root we created, and checking that it
   * is still a direct child, survives all three cases.
   */
  _isBuilt() {
    const root = this._shellRoot;
    return Boolean(root) && root.parentNode === this;
  }

  /** The focal interactive node, if this component has one. */
  _control() {
    return this.querySelector("[data-sp-control]");
  }

  /** Copy a sizing/variant attribute onto every `.sp-el` inside the shell. */
  _mirror(name) {
    const value = this.getAttribute(name);
    for (const el of this.querySelectorAll(".sp-el")) {
      if (value == null) delete el.dataset[name];
      else el.dataset[name] = value;
    }
  }

  /** Mirror every declarative attribute once, after the shell exists. */
  _mirrorAll() {
    for (const name of ["variant", "size", "tone"]) this._mirror(name);
  }

  _mount() {
    const ctor = this.constructor;
    const content = document.createDocumentFragment();
    while (this.firstChild) content.appendChild(this.firstChild);

    this.innerHTML = ctor.shell.replace("<!--slot-->", "") + "";
    const slot = this.querySelector("[data-sp-slot]");
    if (slot) slot.appendChild(content);

    this._mounted = true;
    this._shellRoot = this.firstElementChild;
    // Inherit defaults so CSS never sees a material-less surface.
    if (!this.hasAttribute("material")) {
      this.setAttribute("material", ctor.defaultMaterial);
    }
    this._mirrorAll();
    this._syncStates();
  }

  /** Apply boolean attributes that were present before the shell existed. */
  _syncStates() {
    const control = this._control();
    if (this.hasAttribute("disabled")) {
      if (control && "disabled" in control) control.disabled = true;
      this.setAttribute("aria-disabled", "true");
    }
    if (this.hasAttribute("loading")) {
      this._setState("loading", "true");
      this.setAttribute("aria-busy", "true");
    }
  }

  /** Write a state flag on the host and on every shell, so CSS can match both. */
  _setState(name, value) {
    this.dataset[name] = value;
    for (const el of this.querySelectorAll(".sp-el")) el.dataset[name] = value;
  }

  _applyMaterial() {
    const id = resolveMaterial(this.getAttribute("material"));
    this._material = id;
    this.dataset.material = id;
  }

  _observe() {
    if (this._ro || typeof ResizeObserver === "undefined") return;
    this._ro = new ResizeObserver(() => this._queueRefraction());
    this._ro.observe(this.querySelector(".sp-surface") || this);
  }

  /** Coalesce resize bursts into one filter build per frame. */
  _queueRefraction() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._syncRefraction();
    });
  }

  _syncRefraction() {
    const surface = this.querySelector(".sp-surface");
    if (!surface) return;

    const spec = refractionSpec(this._material);
    const tier = sharedConfig.tier ?? 0;
    const enabled = sharedConfig.refraction === "on";

    // The SVG displacement path is opt-in and off by default. Browsers do not
    // feed a `backdrop-filter` result into `filter: url(#…)`, so the map has
    // nothing to bend unless the surface paints its own content — measured, not
    // assumed; see docs/LIMITS.md. The default liquid surface is CSS-composited.
    if (!spec || !enabled || tier >= 2) {
      surface.style.removeProperty("filter");
      delete this.dataset.refract;
      return;
    }

    const rect = surface.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 8 || h < 8) {
      surface.style.removeProperty("filter");
      return;
    }

    const sizeKey = `${w}x${h}`;
    if (sizeKey === this._lastSize && surface.style.filter) return;

    const scale = spec.scale * (tier === 1 ? 0.6 : 1);
    const filter = sharedConfig.atlas.filterFor({
      width: w,
      height: h,
      profile: spec.profile,
      scale,
      aberration: spec.aberration * (tier === 0 ? 1 : 0.5),
    });

    if (filter) {
      surface.style.filter = filter;
      this._lastSize = sizeKey;
      this.dataset.refract = "on";
    } else {
      surface.style.removeProperty("filter");
      delete this.dataset.refract;
    }
  }
}

/**
 * Register a component, guarding against double registration during HMR.
 * @param {string} tag
 * @param {typeof HTMLElement} ctor
 */
export function define(tag, ctor) {
  if (typeof customElements === "undefined") return false;
  if (customElements.get(tag)) return false;
  customElements.define(tag, ctor);
  return true;
}
