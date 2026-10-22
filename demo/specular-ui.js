// src/core/sdf.js
function smoothStep(a, b, t) {
  const denom = b - a;
  let x = denom === 0 ? 0 : (t - a) / denom;
  x = x < 0 ? 0 : x > 1 ? 1 : x;
  return x * x * (3 - 2 * x);
}
function hypot(x, y) {
  return Math.sqrt(x * x + y * y);
}
function roundedRectSDF(x, y, halfW, halfH, radius) {
  const qx = Math.abs(x) - halfW + radius;
  const qy = Math.abs(y) - halfH + radius;
  const outside = hypot(Math.max(qx, 0), Math.max(qy, 0));
  return Math.min(Math.max(qx, qy), 0) + outside - radius;
}
function makeLensFragment({
  halfW = 0.3,
  halfH = 0.2,
  radius = 0.6,
  inner = 0.15,
  band = 0.8,
  focus = 0.5
} = {}) {
  const fragment = (uv) => {
    const ix = uv.x - 0.5;
    const iy = uv.y - 0.5;
    const d = roundedRectSDF(ix, iy, halfW, halfH, radius);
    if (d <= inner)
      return { x: focus, y: focus, skip: true };
    const displacement = smoothStep(band, 0, d - inner);
    const scaled = smoothStep(0, 1, displacement);
    return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 };
  };
  fragment.profile = "lens";
  return fragment;
}
function makeDoubleLensFragment({
  halfW = 0.3,
  halfH = 0.2,
  radius = 0.6,
  inner = 0.12,
  band = 0.8
} = {}) {
  const outer = makeLensFragment({ halfW, halfH, radius, inner, band });
  const innerRing = makeLensFragment({
    halfW: halfW * 0.62,
    halfH: halfH * 0.62,
    radius: radius * 0.62,
    inner: inner * 0.5,
    band: band * 0.55
  });
  const fragment = (uv) => {
    const a = outer(uv);
    if (a.skip) {
      const b = innerRing(uv);
      if (b.skip)
        return a;
      return { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
    }
    return a;
  };
  fragment.profile = "double-lens";
  return fragment;
}
function makeGrazingFragment({ halfW = 0.34, halfH = 0.22, radius = 0.4, angle = 0 } = {}) {
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const fragment = (uv) => {
    const ix = uv.x - 0.5;
    const iy = uv.y - 0.5;
    const d = roundedRectSDF(ix, iy, halfW, halfH, radius);
    if (d <= 0)
      return { x: 0.5, y: 0.5, skip: true };
    const ramp = smoothStep(0.42, 0, d);
    const bias = 0.5 + 0.5 * (ix * ax + iy * ay) * 2;
    const scaled = smoothStep(0, 1, ramp * (0.55 + 0.45 * bias));
    return { x: ix * scaled + 0.5, y: iy * scaled + 0.5 };
  };
  fragment.profile = "grazing";
  return fragment;
}
function computeDisplacementField(width, height, fragment, opts = {}) {
  const { normalize = "auto", edgeFade = true, maxShift = 0 } = opts;
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const data = new Uint8ClampedArray(w * h * 4);
  let skipped = 0;
  let maxScale = 0;
  if (!maxShift && normalize === "auto") {
    for (let y = 0; y < h; y++) {
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const pos = fragment({ x: x / w, y: v });
        if (pos.skip)
          continue;
        const dx = Math.abs(pos.x * w - x);
        const dy = Math.abs(pos.y * h - y);
        if (dx > maxScale)
          maxScale = dx;
        if (dy > maxScale)
          maxScale = dy;
      }
    }
    if (maxScale < 1)
      maxScale = 1;
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
function makeBoxLens({ width, height, band = 24, radius = 0, shift = 18 } = {}) {
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
    const d = roundedRectSDF(px, py, hw, hh, r);
    const inside = -d;
    if (inside >= bandPx)
      return { x: 0.5, y: 0.5, skip: true };
    const t = Math.max(0, Math.min(1, inside / bandPx));
    const eased = 1 - t;
    const bulge = eased * eased * (3 - 2 * eased);
    const dx = (px < 0 ? -1 : 1) * bulge * peak;
    const dy = (py < 0 ? -1 : 1) * bulge * peak;
    return { x: (px + dx) / w + 0.5, y: (py + dy) / h + 0.5, shift: peak };
  };
  fragment.profile = "box-lens";
  return fragment;
}

// src/core/displacement.js
var SVG_NS = "http://www.w3.org/2000/svg";
function quantise(value, grid = 16) {
  return Math.max(grid, Math.round(value / grid) * grid);
}
function fieldSize(width, height, maxSide = 512) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const longest = Math.max(w, h);
  const k = longest > maxSide ? maxSide / longest : 1;
  return {
    width: Math.max(8, Math.round(w * k)),
    height: Math.max(8, Math.round(h * k))
  };
}
var MAP_POS = "0%";
var MAP_SIZE = "100%";
function buildFilterMarkup(id, { url, scale }) {
  return `<filter id="${id}" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB"><feImage href="${url}" x="${MAP_POS}" y="${MAP_POS}" width="${MAP_SIZE}" height="${MAP_SIZE}" preserveAspectRatio="none" result="SP_MAP"/><feDisplacementMap in="SourceGraphic" in2="SP_MAP" scale="${Number(scale).toFixed(2)}" xChannelSelector="R" yChannelSelector="B"/></filter>`;
}
var RefractionAtlas = class {
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
    this.entries = /* @__PURE__ */ new Map();
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
      capacity: this.capacity
    };
  }
  /** Lazily create the single <svg> that holds every filter definition. */
  _ensureRoot() {
    if (this.root && this.root.isConnected)
      return this.root;
    if (typeof document === "undefined")
      return null;
    let root = document.getElementById("sp-filter-defs");
    if (!root) {
      root = document.createElementNS(SVG_NS, "svg");
      root.setAttribute("id", "sp-filter-defs");
      root.setAttribute("aria-hidden", "true");
      root.setAttribute("focusable", "false");
      root.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
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
    if (this.disabled || typeof document === "undefined")
      return null;
    const { width, height, scale = 58, aberration = 0.3 } = req;
    if (!(width > 0) || !(height > 0))
      return null;
    if (scale <= 0)
      return null;
    const qw = quantise(width, this.grid);
    const qh = quantise(height, this.grid);
    const qs = Math.round(scale / 4) * 4;
    const qa = Math.round(aberration * 8) / 8;
    const fragment = resolveFragment(req.profile, { width: qw, height: qh, scale: qs });
    const key = `${fragment.profile}|${qw}x${qh}|${qs}|${qa}`;
    const hit = this.entries.get(key);
    if (hit) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, hit);
      return `url(#${hit.id})`;
    }
    const root = this._ensureRoot();
    if (!root)
      return null;
    this.misses++;
    const size = fieldSize(qw, qh, this.maxSide);
    const field = computeDisplacementField(size.width, size.height, fragment);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx)
      return null;
    const image = ctx.createImageData(size.width, size.height);
    image.data.set(field.data);
    ctx.putImageData(image, 0, 0);
    const url = canvas.toDataURL("image/png");
    const id = `sp-f${++this.seq}`;
    const host = document.createElementNS(SVG_NS, "g");
    host.innerHTML = buildFilterMarkup(id, { url, scale: qs });
    while (host.firstChild)
      root.appendChild(host.firstChild);
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
        if (el)
          el.remove();
      }
    }
  }
  /** Drop every cached filter. Call when the theme changes the lens profile. */
  clear() {
    this.entries.clear();
    if (this.root)
      this.root.replaceChildren();
    this.hits = 0;
    this.misses = 0;
  }
};
function resolveFragment(profile, { width, height, scale }) {
  const name = typeof profile === "string" ? profile : "lens";
  const short = Math.min(width, height);
  const ratio = { lens: 0.3, "lens-soft": 0.44, "lens-tight": 0.18, "lens-deep": 0.38 }[name] ?? 0.3;
  const band = Math.max(10, Math.min(64, short * ratio));
  const radius = name === "lens-tight" ? short * 0.5 : short * 0.22;
  return makeBoxLens({ width, height, band, radius, strength: Math.min(1, scale / 48) });
}
var defaultAtlas = new RefractionAtlas();

