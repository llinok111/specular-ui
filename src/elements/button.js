import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-button> — a real <button> inside a material shell.
 *
 * Because the control is a genuine button in the light DOM, form submission,
 * Enter/Space activation, `:disabled` and focus order are platform behaviour.
 * The element only contributes the optical stack and attribute plumbing.
 *
 *   <sp-button material="metal" variant="primary" size="lg">开始</sp-button>
 *   <sp-button loading>提交中</sp-button>
 *   <sp-button disabled>不可用</sp-button>
 */
export class SpButton extends SpecularElement {
  static shell =
    '<button class="sp-el" type="button" data-sp-control>' +
    surfaceMarkup() +
    '<span class="sp-content"><span data-sp-slot></span></span>' +
    "</button>";

  static get observedAttributes() {
    return [...super.observedAttributes, "type", "form"];
  }

  connectedCallback() {
    super.connectedCallback();
    const btn = this._control();
    if (!btn) return;
    btn.type = this.getAttribute("type") || "button";
    if (this.hasAttribute("form")) btn.setAttribute("form", this.getAttribute("form"));
    if (this.hasAttribute("disabled")) btn.disabled = true;
    // An icon-only button still needs an accessible name.
    const label = this.getAttribute("label");
    if (label) btn.setAttribute("aria-label", label);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "type" || name === "form") {
      const btn = this._control();
      if (!btn) return;
      if (name === "type" && newValue) btn.type = newValue;
      if (name === "form") {
        if (newValue) btn.setAttribute("form", newValue);
        else btn.removeAttribute("form");
      }
      return;
    }
    super.attributeChangedCallback(name, oldValue, newValue);
  }
}

define("sp-button", SpButton);
