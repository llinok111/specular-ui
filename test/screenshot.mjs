import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Playwright lives in a sibling workspace on this machine; resolve it explicitly
// so this repo keeps zero runtime test dependencies.
const require = createRequire(process.env.PW_HOME || "E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/");
const { chromium } = require("playwright");

const page_ = process.argv[2] || "test/probe.html";
const out = process.argv[3] || "shots/probe.png";
const width = Number(process.argv[4] || 1280);
const height = Number(process.argv[5] || 720);

const CHROME =
  process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const url = pathToFileURL(path.resolve(process.cwd(), page_)).href;
const browser = await chromium.launch({
  executablePath: CHROME,
  args: ["--allow-file-access-from-files"],
});
const page = await browser.newPage({
  viewport: { width, height },
  deviceScaleFactor: 2,
});
const logs = [];
page.on("console", (m) => logs.push(m.type() + ": " + m.text()));
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(1600);

const info = await page.evaluate(() => ({
  tier: document.documentElement.dataset.spTier,
  ready: document.documentElement.dataset.spReady,
  governor: document.documentElement.dataset.spGovernor || null,
  filters: document.documentElement.dataset.filters,
  diag: window.__diag ? window.__diag() : null,
  scrollH: document.body.scrollHeight,
}));

console.log(JSON.stringify(info, null, 2));
console.log("LOGS:", logs.join(" | ") || "(none)");

await page.screenshot({ path: out, fullPage: false });
await browser.close();
