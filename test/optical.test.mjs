/**
 * Material audit — does each material render as a distinct optical stack, and
 * what does the whole thing cost?
 *
 * The pixel-level proof that `backdrop-filter` reaches the page background, and
 * the measurement showing why the SVG displacement path is opt-in, are in
 * docs/LIMITS.md. This file asserts the layer structure that produces the look,
 * so a CSS refactor that silently drops the rim pass fails loudly.
 *
 *   node --test test/optical.test.mjs
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

const blurOf = (value) => Number((String(value).match(/blur\(([\d.e-]+)px\)/) || [])[1] ?? 0);

before(async () => {
  browser = await chromium.launch({
    executablePath: CHROME,
    headless: !process.env.HEADED,
    args: ["--allow-file-access-from-files"],
  });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(PAGE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
});

after(async () => {
  await browser?.close();
});

test("every material resolves to a distinct optical signature", async () => {
  const sig = await page.evaluate(() => {
    const read = (m) => {
      const el = document.querySelector(`sp-card[material="${m}"] .sp-surface`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, "::after");
      return {
        body: cs.backgroundImage.slice(0, 40),
        blur: cs.backdropFilter,
        rim: after.backdropFilter,
        rimMask: (after.maskImage || after.webkitMaskImage || "none").slice(0, 24),
      };
    };
    return { liquid: read("liquid"), metal: read("metal"), frost: read("frost"), holo: read("holo") };
  });

  for (const [name, s] of Object.entries(sig)) assert.ok(s, `${name} card missing`);

  // Metal is an opaque alloy: it must never blur what is behind it.
  assert.equal(sig.metal.blur, "none");
  assert.notEqual(sig.metal.body, sig.liquid.body);

  // Liquid carries a second, heavier blur pass masked to the rim.
  assert.ok(blurOf(sig.liquid.rim) > 0, `no rim pass: ${sig.liquid.rim}`);
  assert.match(sig.liquid.rimMask, /gradient/);

  // Frost blurs harder than liquid at the body level and adds grain instead.
  assert.ok(
    blurOf(sig.frost.blur) > blurOf(sig.liquid.blur),
    `frost ${sig.frost.blur} should exceed liquid ${sig.liquid.blur}`
  );

  // Holographic film has its own substrate.
  assert.notEqual(sig.holo.body, sig.liquid.body);
});

test("the one light reaches every material", async () => {
  const probe = await page.evaluate(async () => {
    const read = () =>
      getComputedStyle(document.documentElement).getPropertyValue("--sp-angle").trim();
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__specular.light.set(0.1, 0.1);
    await settle();
    const a = read();
    window.__specular.light.set(0.9, 0.1);
    await settle();
    return { a, b: read() };
  });
  assert.notEqual(probe.a, probe.b, "azimuth must follow the pointer");

  // Metal's anisotropic band is a conic gradient built from that azimuth, so it
  // must repaint when the light moves. This is the end-to-end proof of the
  // "single light" premise.
  const band = await page.evaluate(async () => {
    const el = document.querySelector('sp-card[material="metal"] .sp-aniso');
    if (!el) return null;
    const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__specular.light.set(0.05, 0.2);
    await settle();
    const a = getComputedStyle(el).backgroundImage;
    window.__specular.light.set(0.95, 0.8);
    await settle();
    return { a, b: getComputedStyle(el).backgroundImage };
  });
  assert.ok(band, "metal anisotropy layer must exist");
  assert.notEqual(band.a, band.b, "anisotropy band must rotate with the light");
});

test("the static tier removes the blur passes", async () => {
  const result = await page.evaluate(async () => {
    const el = () => document.querySelector('sp-card[material="liquid"] .sp-surface');
    window.__specular.setTier(3);
    await new Promise((r) => setTimeout(r, 450));
    const low = getComputedStyle(el()).backdropFilter;
    window.__specular.setTier(0);
    await new Promise((r) => setTimeout(r, 450));
    return { low, high: getComputedStyle(el()).backdropFilter };
  });
  assert.ok(blurOf(result.low) < 0.1, `static tier still blurs: ${result.low}`);
  assert.ok(blurOf(result.high) > 1, "full tier must blur the backdrop");
});

test("optional refraction builds within budget and hits its cache", async () => {
  const report = await page.evaluate(async () => {
    const S = window.__specular;
    S.setRefraction(true);
    const surfaces = [...document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar")];
    S.defaultAtlas.clear();

    const t0 = performance.now();
    for (const el of surfaces) {
      el._lastSize = "";
      el._syncRefraction();
    }
    const cold = performance.now() - t0;

    const before = S.diagnostics().atlas;
    const t1 = performance.now();
    for (let i = 0; i < 4; i++) {
      for (const el of surfaces) {
        el._lastSize = "";
        el._syncRefraction();
      }
    }
    const warm = (performance.now() - t1) / 4;
    const after = S.diagnostics().atlas;
    S.setRefraction(false);
    return { surfaces: surfaces.length, cold, warm, hits: after.hits - before.hits };
  });

  console.log(
    `  ${report.surfaces} surfaces · cold ${report.cold.toFixed(0)}ms · ` +
      `cached ${report.warm.toFixed(1)}ms/pass · hits ${report.hits}`
  );
  assert.ok(report.cold < 3000, `cold build too slow: ${report.cold.toFixed(0)}ms`);
  assert.ok(report.warm < report.cold, "cached passes must be cheaper");
  assert.ok(report.hits > 0, "repeat passes must hit the cache");
});

test("light updates are coalesced", async () => {
  const writes = await page.evaluate(async () => {
    const S = window.__specular;
    let n = 0;
    const target = document.documentElement;
    const original = target.style.setProperty.bind(target.style);
    target.style.setProperty = (k, v) => {
      if (k === "--sp-lx") n++;
      return original(k, v);
    };
    for (let i = 0; i < 40; i++) S.light.set(0.5, 0.5);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    target.style.setProperty = original;
    return n;
  });
  console.log(`  root writes for 40 identical requests: ${writes}`);
  assert.ok(writes <= 2, `coalescing failed: ${writes} writes`);
});
