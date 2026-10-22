import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-switch> — material toggle.
 *
 *   <sp-switch material="metal" label="自动漂移" checked></sp-switch>
 *
 * A real <button role="switch"> with aria-checked, so it is announced as a
 * switch rather than a checkbox with a paint job. Space and Enter both toggle;
 * that is the native button contract, not extra code.
 *
 * The thumb is the only moving part. On metal it reads as a machined slider;
 * on liquid it carries the same chromatic fringe as the rest of the surface,
 * which is what makes the material feel continuous rather than decorative.
 */
export class SpSwitch extends SpecularElement {
  static shell =
    '<button class="sp-el sp-switch" type="button" role="switch" data-sp-control aria-checked="false">' +
    surfaceMarkup() +
    '<span class="sp-switch-stack">' +
    '<span class="sp-switch-track" aria-hidden="true"><span class="sp-switch-thumb"></span></span>' +
    '<span class="sp-switch-label" data-sp-label hidden></span>' +
    "</span>" +
    "</button>";

  static defaultMaterial = "metal";

  static get observedAttributes() {
    return [...super.observedAttributes, "checked", "label", "disabled"];
  }

  _mount() {
    super._mount();
    const btn = this._control();
    if (!btn || btn.dataset.spBound) return;
    btn.dataset.spBound = "1";
    btn.addEventListener("click", () => {
      if (this.hasAttribute("disabled")) return;
      const next = !this.hasAttribute("checked");
      this.toggleAttribute("checked", next);
      this.dispatchEvent(
        new CustomEvent("switch-change", { bubbles: true, detail: { checked: next } })
      );
    });
    this._sync();
  }

  connectedCallback() {
    super.connectedCallback();
    this._sync();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    this._sync();
  }

  _sync() {
    const btn = this._control();
    if (!btn) return;
    const on = this.hasAttribute("checked");
    btn.setAttribute("aria-checked", on ? "true" : "false");
    btn.disabled = this.hasAttribute("disabled");
    this.dataset.checked = on ? "true" : "false";

    const label = this.querySelector("[data-sp-label]");
    const text = this.getAttribute("label") || "";
    if (label) {
      label.textContent = text;
      label.hidden = !text;
    }
    if (!text) btn.setAttribute("aria-label", this.getAttribute("aria-label") || "toggle");
  }

  get checked() {
    return this.hasAttribute("checked");
  }

  set checked(v) {
    this.toggleAttribute("checked", Boolean(v));
  }
}

define("sp-switch", SpSwitch);