// src/core/materials.js
var MATERIALS = {
  liquid: {
    id: "liquid",
    label: "\u6DB2\u6001\u73BB\u7483",
    labelEn: "Liquid glass",
    family: "refractive",
    note: "Rounded-rect lens with wavelength-split rim.",
    refraction: { profile: "lens", scale: 58, aberration: 0.55, chromatic: false }
  },
  metal: {
    id: "metal",
    label: "\u62C9\u4E1D\u91D1\u5C5E",
    labelEn: "Brushed metal",
    family: "opaque",
    note: "Anisotropic conic band rotated by the light azimuth.",
    refraction: null
  },
  frost: {
    id: "frost",
    label: "\u78E8\u7802\u73BB\u7483",
    labelEn: "Ground glass",
    family: "refractive",
    note: "Heavy blur, fine noise tooth, shallow bend.",
    refraction: { profile: "lens-soft", scale: 22, aberration: 0.18, chromatic: false }
  },
  holo: {
    id: "holo",
    label: "\u5168\u606F\u819C",
    labelEn: "Holographic film",
    family: "refractive",
    note: "Interference spectrum over a dark substrate.",
    refraction: { profile: "lens-tight", scale: 34, aberration: 0.4, chromatic: false }
  }
};
var MATERIAL_IDS = Object.keys(MATERIALS);
var DEFAULT_MATERIAL = "liquid";
function isMaterial(id) {
  return Object.prototype.hasOwnProperty.call(MATERIALS, id);
}
function resolveMaterial(id) {
  return isMaterial(id) ? id : DEFAULT_MATERIAL;
}
function refractionSpec(id) {
  return MATERIALS[resolveMaterial(id)].refraction;
}
var AMBIENCES = {
  dusk: { id: "dusk", label: "\u9EC4\u660F\u5DE5\u4F5C\u5BA4", labelEn: "Dusk" },
  studio: { id: "studio", label: "\u51B7\u8C03\u5F71\u68DA", labelEn: "Studio" },
  neon: { id: "neon", label: "\u9713\u8679\u591C", labelEn: "Neon" },
  paper: { id: "paper", label: "\u7EB8\u672C", labelEn: "Paper" }
};
var AMBIENCE_IDS = Object.keys(AMBIENCES);
function applyAmbience(id, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el)
    return null;
  const next = AMBIENCES[id] ? id : "dusk";
  el.dataset.spAmbience = next;
  return next;
}

