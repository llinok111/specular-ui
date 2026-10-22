import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-card> — a material panel with an editorial header/body/footer rhythm.
 *
 *   <sp-card eyebrow="MATERIAL" heading="液态玻璃" material="liquid">
 *     <p>正文…</p>
 *     <div data-slot="footer">
 *       <sp-button size="sm">查看</sp-button>
 *     </div>
 *   </sp-card>
 *
 * `interactive` promotes the card to a keyboard-reachable target (role=button,
 * Enter/Space mapped to click) without turning the whole card into a <button>,
 * which would swallow nested links.
 */
export class SpCard extends SpecularElement {
  static shell =
    '<div class="sp-el sp-card-inner">' +
    surfaceMarkup() +
    '<div class="sp-card-stack">' +
    '<div class="sp-card-head"><span class="sp-card-eyebrow" data-sp-eyebrow></span></div>' +
    '<h3 class="sp-card-title" data-sp-title></h3>' +
    '<div class="sp-card-body" data-sp-slot></div>' +
    '<div class="sp-card-foot" data-sp-foot hidden></div>' +
    "</div>" +
    "</div>";

  static get observedAttributes() {
    return [...super.observedAttributes, "heading", "eyebrow", "interactive"];
  }

  _mount() {
    // Pull an author-declared footer out before the generic slot capture.
    const footerNodes = [];
    const stash = this.querySelectorAll('[data-slot="footer"]');
    for (const node of stash) {
      for (const child of [...node.childNodes]) footerNodes.push(child);
    }
    super._mount();
    const foot = this.querySelector("[data-sp-foot]");
    if (foot && footerNodes.length) {
      for (const child of footerNodes) foot.appendChild(child);
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
    if (name === "heading" || name === "eyebrow") this._syncText();
    if (name === "interactive") this._syncInteractive();
  }

  _syncText() {
    const eyebrow = this.querySelector("[data-sp-eyebrow]");
    const title = this.querySelector("[data-sp-title]");
    const head = this.querySelector(".sp-card-head");
    if (eyebrow) {
      const text = this.getAttribute("eyebrow") || "";
      eyebrow.textContent = text;
      if (head) head.hidden = !text;
    }
    if (title) {
      const text = this.getAttribute("heading") || "";
      title.textContent = text;
      title.hidden = !text;
    }
  }

  _syncInteractive() {
    const inner = this.querySelector(".sp-card-inner");
    if (!inner) return;
    const on = this.hasAttribute("interactive");
    this.dataset.interactive = on ? "true" : "false";
    inner.setAttribute("tabindex", on ? "0" : "-1");
    if (on) {
      inner.setAttribute("role", "button");
      if (!inner.dataset.spKeyBound) {
        inner.dataset.spKeyBound = "1";
        inner.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
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
}

define("sp-card", SpCard);
