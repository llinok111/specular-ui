import { SpecularElement, surfaceMarkup, define } from "./base.js";

/**
 * <sp-tabs> — material tab bar with a real roving-tabindex pattern.
 *
 *   <sp-tabs material="frost" value="材质">
 *     <div data-tab="材质">面板一</div>
 *     <div data-tab="组件">面板二</div>
 *   </sp-tabs>
 *
 * Children carrying `data-tab` become panels; `data-tab` is the label. The
 * component owns ARIA (tablist/tab/tabpanel, aria-selected, aria-controls) and
 * the keyboard contract (Left/Right to walk, Home/End to jump, only the active
 * tab in the tab order) so callers write markup, not accessibility plumbing.
 *
 * The selected indicator is a single sliding element rather than a per-tab
 * background: one composited layer instead of N, and it can carry the material.
 */
export class SpTabs extends SpecularElement {
  static shell =
    '<div class="sp-el sp-tabs-inner">' +
    surfaceMarkup() +
    '<div class="sp-tabs-stack">' +
    '<div class="sp-tablist" role="tablist" data-sp-control></div>' +
    '<div class="sp-tabpanels" data-sp-panels></div>' +
    "</div>" +
    "</div>";

  static get observedAttributes() {
    return [...super.observedAttributes, "value"];
  }

  _mount() {
    // Capture author children before the shell replaces innerHTML.
    const panels = [];
    for (const child of [...this.children]) {
      if (!(child instanceof HTMLElement) || !child.hasAttribute("data-tab")) continue;
      panels.push({ label: child.getAttribute("data-tab") || "", node: child });
    }

    super._mount();

    this._panels = panels;
    this._tabs = [];
    const list = this.querySelector(".sp-tablist");
    const host = this.querySelector("[data-sp-panels]");
    if (!list || !host) return;

    panels.forEach((p, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sp-tab";
      btn.id = `sp-tab-${this._uid()}-${i}`;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-controls", `sp-panel-${this._uid()}-${i}`);
      btn.tabIndex = -1;
      btn.textContent = p.label;
      list.appendChild(btn);
      this._tabs.push(btn);

      const panel = document.createElement("div");
      panel.className = "sp-tabpanel";
      panel.id = `sp-panel-${this._uid()}-${i}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", btn.id);
      panel.tabIndex = 0;
      panel.appendChild(p.node);
      host.appendChild(panel);
    });

    if (!list.querySelector(".sp-tab-indicator")) {
      const ind = document.createElement("span");
      ind.className = "sp-tab-indicator";
      ind.setAttribute("aria-hidden", "true");
      list.appendChild(ind);
    }

    list.addEventListener("keydown", (e) => this._onKey(e));
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".sp-tab");
      if (btn && this._tabs.includes(btn)) this._select(this._tabs.indexOf(btn), true);
    });

    const initial =
      this.getAttribute("value") ??
      (this._tabs[0] ? this._panels[0].label : null);
    const idx = Math.max(0, this._panels.findIndex((p) => p.label === initial));
    this._select(idx, false);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this._tabs?.length) this._select(this._index ?? 0, false);
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (name === "value" && this._tabs?.length) {
      const idx = this._panels.findIndex((p) => p.label === newValue);
      if (idx >= 0) this._select(idx, false);
    }
  }

  _uid() {
    if (!this._id) this._id = Math.random().toString(36).slice(2, 8);
    return this._id;
  }

  get value() {
    return this._panels?.[this._index]?.label ?? null;
  }

  set value(v) {
    this.setAttribute("value", String(v));
  }

  _select(index, focus) {
    if (!this._tabs.length) return;
    const i = Math.max(0, Math.min(this._tabs.length - 1, index));
    this._index = i;

    this._tabs.forEach((btn, n) => {
      const on = n === i;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
      btn.classList.toggle("is-active", on);
    });

    this.querySelectorAll(".sp-tabpanel").forEach((p, n) => {
      p.hidden = n !== i;
    });

    const ind = this.querySelector(".sp-tab-indicator");
    const active = this._tabs[i];
    if (ind && active) {
      ind.style.width = `${active.offsetWidth}px`;
      ind.style.transform = `translateX(${active.offsetLeft}px)`;
      ind.dataset.ready = "true";
    }

    if (focus) active.focus();
    if (this.getAttribute("value") !== this._panels[i].label) {
      // Reflect without re-entering the attribute handler's select path.
      this.setAttribute("value", this._panels[i].label);
    }
    this.dispatchEvent(
      new CustomEvent("tab-change", { bubbles: true, detail: { value: this._panels[i].label, index: i } })
    );
  }

  _onKey(e) {
    const last = this._tabs.length - 1;
    let next = null;
    if (e.key === "ArrowRight") next = this._index >= last ? 0 : this._index + 1;
    else if (e.key === "ArrowLeft") next = this._index <= 0 ? last : this._index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    this._select(next, true);
  }
}

define("sp-tabs", SpTabs);