// src/elements/base.js
var sharedConfig = {
  atlas: defaultAtlas,
  tier: 0
};
function configure(next) {
  sharedConfig = { ...sharedConfig, ...next };
}
function getConfig() {
  return sharedConfig;
}
var LAYER_MARKUP = '<span class="sp-surface" aria-hidden="true"><span class="sp-tint"></span><span class="sp-grain"></span><span class="sp-aniso"></span><span class="sp-chroma"></span><span class="sp-film"></span></span><span class="sp-sheen" aria-hidden="true"></span><span class="sp-edge" aria-hidden="true"></span>';
function surfaceMarkup() {
  return LAYER_MARKUP;
}
var SpecularElement = class _SpecularElement extends HTMLElement {
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
    this._material = _SpecularElement.defaultMaterial;
  }
  connectedCallback() {
    if (!this._isBuilt())
      this._mount();
    if (!this.hasAttribute("data-sp-lobe"))
      this.setAttribute("data-sp-lobe", "");
    this._applyMaterial();
    this._observe();
    this._queueRefraction();
  }
  disconnectedCallback() {
    this._ro?.disconnect();
    this._ro = null;
    if (this._raf)
      cancelAnimationFrame(this._raf);
    this._raf = 0;
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (!this._isBuilt() || oldValue === newValue)
      return;
    if (name === "material") {
      this._applyMaterial();
      this._queueRefraction();
      return;
    }
    if (name === "variant" || name === "size" || name === "tone") {
      this._mirror(name);
      return;
    }
    if (name === "disabled") {
      const inner = this._control();
      if (inner && "disabled" in inner)
        inner.disabled = newValue !== null;
      this.setAttribute("aria-disabled", newValue !== null ? "true" : "false");
      if (newValue === null)
        this.removeAttribute("aria-disabled");
      return;
    }
    if (name === "loading") {
      this._setState("loading", newValue !== null ? "true" : "false");
      this.setAttribute("aria-busy", newValue !== null ? "true" : "false");
      if (newValue === null)
        this.removeAttribute("aria-busy");
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
      if (value == null)
        delete el.dataset[name];
      else
        el.dataset[name] = value;
    }
  }
  /** Mirror every declarative attribute once, after the shell exists. */
  _mirrorAll() {
    for (const name of ["variant", "size", "tone"])
      this._mirror(name);
  }
  _mount() {
    const ctor = this.constructor;
    const content = document.createDocumentFragment();
    while (this.firstChild)
      content.appendChild(this.firstChild);
    this.innerHTML = ctor.shell.replace("<!--slot-->", "") + "";
    const slot = this.querySelector("[data-sp-slot]");
    if (slot)
      slot.appendChild(content);
    this._mounted = true;
    this._shellRoot = this.firstElementChild;
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
      if (control && "disabled" in control)
        control.disabled = true;
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
    for (const el of this.querySelectorAll(".sp-el"))
      el.dataset[name] = value;
  }
  _applyMaterial() {
    const id = resolveMaterial(this.getAttribute("material"));
    this._material = id;
    this.dataset.material = id;
  }
  _observe() {
    if (this._ro || typeof ResizeObserver === "undefined")
      return;
    this._ro = new ResizeObserver(() => this._queueRefraction());
    this._ro.observe(this.querySelector(".sp-surface") || this);
  }
  /** Coalesce resize bursts into one filter build per frame. */
  _queueRefraction() {
    if (this._raf)
      return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._syncRefraction();
    });
  }
  _syncRefraction() {
    const surface = this.querySelector(".sp-surface");
    if (!surface)
      return;
    const spec = refractionSpec(this._material);
    const tier = sharedConfig.tier ?? 0;
    const enabled = sharedConfig.refraction === "on";
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
    if (sizeKey === this._lastSize && surface.style.filter)
      return;
    const scale = spec.scale * (tier === 1 ? 0.6 : 1);
    const filter = sharedConfig.atlas.filterFor({
      width: w,
      height: h,
      profile: spec.profile,
      scale,
      aberration: spec.aberration * (tier === 0 ? 1 : 0.5)
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
};
function define(tag, ctor) {
  if (typeof customElements === "undefined")
    return false;
  if (customElements.get(tag))
    return false;
  customElements.define(tag, ctor);
  return true;
}

// src/elements/button.js
var SpButton = class extends SpecularElement {
  static shell = '<button class="sp-el" type="button" data-sp-control>' + surfaceMarkup() + '<span class="sp-content"><span data-sp-slot></span></span></button>';
  static get observedAttributes() {
    return [...super.observedAttributes, "type", "form"];
  }
  connectedCallback() {
    super.connectedCallback();
    const btn = this._control();
    if (!btn)
      return;
    btn.type = this.getAttribute("type") || "button";
    if (this.hasAttribute("form"))
      btn.setAttribute("form", this.getAttribute("form"));
    if (this.hasAttribute("disabled"))
      btn.disabled = true;
    const label = this.getAttribute("label");
    if (label)
      btn.setAttribute("aria-label", label);
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "type" || name === "form") {
      const btn = this._control();
      if (!btn)
        return;
      if (name === "type" && newValue)
        btn.type = newValue;
      if (name === "form") {
        if (newValue)
          btn.setAttribute("form", newValue);
        else
          btn.removeAttribute("form");
      }
      return;
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }
};
define("sp-button", SpButton);

// src/elements/card.js
var SpCard = class extends SpecularElement {
  static shell = '<div class="sp-el sp-card-inner">' + surfaceMarkup() + '<div class="sp-card-stack"><div class="sp-card-head"><span class="sp-card-eyebrow" data-sp-eyebrow></span></div><h3 class="sp-card-title" data-sp-title></h3><div class="sp-card-body" data-sp-slot></div><div class="sp-card-foot" data-sp-foot hidden></div></div></div>';
  static get observedAttributes() {
    return [...super.observedAttributes, "heading", "eyebrow", "interactive"];
  }
  _mount() {
    const footerNodes = [];
    const stash = this.querySelectorAll('[data-slot="footer"]');
    for (const node of stash) {
      for (const child of [...node.childNodes])
        footerNodes.push(child);
    }
    super._mount();
    const foot = this.querySelector("[data-sp-foot]");
    if (foot && footerNodes.length) {
      for (const child of footerNodes)
        foot.appendChild(child);
      foot.hidden = false;
    }
    this._syncText();
    this._syncInteractive();
  }
  connectedCallback() {
    super.connectedCallback();
    this._syncText();
    this._syncInteractive();
  }
  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "heading" || name === "eyebrow")
      this._syncText();
    if (name === "interactive")
      this._syncInteractive();
  }
  _syncText() {
    const eyebrow = this.querySelector("[data-sp-eyebrow]");
    const title = this.querySelector("[data-sp-title]");
    const head = this.querySelector(".sp-card-head");
    if (eyebrow) {
      const text = this.getAttribute("eyebrow") || "";
      eyebrow.textContent = text;
      if (head)
        head.hidden = !text;
    }
    if (title) {
      const text = this.getAttribute("heading") || "";
      title.textContent = text;
      title.hidden = !text;
    }
  }
  _syncInteractive() {
    const inner = this.querySelector(".sp-card-inner");
    if (!inner)
      return;
    const on = this.hasAttribute("interactive");
    this.dataset.interactive = on ? "true" : "false";
    inner.setAttribute("tabindex", on ? "0" : "-1");
    if (on) {
      inner.setAttribute("role", "button");
      if (!inner.dataset.spKeyBound) {
        inner.dataset.spKeyBound = "1";
        inner.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ")
            return;
          event.preventDefault();
          this.dispatchEvent(new CustomEvent("card-activate", { bubbles: true }));
          this.click();
        });
      }
    } else {
      inner.removeAttribute("role");
      inner.removeAttribute("tabindex");
    }
  }
};
define("sp-card", SpCard);

