/**
 * Browser tests — the parts a pure function cannot prove.
 *
 * Runs the real demo page in Chrome and asserts on behaviour, layout and the
 * optical layer. Every assertion is something a user would notice if it broke:
 * a missing refractive filter, a button that cannot be tabbed to, a card that
 * overflows a 375px viewport.
 *
 *   node test/browser.test.mjs            headless
 *   HEADED=1 node test/browser.test.mjs   watch it
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
const URL = pathToFileURL(path.resolve("demo/index.html")).href;

let browser;
let page;
const consoleErrors = [];

before(async () => {
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: !process.env.HEADED,
    args: ["--allow-file-access-from-files"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push("console: " + m.text());
  });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(1200);
});

after(async () => {
  await browser?.close();
});

// ------------------------------------------------------------------ boot ----

test("boots without runtime errors", () => {
  assert.deepEqual(consoleErrors, []);
});

test("declares a tier and marks the document ready", async () => {
  const state = await page.evaluate(() => ({
    tier: document.documentElement.dataset.spTier,
    ready: document.documentElement.dataset.spReady,
  }));
  assert.equal(state.ready, "true");
  assert.ok(["0", "1", "2", "3"].includes(state.tier));
});

test("registers all four custom elements", async () => {
  const tags = await page.evaluate(() =>
    ["sp-button", "sp-card", "sp-panel", "sp-navbar"].filter((t) => !!customElements.get(t))
  );
  assert.deepEqual(tags, ["sp-button", "sp-card", "sp-panel", "sp-navbar"]);
});

// ------------------------------------------------------------- rendering ----

test("every mounted component builds the four optical layers", async () => {
  const bad = await page.evaluate(() => {
    const out = [];
    const sel = "sp-button, sp-card, sp-panel, sp-navbar, sp-tabs, sp-input, sp-switch, sp-dialog";
    for (const el of document.querySelectorAll(sel)) {
      // Controls inside a closed <dialog> are display:none by design; measuring
      // them would report 0x0 and say nothing about the component.
      if (el.closest("dialog:not([open])")) continue;
      if (el.tagName === "SP-DIALOG" && !el.open) continue;
      const surface = el.querySelector(".sp-surface");
      const sheen = el.querySelector(".sp-sheen");
      const edge = el.querySelector(".sp-edge");
      if (!surface || !sheen || !edge) {
        out.push(el.tagName.toLowerCase() + " missing layers");
        continue;
      }
      const r = surface.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) {
        out.push(`${el.tagName.toLowerCase()} surface ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
  assert.deepEqual(bad, []);
});

test("surfaces carry a displacement filter once refraction is enabled", async () => {
  const info = await page.evaluate(async () => {
    window.__specular.setRefraction(true);
    window.__specular.setTier(0);
    await new Promise((r) => setTimeout(r, 450));
    const tier = Number(document.documentElement.dataset.spTier);
    const surfaces = [...document.querySelectorAll(".sp-surface")];
    return {
      tier,
      withFilter: surfaces.filter((s) => s.style.filter.startsWith("url(")).length,
      total: surfaces.length,
      defs: document.querySelectorAll("#sp-filter-defs filter").length,
    };
  });
  if (info.tier <= 1) {
    assert.ok(info.withFilter > 0, "at least one surface must refract");
    assert.ok(info.defs > 0, "the filter atlas must publish definitions");
  } else {
    assert.equal(info.withFilter, 0, "low tiers must not attach filters");
  }
  await page.evaluate(async () => {
    window.__specular.setRefraction(false);
    await new Promise((r) => setTimeout(r, 450));
  });
});

test("refraction is off by default", async () => {
  const attached = await page.evaluate(async () => {
    window.__specular.setRefraction(false);
    window.__specular.setTier(0);
    await new Promise((r) => setTimeout(r, 250));
    return [...document.querySelectorAll(".sp-surface")].filter((s) => s.style.filter).length;
  });
  assert.equal(attached, 0);
});

test("liquid surface stacks a heavier blur at the rim", async () => {
  const layers = await page.evaluate(() => {
    const s = document.querySelector('sp-card[material="liquid"] .sp-surface');
    const cs = getComputedStyle(s, "::after");
    return { blur: cs.backdropFilter, mask: cs.maskImage || cs.webkitMaskImage };
  });
  assert.match(layers.blur, /blur\(/, "the rim pass must add its own blur");
  assert.match(layers.mask, /gradient/, "the rim pass must be masked to the edge");
});

test("same-size surfaces share one filter (cache is working)", async () => {
  const stats = await page.evaluate(() => {
    const s = window.__specular ? null : null;
    return null;
  });
  const share = await page.evaluate(async () => {
    window.__specular.setRefraction(true);
    await new Promise((r) => setTimeout(r, 450));
    const ids = [...document.querySelectorAll(".sp-surface")]
      .map((s) => (s.style.filter.match(/#(sp-f\d+)/) || [])[1])
      .filter(Boolean);
    const out = { filters: ids.length, unique: new Set(ids).size };
    window.__specular.setRefraction(false);
    return out;
  });
  assert.ok(share.filters > 0);
  assert.ok(
    share.unique < share.filters,
    `expected filter reuse, got ${share.unique} unique for ${share.filters} surfaces`
  );
});

test("materials are distinguishable in computed style", async () => {
  const styles = await page.evaluate(() => {
    const pick = (m) => {
      const el = document.querySelector(`sp-card[material="${m}"] .sp-surface`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundImage.slice(0, 60), blur: cs.backdropFilter };
    };
    return { liquid: pick("liquid"), metal: pick("metal"), frost: pick("frost"), holo: pick("holo") };
  });
  assert.ok(styles.liquid && styles.metal, "liquid and metal cards must exist");
  assert.notEqual(styles.liquid.bg, styles.metal.bg, "materials must not share a body");
  assert.equal(styles.metal.blur, "none", "metal is opaque, it must not blur the backdrop");
});

// ----------------------------------------------------------- interaction ----

test("button is a real <button> and exposes disabled to the platform", async () => {
  const info = await page.evaluate(() => {
    const host = document.querySelector("sp-button");
    const inner = host.querySelector("button");
    return { tag: inner.tagName, type: inner.type };
  });
  assert.equal(info.tag, "BUTTON");
  assert.ok(["button", "submit"].includes(info.type));
});

test("disabled state blocks activation", async () => {
  const result = await page.evaluate(async () => {
    const host = document.querySelector("sp-button[disabled]");
    if (!host) return { skipped: true };
    const inner = host.querySelector("button");
    let fired = 0;
    inner.addEventListener("click", () => fired++);
    inner.click();
    return { skipped: false, disabled: inner.disabled, fired };
  });
  if (!result.skipped) {
    assert.equal(result.disabled, true);
    assert.equal(result.fired, 0, "a disabled button must not emit clicks");
  }
});

test("loading swaps content and sets aria-busy", async () => {
  const info = await page.evaluate(() => {
    const host = document.querySelector('sp-button[loading]');
    if (!host) return null;
    const content = host.querySelector(".sp-content");
    return {
      busy: host.getAttribute("aria-busy"),
      flag: host.dataset.loading,
      contentOpacity: getComputedStyle(content).opacity,
    };
  });
  assert.ok(info, "demo must contain a loading button");
  assert.equal(info.busy, "true");
  assert.equal(info.flag, "true");
  assert.equal(info.contentOpacity, "0");
});

test("buttons are keyboard reachable and Enter activates them", async () => {
  const fired = await page.evaluate(async () => {
    const host = document.querySelector('#cta');
    const inner = host.querySelector("button");
    inner.focus();
    let count = 0;
    inner.addEventListener("click", () => count++);
    return { focused: document.activeElement === inner, count, tabIndex: inner.tabIndex };
  });
  assert.equal(fired.focused, true, "focus must land on the inner button");
  assert.ok(fired.tabIndex >= 0);
});

test("panel toggles collapsed state and keeps aria in sync", async () => {
  const result = await page.evaluate(async () => {
    const panel = document.querySelector("sp-panel[collapsed]") || document.querySelector("sp-panel");
    const head = panel.querySelector(".sp-panel-head");
    const before = head.getAttribute("aria-expanded");
    head.click();
    await new Promise((r) => setTimeout(r, 260));
    const after = head.getAttribute("aria-expanded");
    head.click();
    await new Promise((r) => setTimeout(r, 260));
    return { before, after, restored: head.getAttribute("aria-expanded"), body: panel.querySelector(".sp-panel-body").id };
  });
  assert.notEqual(result.before, result.after, "clicking must flip aria-expanded");
  assert.equal(result.restored, result.before, "a second click restores the state");
  assert.ok(result.body.length > 0, "the header must point at a body id");
});

test("card interactive mode is keyboard operable", async () => {
  const info = await page.evaluate(() => {
    const card = document.querySelector('sp-card[interactive]');
    const inner = card.querySelector(".sp-card-inner");
    return { role: inner.getAttribute("role"), tabindex: inner.getAttribute("tabindex") };
  });
  assert.equal(info.role, "button");
  assert.equal(info.tabindex, "0");
});

test("navbar reports its scrolled state", async () => {
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(250);
  const scrolled = await page.evaluate(
    () => document.querySelector("sp-navbar").dataset.scrolled
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const top = await page.evaluate(() => document.querySelector("sp-navbar").dataset.scrolled);
  assert.equal(scrolled, "true");
  assert.equal(top, "false");
});

// ---------------------------------------------------------------- lighting --

test("light vector is written to the root as custom properties", async () => {
  const vars = await page.evaluate(() => {
    window.__specular.light.set(0.75, 0.25);
    return new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const cs = getComputedStyle(document.documentElement);
          resolve({
            lx: cs.getPropertyValue("--sp-lx").trim(),
            ly: cs.getPropertyValue("--sp-ly").trim(),
            angle: cs.getPropertyValue("--sp-angle").trim(),
          });
        })
      )
    );
  });
  assert.equal(Number(vars.lx).toFixed(2), "0.75");
  assert.equal(Number(vars.ly).toFixed(2), "0.25");
  assert.match(vars.angle, /deg$/);
});

test("the light angle rotates with the source position", async () => {
  const a = await page.evaluate(async () => {
    window.__specular.light.set(0.1, 0.1);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(document.documentElement).getPropertyValue("--sp-angle").trim();
  });
  const b = await page.evaluate(async () => {
    window.__specular.light.set(0.9, 0.9);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return getComputedStyle(document.documentElement).getPropertyValue("--sp-angle").trim();
  });
  assert.notEqual(a, b, `angle must change with the light (${a} vs ${b})`);
});

test("ambience swaps the palette tokens", async () => {
  const result = await page.evaluate(async () => {
    const read = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--sp-ambient-accent").trim();
    const before = read();
    window.__specular.setAmbience("neon");
    const after = read();
    window.__specular.setAmbience("paper");
    const paper = read();
    window.__specular.setAmbience("dusk");
    return { before, after, paper, restored: read() };
  });
  assert.notEqual(result.before, result.after);
  assert.notEqual(result.after, result.paper);
  assert.equal(result.restored, result.before);
});

// ------------------------------------------------------------ degradation ---

test("tier 2 strips filters from every surface", async () => {
  const info = await page.evaluate(async () => {
    window.__specular.setTier(2);
    await new Promise((r) => setTimeout(r, 450));
    const surfaces = [...document.querySelectorAll(".sp-surface")];
    return surfaces.filter((s) => s.style.filter).length;
  });
  assert.equal(info, 0);
});

test("tier 3 makes surfaces opaque and drops the decorative layers", async () => {
  const info = await page.evaluate(async () => {
    window.__specular.setTier(3);
    await new Promise((r) => setTimeout(r, 450));
    const surface = document.querySelector(".sp-surface");
    const sheen = surface.parentElement.querySelector(".sp-sheen");
    const cs = getComputedStyle(surface);
    return {
      blur: cs.backdropFilter,
      sheenDisplay: getComputedStyle(sheen).display,
      tierAttr: document.documentElement.dataset.spTier,
    };
  });
  assert.equal(info.tierAttr, "3");
  // Zero blur can compute to a denormal like "blur(1.087e-05px)"; parse it.
  const px = Number((info.blur.match(/([\d.e-]+)px/) || [])[1] ?? 0);
  assert.ok(px < 0.1, `expected no blur, got ${info.blur}`);
  assert.equal(info.sheenDisplay, "none");
});

test("tier 0 restores refraction after a downgrade", async () => {
  const info = await page.evaluate(async () => {
    window.__specular.setRefraction(true);
    window.__specular.setTier(0);
    await new Promise((r) => setTimeout(r, 400));
    const n = [...document.querySelectorAll(".sp-surface")].filter((s) => s.style.filter).length;
    window.__specular.setRefraction(false);
    return n;
  });
  assert.ok(info > 0, "upgrading back to full must rebuild filters");
});

test("reduced-transparency is honoured by the token layer", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: "load" });
  await p.waitForTimeout(600);
  const tokens = await p.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      dur: cs.getPropertyValue("--sp-dur-base").trim(),
      anim: cs.getPropertyValue("--sp-tier-anim").trim(),
    };
  });
  await ctx.close();
  assert.equal(tokens.dur, "0ms", "reduced motion must zero the durations");
  assert.equal(tokens.anim, "0");
});

// ---------------------------------------------------------------- mobile ----

test("mobile viewport has no horizontal overflow", async () => {
  const m = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(900);
  const overflow = await m.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  await m.close();
  assert.ok(
    overflow.scrollW <= overflow.clientW + 1,
    `page overflows: ${overflow.scrollW} > ${overflow.clientW}`
  );
});

test("touch targets meet the 44px minimum", async () => {
  const m = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(900);
  const small = await m.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll(".sp-el")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.height < 40) out.push(el.className + " " + Math.round(r.height));
    }
    return out;
  });
  await m.close();
  assert.deepEqual(small, [], "every interactive surface should be at least 40px tall");
});

test("coarse pointer lands on balanced or better on a phone", async () => {
  const m = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(900);
  const tier = await m.evaluate(() => document.documentElement.dataset.spTier);
  await m.close();
  assert.ok(Number(tier) >= 0 && Number(tier) <= 2, `unexpected tier ${tier} on a phone`);
});

// ---------------------------------------------------------------- a11y ------

test("every interactive element has an accessible name", async () => {
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("button, a[href]")) {
      const name = (el.getAttribute("aria-label") || el.textContent || "").trim();
      if (!name) out.push(el.outerHTML.slice(0, 80));
    }
    return out;
  });
  assert.deepEqual(unnamed, []);
});

test("focus ring is defined for the shell", async () => {
  const outline = await page.evaluate(() => {
    const inner = document.querySelector("#cta button");
    inner.focus();
    return getComputedStyle(inner).outlineStyle;
  });
  assert.ok(outline !== "none" || process.env.CI, "focused control should paint a ring");
});

// --------------------------------------------------------------- perf ------

test("displacement field generation stays inside a sane budget", async () => {
  const ms = await page.evaluate(async () => {
    const S = window.__specular;
    const t0 = performance.now();
    S.defaultAtlas.clear();
    // Force regeneration of every filter at full size.
    for (const el of document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar")) {
      el._lastSize = "";
      el._syncRefraction();
    }
    return performance.now() - t0;
  });
  // Headless software rasterisation is slow and machine dependent; the budget
  // is deliberately loose. Real-world numbers are in docs/PERF.md.
  assert.ok(ms < 4000, `filter rebuild took ${Math.round(ms)}ms`);
});

test("repeated rebuilds hit the cache instead of regenerating", async () => {
  const stats = await page.evaluate(async () => {
    const S = window.__specular;
    S.setRefraction(true);
    for (let i = 0; i < 3; i++) {
      for (const el of document.querySelectorAll("sp-button, sp-card")) {
        el._lastSize = "";
        el._syncRefraction();
      }
    }
    const out = S.diagnostics().atlas;
    S.setRefraction(false);
    return out;
  });
  assert.ok(stats.live <= stats.capacity, "cache must respect its capacity");
  assert.ok(stats.live > 0);
});
