import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-navbar> — a floating material navigation bar.
 *
 *   <sp-navbar brand="Specular" material="frost">
 *     <a class="sp-nav-link" href="#materials" aria-current="page">材质</a>
 *     <a class="sp-nav-link" href="#components">组件</a>
 *     <div data-slot="actions">
 *       <sp-button size="sm" variant="primary">开始</sp-button>
 *     </div>
 *   </sp-navbar>
 *
 * Scrolled state is applied as an attribute so CSS can deepen the shadow and
 * tighten the frost without any measurement staying in JS.
 */
export class SpNavbar extends SpecularElement {
  static shell =
    '<nav class="sp-el sp-nav-inner">' +
    surfaceMarkup() +
    '<span class="sp-nav-brand">' +
    '<span class="sp-nav-mark" aria-hidden="true"></span>' +
    '<span data-sp-brand></span>' +
    "</span>" +
    '<span class="sp-nav-links" data-sp-slot></span>' +
    '<span class="sp-nav-actions" data-sp-foot></span>' +
    "</nav>";

  static get observedAttributes() {
    return [...super.observedAttributes, "brand", "mark", "compact"];
  }

  _mount() {
    const actionNodes = [];
    for (const node of this.querySelectorAll('[data-slot="actions"]')) {
      for (const child of [...node.childNodes]) actionNodes.push(child);
    }
    super._mount();

    const actions = this.querySelector("[data-sp-foot]");
    if (actions && actionNodes.length) {
      for (const child of actionNodes) actions.appendChild(child);
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
    if (name === "brand" || name === "mark") this._syncBrand();
  }

  _syncBrand() {
    const brand = this.querySelector("[data-sp-brand]");
    if (brand) brand.textContent = this.getAttribute("brand") || "";
    const mark = this.querySelector(".sp-nav-mark");
    if (mark) mark.hidden = this.getAttribute("mark") === "false";
  }

  _bindScroll() {
    if (this._scrollHandler) return;
    let raf = 0;
    this._scrollHandler = () => {
      if (raf) return;
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
}

define("sp-navbar", SpNavbar);
