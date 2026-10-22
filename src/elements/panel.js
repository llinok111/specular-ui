import { SpecularElement, surfaceMarkup, define } from "./base.js";

let panelSeq = 0;

/**
 * <sp-panel> — a collapsible material container.
 *
 *   <sp-panel heading="光照模型" material="frost">
 *     <p>正文…</p>
 *   </sp-panel>
 *
 * The disclosure header is a real <button> with aria-expanded/aria-controls, so
 * it participates in the tab order and is announced as a toggle. `collapsed`
 * is the source of truth; the click handler writes it back to the attribute.
 */
export class SpPanel extends SpecularElement {
  static shell =
    '<div class="sp-el sp-panel-inner">' +
    surfaceMarkup() +
    '<button class="sp-panel-head" type="button" data-sp-control aria-expanded="true">' +
    '<span class="sp-panel-title" data-sp-title></span>' +
    '<span class="sp-panel-caret" aria-hidden="true"></span>' +
    "</button>" +
    '<div class="sp-panel-body" data-sp-slot></div>' +
    "</div>";

  static get observedAttributes() {
    return [...super.observedAttributes, "heading", "collapsed", "collapsible"];
  }

  _mount() {
    super._mount();
    const body = this.querySelector(".sp-panel-body");
    const head = this._control();
    if (body && head) {
      if (!body.id) body.id = `sp-panel-body-${++panelSeq}`;
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
    if (name === "heading") this._syncHeading();
    if (name === "collapsed") this._syncCollapsed();
    if (name === "collapsible") this._syncCollapsed();
  }

  _bindToggle() {
    const head = this._control();
    if (!head || head.dataset.spBound) return;
    head.dataset.spBound = "1";
    head.addEventListener("click", () => {
      if (this.getAttribute("collapsible") === "false") return;
      const next = this.getAttribute("collapsed") === "true" ? "false" : "true";
      this.setAttribute("collapsed", next);
      this.dispatchEvent(
        new CustomEvent("panel-toggle", {
          bubbles: true,
          detail: { collapsed: next === "true" },
        })
      );
    });
  }

  _syncHeading() {
    const title = this.querySelector("[data-sp-title]");
    if (title) title.textContent = this.getAttribute("heading") || "";
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
}

define("sp-panel", SpPanel);
