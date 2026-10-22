/**
 * Contrast audit — does every ink token clear WCAG AA against its own page?
 *
 * Glass is the hardest case for text: the surface is semi-transparent, so the
 * effective background is "page + tint", and the darkest ink can end up within
 * a few percent of it. This computes the real ratios from the token values in
 * tokens.css rather than eyeballing them.
 *
 *   node scripts/contrast.mjs
 */

import { readFile } from "node:fs/promises";

const raw = await readFile("src/styles/tokens.css", "utf8");
// Strip comments first: a comment inside a block would otherwise swallow the
// declaration that follows it, because the parser splits on semicolons.
const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

/** Pull `--name: value;` pairs out of a CSS block. */
function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) return null;
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const body = css.slice(open + 1, close);
  const vars = {};
  for (const line of body.split(";")) {
    const m = line.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/);
    if (m) vars[m[1]] = m[2];
  }
  return vars;
}

function parseHex(hex) {
  const h = hex.trim();
  if (!h.startsWith("#")) return null;
  let v = h.slice(1);
  if (v.length === 3) v = v.split("").map((c) => c + c).join("");
  if (v.length !== 6) return null;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** WCAG relative luminance. */
function luminance([r, g, b]) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend a source colour at `alpha` over a backdrop, in sRGB. */
function over(fg, bg, alpha) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)));
}

const ambiences = ["dusk", "studio", "neon", "paper"];
const inks = ["--sp-ink-1", "--sp-ink-2", "--sp-ink-3"];
// Two backdrops matter: the page itself, and the glass tinted over it.
const tintAlpha = 0.4; // effective, after the tint + sheen layers

const rows = [];
let worst = { name: "", ratio: 99 };

for (const name of ambiences) {
  const v = block(`[data-sp-ambience="${name}"]`);
  if (!v) {
    console.log(`missing ambience ${name}`);
    continue;
  }
  const tint = parseHex(v["--sp-ambient-tint"]);
  for (const page of ["--sp-page-1", "--sp-page-2", "--sp-page-3"]) {
    const bg = parseHex(v[page]);
    if (!bg) continue;
    const glass = over(tint, bg, tintAlpha);
    for (const ink of inks) {
      const fg = parseHex(v[ink]);
      if (!fg) continue;
      const onPage = ratio(fg, bg);
      const onGlass = ratio(fg, glass);
      const min = Math.min(onPage, onGlass);
      rows.push({ ambience: name, page: page.replace("--sp-page-", "p"), ink: ink.replace("--sp-ink-", "ink"), onPage: +onPage.toFixed(2), onGlass: +onGlass.toFixed(2) });
      if (min < worst.ratio) worst = { name: `${name} ${ink} on ${page}`, ratio: min };
    }
  }
}

console.table(rows.filter((r) => r.page === "p2"));

const fails = rows.filter((r) => Math.min(r.onPage, r.onGlass) < 4.5);
console.log(`\nentries below AA (4.5:1): ${fails.length} / ${rows.length}`);
if (fails.length) {
  console.table(fails);
}
console.log(`worst: ${worst.name} = ${worst.ratio.toFixed(2)}:1`);

// ink-3 is the muted-label token; it is allowed to sit at 3:1 only if it is
// never used for body copy. Everything else must clear 4.5.
const ink3 = rows.filter((r) => r.ink === "ink3");
const ink3Min = Math.min(...ink3.map((r) => Math.min(r.onPage, r.onGlass)));
console.log(`ink-3 floor: ${ink3Min.toFixed(2)}:1 ${ink3Min >= 4.5 ? "(AA)" : ink3Min >= 3 ? "(AA large only)" : "(FAIL)"}`);
