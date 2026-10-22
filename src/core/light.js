/**
 * specular-ui · the light
 *
 * One light for the whole document. It is a singleton because the entire visual
 * premise of the library is that every surface agrees about where the light is;
 * two lights would make the page read as a collage.
 *
 * The controller writes four custom properties on <html>:
 *
 *   --sp-lx / --sp-ly         normalised viewport position, 0..1
 *   --sp-lx-signed / -y       the same, centred, range -1..1
 *   --sp-angle                azimuth of the light about the element centre,
 *                             in the CSS conic convention (0deg = up, cw)
 *
 * and, per hovered surface, a local lob position:
 *
 *   --sp-mx / --sp-my         pointer position inside that element, 0..1
 *
 * Updates are coalesced into one rAF write per frame, and the write is skipped
 * when the value has not moved by more than a threshold — a pointer moving 1px
 * must not invalidate a hundred gradients.
 */

const DEFAULTS = {
  x: 0.32,
  y: 0.18,
  /** Idle drift keeps metal and holographic film alive without input. */
  drift: true,
  driftAmplitude: { x: 0.3, y: 0.2 },
  driftSpeed: { x: 0.00021, y: 0.000147 },
  /** ms of pointer silence before drift resumes. */
  idleDelay: 2600,
  /** Minimum change in normalised units before a write happens. */
  epsilon: 0.0015,
  root: null,
};

export class SpecularLight {
  constructor(opts = {}) {
    this.opts = { ...DEFAULTS, ...opts };
    this.root =
      this.opts.root ||
      (typeof document !== "undefined" ? document.documentElement : null);
    this.x = this.opts.x;
    this.y = this.opts.y;
    this.lastPointer = 0;
    this.pending = null;
    this.raf = null;
    this.frame = null;
    this.active = false;
    this.lobeEl = null;
    this.locked = false;
    this.reducedMotion =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false;
    this._onPointer = this._onPointer.bind(this);
    this._onOrientation = this._onOrientation.bind(this);
    this._tick = this._tick.bind(this);
  }

  /** Begin listening. Safe to call twice. */
  attach() {
    if (this.active || typeof window === "undefined") return this;
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
    if (typeof window === "undefined") return this;
    this.active = false;
    window.removeEventListener("pointermove", this._onPointer);
    window.removeEventListener("pointerdown", this._onPointer);
    window.removeEventListener("deviceorientation", this._onOrientation);
    if (this.frame) cancelAnimationFrame(this.frame);
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
        if (state !== "granted") return false;
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
    if (typeof window === "undefined") return;
    if (this.locked) return;
    const vw = window.innerWidth || 1;
    const vh = window.innerHeight || 1;
    this.lastPointer = performance.now();
    this._request(event.clientX / vw, event.clientY / vh, true);

    // Local lobe: find the nearest surface under the pointer.
    const path = event.composedPath ? event.composedPath() : [];
    const host =
      (path.find((n) => n instanceof Element && n.hasAttribute?.("data-sp-lobe")) ||
        event.target?.closest?.("[data-sp-lobe]")) ||
      null;

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
    const gamma = Number(event.gamma) || 0; // left/right, -90..90
    const beta = Number(event.beta) || 0; // front/back, -180..180
    this._request(clamp01(0.5 + gamma / 90), clamp01(0.35 + (beta - 45) / 180), true);
  }

  _tick(ts) {
    if (!this.opts.drift || this.reducedMotion) return;
    const idleFor = performance.now() - this.lastPointer;
    if (idleFor < this.opts.idleDelay) return;
    const { driftAmplitude: a, driftSpeed: s } = this.opts;
    const lx = 0.5 + Math.sin(ts * s.x) * a.x;
    const ly = 0.4 + Math.cos(ts * s.y) * a.y;
    this._request(lx, ly, false);
  }

  _request(x, y, fromPointer) {
    if (fromPointer) this.lastPointer = performance.now();
    if (
      !fromPointer &&
      Math.abs(x - this.x) < this.opts.epsilon &&
      Math.abs(y - this.y) < this.opts.epsilon
    ) {
      return;
    }
    this.pending = { x, y };
    if (this.raf) return;
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
    if (!this.root) return;
    const sx = this.x * 2 - 1;
    const sy = this.y * 2 - 1;
    // Azimuth from the element toward the light, in the conic convention.
    const deg = ((Math.atan2(sx, -sy) * 180) / Math.PI + 360) % 360;
    const style = this.root.style;
    style.setProperty("--sp-lx", this.x.toFixed(4));
    style.setProperty("--sp-ly", this.y.toFixed(4));
    style.setProperty("--sp-lx-signed", sx.toFixed(4));
    style.setProperty("--sp-ly-signed", sy.toFixed(4));
    style.setProperty("--sp-angle", `${deg.toFixed(1)}deg`);
    if (force) this.root.dataset.spLight = "on";
  }

  get vector() {
    return { x: this.x, y: this.y, angle: Number.parseFloat(this.root?.style.getPropertyValue("--sp-angle")) || 135 };
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The document-wide instance. */
export const light = new SpecularLight();