// src/elements/panel.js
var panelSeq = 0;
var SpPanel = class extends SpecularElement {
  static shell = '<div class="sp-el sp-panel-inner">' + surfaceMarkup() + '<button class="sp-panel-head" type="button" data-sp-control aria-expanded="true"><span class="sp-panel-title" data-sp-title></span><span class="sp-panel-caret" aria-hidden="true"></span></button><div class="sp-panel-body" data-sp-slot></div></div>';
  static get observedAttributes() {
    return [...super.observedAttributes, "heading", "collapsed", "collapsible"];
  }
  _mount() {
    super._mount();
    const body = this.querySelector(".sp-panel-body");
    const head = this._control();
    if (body && head) {
      if (!body.id)
        body.id = `sp-panel-body-${++panelSeq}`;
      head.setAttribute("aria-controls", body.id);
    }
    this._bindToggle();
    this._syncHeading();
    this._syncCollapsed();
  }
  connectedCallback() {
    super.connectedCallback();
    this._bindToggle();
    this._syncHeading();
    this._syncCollapsed();
  }
  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "heading")
      this._syncHeading();
    if (name === "collapsed")
      this._syncCollapsed();
    if (name === "collapsible")
      this._syncCollapsed();
  }
  _bindToggle() {
    const head = this._control();
    if (!head || head.dataset.spBound)
      return;
    head.dataset.spBound = "1";
    head.addEventListener("click", () => {
      if (this.getAttribute("collapsible") === "false")
        return;
      const next = this.getAttribute("collapsed") === "true" ? "false" : "true";
      this.setAttribute("collapsed", next);
      this.dispatchEvent(
        new CustomEvent("panel-toggle", {
          bubbles: true,
          detail: { collapsed: next === "true" }
        })
      );
    });
  }
  _syncHeading() {
    const title = this.querySelector("[data-sp-title]");
    if (title)
      title.textContent = this.getAttribute("heading") || "";
  }
  _syncCollapsed() {
    const collapsed = this.getAttribute("collapsed") === "true";
    const collapsible = this.getAttribute("collapsible") !== "false";
    const head = this._control();
    this.dataset.collapsed = collapsed ? "true" : "false";
    if (head) {
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
      head.setAttribute("aria-disabled", collapsible ? "false" : "true");
      head.style.cursor = collapsible ? "pointer" : "default";
    }
  }
};
define("sp-panel", SpPanel);

