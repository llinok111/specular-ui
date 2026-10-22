import { SpecularElement, surfaceMarkup, define } from "./base.js";

let inputSeq = 0;

/**
 * <sp-input> — material text field.
 *
 *   <sp-input material="liquid" label="邮箱" type="email" placeholder="you@example.com"></sp-input>
 *
 * The field is a real <input> with a real <label for>, so clicking the label
 * focuses it, autofill works, and password managers see a normal form control.
 * The material only ever paints the shell — it never intercepts events.
 *
 * Focus is communicated twice: a ring for keyboard users, and a light-directed
 * highlight on the bezel, which is the same language every other surface uses.
 */
export class SpInput extends SpecularElement {
  static shell =
    '<label class="sp-el sp-field" data-sp-control>' +
    surfaceMarkup() +
    '<span class="sp-field-stack">' +
    '<span class="sp-field-label" data-sp-label hidden></span>' +
    '<input class="sp-field-input" data-sp-input>' +
    "</span>" +
    "</label>";

  static defaultMaterial = "frost";

  static get observedAttributes() {
    return [...super.observedAttributes, "label", "placeholder", "type", "name", "value", "readonly"];
  }

  _mount() {
    super._mount();
    this._id = `sp-input-${++inputSeq}`;
    // The <label> is the shell itself; the inner span is only the visual
    // caption. `for` has to land on the label element, not on the span,
    // otherwise clicking the caption does not focus the field.
    const labelEl = this.querySelector("label.sp-field");
    const caption = this.querySelector("[data-sp-label]");
    const input = this.querySelector("[data-sp-input]");
    if (!input) return;
    input.id = this._id;
    if (labelEl) labelEl.setAttribute("for", this._id);
    if (caption) caption.id = `${this._id}-caption`;
    this._syncAll();
    input.addEventListener("input", () => {
      this._value = input.value;
      this.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("change", () => {
      this.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncAll();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    this._syncAll();
  }

  _syncAll() {
    const caption = this.querySelector("[data-sp-label]");
    const input = this.querySelector("[data-sp-input]");
    if (!input) return;

    const text = this.getAttribute("label") || "";
    if (caption) {
      caption.textContent = text;
      caption.hidden = !text;
    }

    for (const attr of ["placeholder", "type", "name"]) {
      const v = this.getAttribute(attr);
      if (v != null) input.setAttribute(attr, v);
    }
    if (this.hasAttribute("readonly")) input.readOnly = true;
    else input.readOnly = false;

    if (!this._touched && this.hasAttribute("value")) input.value = this.getAttribute("value");
    if (this.hasAttribute("disabled")) input.disabled = true;
    else input.disabled = false;

    // With a visible caption the <label for> already names the field; adding
    // aria-label would override it with a placeholder, which is worse.
    if (text) input.removeAttribute("aria-label");
    else input.setAttribute("aria-label", this.getAttribute("aria-label") || this.getAttribute("placeholder") || "input");
  }

  get value() {
    return this.querySelector("[data-sp-input]")?.value ?? "";
  }

  set value(v) {
    this._touched = true;
    const input = this.querySelector("[data-sp-input]");
    if (input) input.value = String(v);
  }

  focus() {
    this.querySelector("[data-sp-input]")?.focus();
  }
}

define("sp-input", SpInput);
