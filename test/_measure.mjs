import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const requirePw = createRequire("E:/WorkBuddy-Work/workbuddy-github-2/gridstack-studio/");
const { chromium } = requirePw("playwright");
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--allow-file-access-from-files"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.goto(pathToFileURL(path.resolve("demo/index.html")).href, { waitUntil: "load" });
await p.waitForTimeout(1100);
for (const sel of ["#materials .grid-4", "#components .grid-2", "#controls .grid-2"]) {
  await p.evaluate((s) => document.querySelector(s).scrollIntoView(), sel);
  await p.waitForTimeout(350);
  const boxes = await p.evaluate((s) => {
    const grid = document.querySelector(s);
    const gr = grid.getBoundingClientRect();
    const kids = [...grid.children].map((c) => {
      const r = c.getBoundingClientRect();
      return { tag: c.tagName.toLowerCase(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    return { grid: { x: Math.round(gr.x), y: Math.round(gr.y), w: Math.round(gr.width), h: Math.round(gr.height) }, viewportH: innerHeight, kids };
  }, sel);
  console.log(sel, JSON.stringify(boxes));
}
await b.close();