// src/elements/navbar.js
var SpNavbar = class extends SpecularElement {
  static shell = '<nav class="sp-el sp-nav-inner">' + surfaceMarkup() + '<span class="sp-nav-brand"><span class="sp-nav-mark" aria-hidden="true"></span><span data-sp-brand></span></span><span class="sp-nav-links" data-sp-slot></span><span class="sp-nav-actions" data-sp-foot></span></nav>';
  static get observedAttributes() {
    return [...super.observedAttributes, "brand", "mark", "compact"];
  }
  _mount() {
    const actionNodes = [];
    for (const node of this.querySelectorAll('[data-slot="actions"]')) {
      for (const child of [...node.childNodes])
        actionNodes.push(child);
    }
    super._mount();
    const actions = this.querySelector("[data-sp-foot]");
    if (actions && actionNodes.length) {
      for (const child of actionNodes)
        actions.appendChild(child);
      actions.hidden = false;
    } else if (actions) {
      actions.hidden = true;
    }
    this._syncBrand();
    this._bindScroll();
  }
  connectedCallback() {
    super.connectedCallback();
    this._syncBrand();
    this._bindScroll();
    this._onScroll();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("scroll", this._scrollHandler, { passive: true });
  }
  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "brand" || name === "mark")
      this._syncBrand();
  }
  _syncBrand() {
    const brand = this.querySelector("[data-sp-brand]");
    if (brand)
      brand.textContent = this.getAttribute("brand") || "";
    const mark = this.querySelector(".sp-nav-mark");
    if (mark)
      mark.hidden = this.getAttribute("mark") === "false";
  }
  _bindScroll() {
    if (this._scrollHandler)
      return;
    let raf = 0;
    this._scrollHandler = () => {
      if (raf)
        return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this._onScroll();
      });
    };
    window.addEventListener("scroll", this._scrollHandler, { passive: true });
  }
  _onScroll() {
    const y = window.scrollY || window.pageYOffset || 0;
    const scrolled = y > 8;
    if (scrolled !== (this.dataset.scrolled === "true")) {
      this.dataset.scrolled = scrolled ? "true" : "false";
    }
  }
};
define("sp-navbar", SpNavbar);

