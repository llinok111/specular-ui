/**
 * Solve for the lightest (dark ambience) or darkest (light ambience) ink value
 * that still clears a contrast target against every page step.
 *
 *   node scripts/solve-ink.mjs
 *
 * Prints suggested hex values; it does not edit tokens.css.
 */

import { readFile } from "node:fs/promises";

const raw = await readFile("src/styles/tokens.css", "utf8");
// Strip comments first: a comment inside a block would otherwise swallow the
// declaration that follows it, because the parser splits on semicolons.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
const TARGET = 4.8; // 4.5 AA + margin for the glass tint

function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars = {};
  for (const line of css.slice(open + 1, close).split(";")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

const hex = (h) => {
  const v = h.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
};
const toHex = (rgb) =>
  "#" + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");

const lum = ([r, g, b]) => {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const la = lum(a);
  const lb = lum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
const over = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const AMB = ["dusk", "studio", "neon", "paper"];
const PAGES = ["--sp-page-1", "--sp-page-2", "--sp-page-3"];

function solve(startHex, targets, direction) {
  const base = hex(startHex);
  // direction +1 = lighten (dark ambience), -1 = darken (light ambience)
  let best = base.slice();
  for (let step = 0; step <= 100; step++) {
    const k = (step / 100) * (direction > 0 ? 1 : 1);
    const candidate = base.map((c) =>
      direction > 0 ? c + (255 - c) * k : c * (1 - k)
    );
    const ok = targets.every((bg) => ratio(candidate, bg) >= TARGET);
    if (ok) {
      best = candidate;
      break;
    }
  }
  return toHex(best);
}

for (const name of AMB) {
  const v = block(`[data-sp-ambience="${name}"]`);
  const tint = hex(v["--sp-ambient-tint"]);
  const bgs = [];
  for (const p of PAGES) {
    const bg = hex(v[p]);
    bgs.push(bg, over(tint, bg, 0.4));
  }
  const isLight = name === "paper";
  for (const ink of ["--sp-ink-2", "--sp-ink-3"]) {
    const current = v[ink];
    const currentMin = Math.min(...bgs.map((bg) => ratio(hex(current), bg)));
    if (currentMin >= TARGET) {
      console.log(`${name.padEnd(7)} ${ink}  ${current}  ok ${currentMin.toFixed(2)}:1`);
      continue;
    }
    const solved = solve(current, bgs, isLight ? -1 : 1);
    const solvedMin = Math.min(...bgs.map((bg) => ratio(hex(solved), bg)));
    console.log(
      `${name.padEnd(7)} ${ink}  ${current} (${currentMin.toFixed(2)})  →  ${solved} (${solvedMin.toFixed(2)})`
    );
  }
}
