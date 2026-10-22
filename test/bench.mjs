import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const requirePw = createRequire(
  process.env.PW_HOME || "E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/"
);
const { chromium } = requirePw("playwright");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--allow-file-access-from-files", "--enable-gpu-rasterization"],
});

const results = {};

for (const tier of [0, 1, 2, 3]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(pathToFileURL(path.resolve("demo/index.html")).href, { waitUntil: "load" });
  await page.waitForTimeout(600);
  await page.evaluate((t) => window.__specular.setTier(t), tier);
  await page.waitForTimeout(500);

  const m = await page.evaluate(async () => {
    // frame cadence over 90 frames while sweeping the light (the worst case:
    // every surface repaints each frame)
    const times = [];
    let last = performance.now();
    await new Promise((resolve) => {
      let n = 0;
      const tick = (ts) => {
        times.push(ts - last);
        last = ts;
        window.__specular.light.set(0.5 + 0.4 * Math.sin(n / 8), 0.4 + 0.3 * Math.cos(n / 9));
        if (++n < 90) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const sorted = times.slice(5).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    return {
      medianFrame: +median.toFixed(2),
      p95Frame: +p95.toFixed(2),
      fps: Math.round(1000 / median),
      nodes: document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar").length,
    };
  });
  results[tier] = m;
  await page.close();
}

// cold start on a fresh page, without the optional refraction path
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const t0 = Date.now();
await page.goto(pathToFileURL(path.resolve("demo/index.html")).href, { waitUntil: "load" });
const nav = Date.now() - t0;
await page.waitForTimeout(400);
const boot = await page.evaluate(() => {
  const nav = performance.getEntriesByType("navigation")[0];
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    load: Math.round(nav.loadEventEnd),
    ready: document.documentElement.dataset.spReady === "true",
  };
});
await page.close();
await browser.close();

console.log(JSON.stringify({ results, navMs: nav, boot }, null, 1));
