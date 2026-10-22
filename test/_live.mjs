import { createRequire } from "node:module";
const requirePw = createRequire("E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/");
const { chromium } = requirePw("playwright");
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto("https://llinok111.github.io/specular-ui/", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
const out = await p.evaluate(() => ({
  ready: document.documentElement.dataset.spReady,
  tier: document.documentElement.dataset.spTier,
  ambience: document.documentElement.dataset.spAmbience,
  components: document.querySelectorAll("sp-button, sp-card, sp-panel, sp-navbar").length,
  surfaces: document.querySelectorAll(".sp-surface").length,
  angle: getComputedStyle(document.documentElement).getPropertyValue("--sp-angle").trim(),
  h1: document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim(),
}));
console.log(JSON.stringify(out, null, 1));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await p.screenshot({ path: "shots/live.png" });
await b.close();
