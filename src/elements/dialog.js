import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-dialog> — modal material surface on top of the native <dialog> element.
 *
 *   <sp-dialog material="liquid" heading="放弃更改？">
 *     <p>未保存的内容会丢失。</p>
 *     <div data-slot="actions">
 *       <sp-button variant="ghost" data-close>取消</sp-button>
 *       <sp-button variant="danger" data-confirm>放弃</sp-button>
 *     </div>
 *   </sp-dialog>
 *
 * Using <dialog> rather than a div means focus containment, Escape, the inert
 * background and the top layer come from the platform. What the library adds is
 * the material: a real backdrop-filter surface inside the dialog, plus a
 * `::backdrop` that dims and blurs the page behind it.
 *
 * The material sits inside the dialog, never on it — a filtered element cannot
 * live in the top layer without becoming its own containing block.
 */
export class SpDialog extends SpecularElement {
  static shell =
    '<dialog class="sp-dialog">' +
    '<div class="sp-el sp-dialog-inner">' +
    surfaceMarkup() +
    '<div class="sp-dialog-stack">' +
    '<h2 class="sp-dialog-title" data-sp-title hidden></h2>' +
    '<div class="sp-dialog-body" data-sp-slot></div>' +
    '<div class="sp-dialog-actions" data-sp-foot></div>' +
    "</div>" +
    "</div>" +
    "</dialog>";

  static get observedAttributes() {
    return [...super.observedAttributes, "heading", "open"];
  }

  _mount() {
    const actions = [];
    for (const node of this.querySelectorAll('[data-slot="actions"]')) {
      for (const child of [...node.childNodes]) actions.push(child);
    }
    super._mount();

    const foot = this.querySelector("[data-sp-foot]");
    if (foot && actions.length) {
      for (const a of actions) foot.appendChild(a);
      foot.hidden = false;
    } else if (foot) {
      foot.hidden = true;
    }

    const dlg = this.querySelector("dialog");
    if (!dlg) return;

    dlg.addEventListener("close", () => {
      this.removeAttribute("open");
      this.dispatchEvent(new CustomEvent("dialog-close", { bubbles: true }));
    });
    dlg.addEventListener("click", (e) => {
      // Click on the dialog element itself (not its content) = backdrop click.
      if (e.target === dlg) this.close();
      const closer = e.target.closest?.("[data-close]");
      if (closer) this.close();
      if (e.target.closest?.("[data-confirm]")) {
        this.dispatchEvent(new CustomEvent("dialog-confirm", { bubbles: true }));
        this.close();
      }
    });

    this._syncTitle();
  }

  connectedCallback() {
    super.connectedCallback();
    this._syncTitle();
    if (this.hasAttribute("open")) this.show();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "heading") this._syncTitle();
    if (name === "open") {
      const dlg = this.querySelector("dialog");
      if (!dlg) return;
      if (newValue !== null && !dlg.open) this.show();
      else if (newValue === null && dlg.open) dlg.close();
    }
  }

  _syncTitle() {
    const title = this.querySelector("[data-sp-title]");
    const dlg = this.querySelector("dialog");
    const text = this.getAttribute("heading") || "";
    if (title) {
      title.textContent = text;
      title.hidden = !text;
    }
    if (dlg) {
      if (text) dlg.setAttribute("aria-labelledby", title.id || (title.id = `sp-dialog-title-${Math.random().toString(36).slice(2, 7)}`));
      else dlg.removeAttribute("aria-labelledby");
    }
  }

  show() {
    const dlg = this.querySelector("dialog");
    if (!dlg || dlg.open) return;
    dlg.showModal();
    this.setAttribute("open", "");
  }

  close() {
    const dlg = this.querySelector("dialog");
    if (!dlg || !dlg.open) return;
    dlg.close();
  }

  get open() {
    return Boolean(this.querySelector("dialog")?.open);
  }
}

define("sp-dialog", SpDialog);
