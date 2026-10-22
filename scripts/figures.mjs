/**
 * Build the README figures.
 *
 * Everything here is captured from the real demo page — no mockups. Each figure
 * is cropped from a live browser render at 2x, then downsampled to WebP so the
 * README stays light enough to load on a phone.
 *
 *   node scripts/figures.mjs
 */

import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir, rm, readdir } from "node:fs/promises";

const requireLocal = createRequire(import.meta.url);
const requirePw = createRequire(
  process.env.PW_HOME || "E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/"
);
const { chromium } = requirePw("playwright");
const sharp = requireLocal("sharp");

const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = pathToFileURL(path.resolve("demo/index.html")).href;
const RAW = "docs/img/_raw";
const OUT = "docs/img";

await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--allow-file-access-from-files"],
});

/* ---------------------------------------------------------------- helpers -- */

async function open(viewport, scale = 2) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(1100);
  // Freeze the light so every figure is lit the same way; a drifting highlight
  // would make two captures of the same component look like different builds.
  await page.evaluate(() => {
    window.__specular.light.set(0.28, 0.22);
    window.__specular.light.lock(true);
  });
  await page.waitForTimeout(350);
  return page;
}

async function sectionBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y + window.scrollY)),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  }, selector);
}

async function shot(page, name, clip) {
  const file = path.join(RAW, `${name}.png`);
  await page.screenshot({ path: file, fullPage: !clip, clip });
  return file;
}

async function toWebp(src, dest, width, quality = 84) {
  await sharp(src)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality, effort: 6 })
    .toFile(path.join(OUT, dest));
  const meta = await sharp(path.join(OUT, dest)).metadata();
  console.log(`  ${dest}  ${meta.width}x${meta.height}  ${Math.round(meta.size / 1024)} KB`);
}

/* ----------------------------------------------------------------- figures -- */

const desktop = await open({ width: 1440, height: 900 });

// 1. Hero — the headline plus the first row of material buttons.
await toWebp(await shot(desktop, "hero", { x: 0, y: 0, width: 1440, height: 880 }), "hero.webp", 1200);

// 2. Material matrix — four cards, one per material.
const matBox = await sectionBox(desktop, "#materials");
await desktop.evaluate(() => document.querySelector("#materials").scrollIntoView());
await desktop.waitForTimeout(500);
const matClip = await desktop.evaluate(() => {
  const el = document.querySelector("#materials .grid-4");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x) - 10, y: Math.round(r.y) - 10, width: Math.round(r.width) + 20, height: Math.round(r.height) + 20 };
});
await toWebp(await shot(desktop, "materials", matClip), "materials.webp", 1200);

// 3. Components — buttons, panels, cards.
await desktop.evaluate(() => document.querySelector("#components").scrollIntoView());
await desktop.waitForTimeout(600);
const compClip = await desktop.evaluate(() => {
  const el = document.querySelector("#components .grid-2");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x) - 10, y: Math.round(r.y) - 10, width: Math.round(r.width) + 20, height: Math.min(760, Math.round(r.height)) + 20 };
});
await toWebp(await shot(desktop, "components", compClip), "components.webp", 1200);

// 4. Controls — tabs, input, switch.
await desktop.evaluate(() => document.querySelector("#controls").scrollIntoView());
await desktop.waitForTimeout(600);
const ctrlClip = await desktop.evaluate(() => {
  const el = document.querySelector("#controls .grid-2");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x) - 10, y: Math.round(r.y) - 10, width: Math.round(r.width) + 20, height: Math.round(r.height) + 20 };
});
await toWebp(await shot(desktop, "controls", ctrlClip), "controls.webp", 1100);

// 5. Four ambiences, same component row, stitched into one strip so the
//    difference between them is comparable rather than remembered.
const ambiences = [
  ["dusk", "黄昏"],
  ["studio", "影棚"],
  ["neon", "霓虹"],
  ["paper", "纸本"],
];
const tiles = [];
for (const [id] of ambiences) {
  await desktop.evaluate((a) => window.__specular.setAmbience(a), id);
  await desktop.evaluate(() => document.querySelector("#materials").scrollIntoView());
  await desktop.waitForTimeout(520);
  const clip = await desktop.evaluate(() => {
    const el = document.querySelector("#materials .grid-4");
    const r = el.getBoundingClientRect();
    // Just the top row of two cards, so the strip stays legible at README width.
    return { x: Math.round(r.x) - 8, y: Math.round(r.y) - 8, width: Math.round(r.width / 2) + 16, height: 300 };
  });
  const file = await shot(desktop, `amb-${id}`, clip);
  const buf = await sharp(file)
    .resize({ width: 600 })
    .toBuffer();
  tiles.push(buf);
}
await desktop.evaluate(() => window.__specular.setAmbience("dusk"));
await desktop.close();

const tileMeta = await sharp(tiles[0]).metadata();
await sharp({
  create: {
    width: 600 * 4 + 12 * 3,
    height: tileMeta.height,
    channels: 3,
    background: { r: 12, g: 10, b: 8 },
  },
})
  .composite(tiles.map((input, i) => ({ input, left: i * (600 + 12), top: 0 })))
  .webp({ quality: 84, effort: 6 })
  .toFile(path.join(OUT, "ambiences.webp"));
const ambMeta = await sharp(path.join(OUT, "ambiences.webp")).metadata();
console.log(`  ambiences.webp  ${ambMeta.width}x${ambMeta.height}  ${Math.round(ambMeta.size / 1024)} KB`);

// 6. Mobile — the same page at 390px, to show the controls actually reflow.
const mobile = await open({ width: 390, height: 844 }, 2);
await toWebp(await shot(mobile, "mobile", { x: 0, y: 0, width: 390, height: 780 }), "mobile.webp", 460);
await mobile.close();

await browser.close();
await rm(RAW, { recursive: true, force: true });

const files = (await readdir(OUT)).filter((f) => f.endsWith(".webp"));
const sizes = await Promise.all(
  files.map(async (f) => (await sharp(path.join(OUT, f)).metadata()).size)
);
console.log(`\n${files.length} figures · total ${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024)} KB`);