// src/core/capability.js
var TIER = {
  FULL: 0,
  BALANCED: 1,
  LITE: 2,
  STATIC: 3
};
var TIER_LABEL = {
  0: "full",
  1: "balanced",
  2: "lite",
  3: "static"
};
var cachedCapabilities = null;
function detectCapabilities(env) {
  const win = env?.window || (typeof window !== "undefined" ? window : null);
  const doc = env?.document || (typeof document !== "undefined" ? document : null);
  const nav = env?.navigator || (typeof navigator !== "undefined" ? navigator : null);
  const css = win?.CSS;
  if (!env && cachedCapabilities)
    return cachedCapabilities;
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
    backdropFilter: supports("backdrop-filter", "blur(2px)") || supports("-webkit-backdrop-filter", "blur(2px)"),
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
      h: win?.innerHeight || 0
    },
    saveData: Boolean(nav?.connection?.saveData)
  };
  caps.tier = resolveTier(caps);
  caps.reasons = explain(caps);
  if (!env)
    cachedCapabilities = caps;
  return caps;
}
function resolveTier(caps) {
  if (!caps)
    return TIER.STATIC;
  if (!caps.backdropFilter)
    return TIER.STATIC;
  if (!caps.displacement || !caps.svgFilter)
    return TIER.LITE;
  if (caps.reducedTransparency)
    return TIER.LITE;
  if (caps.reducedData || caps.saveData)
    return TIER.LITE;
  if (caps.deviceMemory && caps.deviceMemory <= 2)
    return TIER.LITE;
  if (caps.cores && caps.cores <= 2)
    return TIER.LITE;
  if (caps.coarsePointer) {
    const smallScreen = caps.viewport.w > 0 && caps.viewport.w < 430;
    if (smallScreen || caps.deviceMemory && caps.deviceMemory <= 4) {
      return TIER.BALANCED;
    }
  }
  if (caps.deviceMemory && caps.deviceMemory <= 4 && caps.cores <= 4) {
    return TIER.BALANCED;
  }
  if (!caps.conic || !caps.colorMix)
    return TIER.BALANCED;
  return TIER.FULL;
}
function explain(caps) {
  const reasons = [];
  if (!caps)
    return ["no capability record"];
  if (!caps.backdropFilter)
    reasons.push("backdrop-filter unsupported");
  if (!caps.displacement)
    reasons.push("svg displacement unsupported");
  if (caps.reducedTransparency)
    reasons.push("prefers-reduced-transparency");
  if (caps.reducedData || caps.saveData)
    reasons.push("data saver on");
  if (caps.deviceMemory && caps.deviceMemory <= 2)
    reasons.push(`deviceMemory ${caps.deviceMemory}GB`);
  if (caps.cores && caps.cores <= 2)
    reasons.push(`${caps.cores} logical cores`);
  if (caps.coarsePointer)
    reasons.push("coarse pointer");
  if (!caps.conic)
    reasons.push("conic-gradient unsupported");
  if (!caps.colorMix)
    reasons.push("color-mix unsupported");
  return reasons.length ? reasons : ["no constraints detected"];
}
function applyTier(tier, root) {
  const el = root || (typeof document !== "undefined" ? document.documentElement : null);
  if (!el)
    return tier;
  const value = String(Math.max(0, Math.min(3, tier | 0)));
  el.dataset.spTier = value;
  return value;
}
var FrameGovernor = class {
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
    this._windowStart = 0;
  }
  /** @param {number} currentTier */
  start(currentTier, rafSource) {
    const raf = rafSource || (typeof requestAnimationFrame !== "undefined" ? requestAnimationFrame : null);
    if (!raf || currentTier <= 0) {
      return;
    }
    this.tier = currentTier;
    this._windowStart = 0;
    const tick = (ts) => {
      if (this.done)
        return;
      if (!this.last) {
        this.last = ts;
        this._windowStart = ts;
        this.raf = raf(tick);
        return;
      }
      const dt = ts - this.last;
      this.last = ts;
      if (dt > 0 && dt < 200)
        this.frameTimes.push(dt);
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
    if (times.length < 4)
      return null;
    const median = times[Math.floor(times.length / 2)];
    if (!median)
      return null;
    return Math.round(1e3 / median);
  }
  stop() {
    this.done = true;
    this.raf = null;
  }
};

