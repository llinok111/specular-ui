/**
 * Control tests — the four form-facing components.
 *
 * These assert the platform contract, not the pixels: a tab must be a real tab
 * in the accessibility tree, an input must have a label that points at it, a
 * switch must be announced as a switch, and a dialog must actually be modal.
 * That is exactly the part a CSS-only implementation gets wrong.
 *
 *   node --test --test-concurrency=1 test/controls.test.mjs
 */

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const requirePw = createRequire(
  process.env.PW_HOME || "E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/"
);
const { chromium } = requirePw("playwright");

const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE = pathToFileURL(path.resolve("demo/index.html")).href;

let browser;
let page;
const errors = [];

before(async () => {
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: !process.env.HEADED,
    args: ["--allow-file-access-from-files"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto(PAGE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
});

after(async () => {
  await browser?.close();
});

test("all four new elements register", async () => {
  const tags = await page.evaluate(() =>
    ["sp-tabs", "sp-input", "sp-switch", "sp-dialog"].filter((t) => !!customElements.get(t))
  );
  assert.deepEqual(tags, ["sp-tabs", "sp-input", "sp-switch", "sp-dialog"]);
});

test("no runtime errors were raised while mounting the controls", () => {
  assert.deepEqual(errors, []);
});

// -------------------------------------------------------------------- tabs ---

test("tabs expose the tablist contract", async () => {
  const info = await page.evaluate(() => {
    const tabs = document.querySelector("sp-tabs");
    const list = tabs.querySelector('[role="tablist"]');
    const btns = [...tabs.querySelectorAll('[role="tab"]')];
    const panels = [...tabs.querySelectorAll('[role="tabpanel"]')];
    return {
      listRole: list?.getAttribute("role"),
      tabCount: btns.length,
      panelCount: panels.length,
      controlled: btns.every((b) => document.getElementById(b.getAttribute("aria-controls"))),
      labelled: panels.every((p) => document.getElementById(p.getAttribute("aria-labelledby"))),
      selected: btns.filter((b) => b.getAttribute("aria-selected") === "true").length,
      visible: panels.filter((p) => !p.hidden).length,
      inTabOrder: btns.filter((b) => b.tabIndex === 0).length,
    };
  });
  assert.equal(info.listRole, "tablist");
  assert.ok(info.tabCount >= 2, "demo needs at least two tabs");
  assert.equal(info.tabCount, info.panelCount, "one panel per tab");
  assert.ok(info.controlled, "every tab must control a real panel");
  assert.ok(info.labelled, "every panel must be labelled by its tab");
  assert.equal(info.selected, 1, "exactly one tab selected");
  assert.equal(info.visible, 1, "exactly one panel visible");
  assert.equal(info.inTabOrder, 1, "roving tabindex: one tab in the tab order");
});

test("clicking a tab moves selection and panels", async () => {
  const out = await page.evaluate(async () => {
    const tabs = document.querySelector("sp-tabs");
    const btns = [...tabs.querySelectorAll('[role="tab"]')];
    const panels = [...tabs.querySelectorAll('[role="tabpanel"]')];
    btns[2].click();
    await new Promise((r) => setTimeout(r, 90));
    return {
      selectedIndex: btns.findIndex((b) => b.getAttribute("aria-selected") === "true"),
      hidden: panels.map((p) => p.hidden),
      value: tabs.value,
      indicatorReady: tabs.querySelector(".sp-tab-indicator")?.dataset.ready,
    };
  });
  assert.equal(out.selectedIndex, 2);
  assert.deepEqual(out.hidden.map((h) => !h), [false, false, true], "third panel shown only");
  assert.equal(out.value, "降级");
  assert.equal(out.indicatorReady, "true");
});

test("arrow keys walk the tablist", async () => {
  const seq = await page.evaluate(async () => {
    const tabs = document.querySelector("sp-tabs");
    const btns = [...tabs.querySelectorAll('[role="tab"]')];
    const read = () => btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
    btns[0].click();
    await new Promise((r) => setTimeout(r, 60));
    const start = read();
    btns[start].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const right = read();
    const focused = document.activeElement === btns[right];
    btns[right].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    return { start, right, end: read(), focused };
  });
  assert.equal(seq.right, (seq.start + 1) % 3, "ArrowRight advances by one");
  assert.equal(seq.end, 2, "End jumps to the last tab");
  assert.equal(seq.focused, true, "focus follows selection");
});

// ------------------------------------------------------------------- input ---

test("input is a labelled native control", async () => {
  const info = await page.evaluate(async () => {
    const field = document.querySelector("sp-input");
    const input = field.querySelector("input");
    const label = field.querySelector("label");
    let bubbled = 0;
    field.addEventListener("input", () => bubbled++);
    input.focus();
    input.value = "hello@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 40));
    return {
      tag: input.tagName,
      type: input.type,
      labelFor: label?.getAttribute("for"),
      inputId: input.id,
      focused: document.activeElement === input,
      value: field.value,
      bubbled,
    };
  });
  assert.equal(info.tag, "INPUT");
  assert.equal(info.type, "email");
  assert.equal(info.labelFor, info.inputId, "label must point at the input");
  assert.equal(info.focused, true);
  assert.equal(info.value, "hello@example.com");
  assert.ok(info.bubbled > 0, "input event must bubble out of the component");
});

test("disabled input is really disabled", async () => {
  const blocked = await page.evaluate(() => {
    const field = [...document.querySelectorAll("sp-input")].find((f) => f.hasAttribute("disabled"));
    return field?.querySelector("input")?.disabled;
  });
  assert.equal(blocked, true);
});

// ------------------------------------------------------------------ switch ---

test("switch is announced as a switch and toggles", async () => {
  const info = await page.evaluate(async () => {
    const sw = document.querySelector("sp-switch");
    const btn = sw.querySelector("button");
    const before = btn.getAttribute("aria-checked");
    let fired = null;
    sw.addEventListener("switch-change", (e) => (fired = e.detail.checked));
    btn.click();
    await new Promise((r) => setTimeout(r, 70));
    return {
      role: btn.getAttribute("role"),
      before,
      after: btn.getAttribute("aria-checked"),
      visual: sw.dataset.checked,
      fired,
      thumbShift: getComputedStyle(sw.querySelector(".sp-switch-thumb")).transform,
    };
  });
  assert.equal(info.role, "switch");
  assert.notEqual(info.before, info.after, "click must flip aria-checked");
  assert.equal(info.visual, info.after, "visual state must match the ARIA state");
  assert.equal(info.fired, info.after === "true");
});

// ------------------------------------------------------------------ dialog ---

test("dialog is modal and syncs its host attribute", async () => {
  const info = await page.evaluate(async () => {
    const dlg = document.querySelector("sp-dialog");
    const native = dlg.querySelector("dialog");
    if (native.open) native.close();
    await new Promise((r) => setTimeout(r, 60));
    dlg.show();
    await new Promise((r) => setTimeout(r, 300));
    const opened = native.open;
    const modal = native.matches(":modal");
    const hostOpen = dlg.hasAttribute("open");
    native.close();
    await new Promise((r) => setTimeout(r, 100));
    return { opened, modal, hostOpen, closed: !native.open, hostClosed: !dlg.hasAttribute("open") };
  });
  assert.equal(info.opened, true);
  assert.equal(info.modal, true, "showModal must place it in the top layer");
  assert.equal(info.hostOpen, true, "host reflects the open state");
  assert.equal(info.closed, true);
  assert.equal(info.hostClosed, true);
});

test("dialog actions close it and report confirmation", async () => {
  const out = await page.evaluate(async () => {
    const dlg = document.querySelector("sp-dialog");
    const native = dlg.querySelector("dialog");
    if (native.open) native.close();
    await new Promise((r) => setTimeout(r, 60));
    dlg.show();
    await new Promise((r) => setTimeout(r, 300));
    let confirmed = false;
    dlg.addEventListener("dialog-confirm", () => (confirmed = true));
    native.querySelector("[data-confirm]")?.click();
    await new Promise((r) => setTimeout(r, 320));
    return { confirmed, closed: !native.open };
  });
  assert.equal(out.confirmed, true, "data-confirm must emit dialog-confirm");
  assert.equal(out.closed, true, "confirming closes the dialog");
});

// ------------------------------------------------------------------ layout ---

test("new controls fit a 375px viewport", async () => {
  const m = await browser.newPage({
    viewport: { width: 375, height: 812 },
    isMobile: true,
    hasTouch: true,
  });
  await m.goto(PAGE, { waitUntil: "load" });
  await m.waitForTimeout(900);
  const overflow = await m.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    tabWrap: document.querySelector(".sp-tablist")?.scrollWidth >
      document.querySelector(".sp-tablist")?.clientWidth,
  }));
  await m.close();
  assert.ok(overflow.scrollW <= overflow.clientW + 1, `page overflows: ${overflow.scrollW}`);
});