// src/core/light.js
var DEFAULTS = {
  x: 0.32,
  y: 0.18,
  /** Idle drift keeps metal and holographic film alive without input. */
  drift: true,
  driftAmplitude: { x: 0.3, y: 0.2 },
  driftSpeed: { x: 21e-5, y: 147e-6 },
  /** ms of pointer silence before drift resumes. */
  idleDelay: 2600,
  /** Minimum change in normalised units before a write happens. */
  epsilon: 15e-4,
  root: null
};
var SpecularLight = class {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.root = this.opts.root || (typeof document !== "undefined" ? document.documentElement : null);
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.lastPointer = 0;
    this.pending = null;
    this.raf = null;
    this.frame = null;
    this.active = false;
    this.lobeEl = null;
    this.locked = false;
    this.reducedMotion = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false;
    this._onPointer = this._onPointer.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
    this._tick = this._tick.bind(this);
  }
  /** Begin listening. Safe to call twice. */
  attach() {
    if (this.active || typeof window === "undefined")
      return this;
    this.active = true;
    window.addEventListener("pointermove", this._onPointer, { passive: true });
    window.addEventListener("pointerdown", this._onPointer, { passive: true });
    this._write(true);
    if (this.opts.drift && !this.reducedMotion) {
      const loop = (ts) => {
        this.frame = requestAnimationFrame(loop);
        this._tick(ts);
      };
      this.frame = requestAnimationFrame(loop);
    }
    return this;
  }
  detach() {
    if (typeof window === "undefined")
      return this;
    this.active = false;
    window.removeEventListener("pointermove", this._onPointer);
    window.removeEventListener("pointerdown", this._onPointer);
    window.removeEventListener("deviceorientation", this._onOrientation);
    if (this.frame)
      cancelAnimationFrame(this.frame);
    this.frame = null;
    return this;
  }
  /**
   * Opt-in tilt control for phones. iOS requires a user gesture before
   * DeviceOrientationEvent.requestPermission(), so this is never automatic.
   * @returns {Promise<boolean>} whether tilt is now live
   */
  async enableTilt() {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      return false;
    }
    try {
      const DOE = window.DeviceOrientationEvent;
      if (typeof DOE.requestPermission === "function") {
        const state = await DOE.requestPermission();
        if (state !== "granted")
          return false;
      }
      window.addEventListener("deviceorientation", this._onOrientation, { passive: true });
      return true;
    } catch {
      return false;
    }
  }
  /** Set the light directly. Coordinates are normalised viewport units. */
  set(x, y) {
    this._request(clamp01(x), clamp01(y), true);
    return this;
  }
  /**
   * Freeze the light against pointer input. Used by demos that want to drive
   * `--sp-lx/--sp-ly` from a slider without the pointer fighting them.
   */
  lock(on = true) {
    this.locked = Boolean(on);
    return this;
  }
  _onPointer(event) {
    if (typeof window === "undefined")
      return;
    if (this.locked)
      return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    this.lastPointer = performance.now();
    this._request(event.clientX / vw, event.clientY / vh, true);
    const path = event.composedPath ? event.composedPath() : [];
    const host = path.find((n) => n instanceof Element && n.hasAttribute?.("data-sp-lobe")) || event.target?.closest?.("[data-sp-lobe]") || null;
    if (host !== this.lobeEl) {
      if (this.lobeEl) {
        this.lobeEl.style.removeProperty("--sp-mx");
        this.lobeEl.style.removeProperty("--sp-my");
      }
      this.lobeEl = host;
    }
    if (host) {
      const rect = host.getBoundingClientRect();
      const mx = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
      const my = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;
      host.style.setProperty("--sp-mx", clamp01(mx).toFixed(3));
      host.style.setProperty("--sp-my", clamp01(my).toFixed(3));
    }
  }
  _onOrientation(event) {
    const gamma = Number(event.gamma) || 0;
    const beta = Number(event.beta) || 0;
    this._request(clamp01(0.5 + gamma / 90), clamp01(0.35 + (beta - 45) / 180), true);
  }
  _tick(ts) {
    if (!this.opts.drift || this.reducedMotion)
      return;
    const idleFor = performance.now() - this.lastPointer;
    if (idleFor < this.opts.idleDelay)
      return;
    const { driftAmplitude: a, driftSpeed: s } = this.opts;
    const lx = 0.5 + Math.sin(ts * s.x) * a.x;
    const ly = 0.4 + Math.cos(ts * s.y) * a.y;
    this._request(lx, ly, false);
  }
  _request(x, y, fromPointer) {
    if (fromPointer)
      this.lastPointer = performance.now();
    if (!fromPointer && Math.abs(x - this.x) < this.opts.epsilon && Math.abs(y - this.y) < this.opts.epsilon) {
      return;
    }
    this.pending = { x, y };
    if (this.raf)
      return;
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      if (this.pending) {
        this.x = this.pending.x;
        this.y = this.pending.y;
        this.pending = null;
        this._write();
      }
    });
  }
  _write(force) {
    if (!this.root)
      return;
    const sx = this.x * 2 - 1;
    const sy = this.y * 2 - 1;
    const deg = (Math.atan2(sx, -sy) * 180 / Math.PI + 360) % 360;
    const style = this.root.style;
    style.setProperty("--sp-lx", this.x.toFixed(4));
    style.setProperty("--sp-ly", this.y.toFixed(4));
    style.setProperty("--sp-lx-signed", sx.toFixed(4));
    style.setProperty("--sp-ly-signed", sy.toFixed(4));
    style.setProperty("--sp-angle", `${deg.toFixed(1)}deg`);
    if (force)
      this.root.dataset.spLight = "on";
  }
  get vector() {
    return { x: this.x, y: this.y, angle: Number.parseFloat(this.root?.style.getPropertyValue("--sp-angle")) || 135 };
  }
};
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
var light = new SpecularLight();

// src/specular.js
var started = false;
function init(opts = {}) {
  const root = typeof document !== "undefined" ? document.documentElement : null;
  if (!root) {
    return { tier: TIER.STATIC, tierLabel: "static", reasons: ["no document"], capabilities: null };
  }
  const caps = detectCapabilities();
  const requested = Number.isFinite(opts.tier) ? Math.max(0, Math.min(3, opts.tier)) : caps.tier;
  applyTier(requested, root);
  configure({ tier: requested, atlas: opts.atlas || defaultAtlas });
  if (opts.atlas) {
    defaultAtlas.chromatic = true;
  }
  light.attach();
  if (opts.tilt)
    light.enableTilt();
  const result = {
    tier: requested,
    tierLabel: TIER_LABEL[requested],
    reasons: explain(caps),
    capabilities: caps
  };
  if (opts.governor !== false && typeof requestAnimationFrame !== "undefined") {
    const governor = new FrameGovernor({
      onDowngrade: (next, fps) => {
        setTier(next);
        root.dataset.spGovernor = `downgraded:${fps}fps`;
      }
    });
    governor.start(requested);
    result.governor = governor;
  }
  started = true;
  root.dataset.spReady = "true";
  return result;
}
function setTier(tier) {
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
function diagnostics() {
  const cfg = getConfig();
  return {
    tier: cfg.tier,
    tierLabel: TIER_LABEL[cfg.tier],
    atlas: cfg.atlas.stats,
    light: light.vector,
    capabilities: detectCapabilities(),
    elements: typeof document !== "undefined" ? document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar").length : 0
  };
}
function setAmbience(id) {
  return applyAmbience(id);
}
function setRefraction(on) {
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
function setFringe(strength) {
  const v = Math.max(0, Math.min(1.2, Number(strength)));
  if (typeof document !== "undefined") {
    document.documentElement.style.setProperty("--sp-aberration", v.toFixed(2));
  }
  return v;
}
function boot() {
  if (typeof document === "undefined")
    return;
  const root = document.documentElement;
  if (root.dataset.spAuto === "false")
    return;
  if (started)
    return;
  init({
    tilt: root.dataset.spTilt === "auto",
    governor: root.dataset.spGovernor !== "off"
  });
}
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
}
export {
  AMBIENCES,
  AMBIENCE_IDS,
  FrameGovernor,
  MATERIALS,
  MATERIAL_IDS,
  RefractionAtlas,
  SpecularElement,
  SpecularLight,
  TIER,
  TIER_LABEL,
  applyAmbience,
  applyTier,
  computeDisplacementField,
  defaultAtlas,
  detectCapabilities,
  diagnostics,
  explain,
  fieldSize,
  init,
  light,
  makeDoubleLensFragment,
  makeGrazingFragment,
  makeLensFragment,
  quantise,
  resolveMaterial,
  roundedRectSDF,
  setAmbience,
  setFringe,
  setRefraction,
  setTier,
  smoothStep
};
//# sourceMappingURL=specular-ui.js.map
