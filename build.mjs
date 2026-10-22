/**
 * specular-ui build
 *
 *   node build.mjs            bundle JS (esm + cjs) and CSS into dist/, then
 *                             mirror the bundles into demo/ so the page works
 *                             from file:// and from GitHub Pages without a
 *                             second build step.
 *   node build.mjs --report   also print bundle sizes and gzip deltas
 */

import { build } from "esbuild";
import { mkdir, copyFile, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const demo = path.join(root, "demo");

async function ensure(dir) {
  await mkdir(dir, { recursive: true });
}

async function main() {
  const report = process.argv.includes("--report");
  await ensure(dist);
  await ensure(demo);

  const shared = {
    bundle: true,
    target: ["chrome100", "safari15.4", "firefox100"],
    legalComments: "eof",
    logLevel: "warning",
  };

  await build({
    ...shared,
    entryPoints: [path.join(root, "src/specular.js")],
    outfile: path.join(dist, "specular-ui.js"),
    format: "esm",
    sourcemap: true,
    minify: false,
  });

  await build({
    ...shared,
    entryPoints: [path.join(root, "src/specular.js")],
    outfile: path.join(dist, "specular-ui.cjs"),
    format: "cjs",
    minify: true,
  });

  await build({
    ...shared,
    entryPoints: [path.join(root, "src/styles/index.css")],
    outfile: path.join(dist, "specular-ui.css"),
    loader: { ".css": "css" },
  });

  // Mirror into demo/ so the page is self-contained when opened from disk.
  for (const file of ["specular-ui.js", "specular-ui.css", "specular-ui.js.map"]) {
    const from = path.join(dist, file);
    if (existsSync(from)) await copyFile(from, path.join(demo, file));
  }

  if (report) {
    const rows = [];
    for (const file of ["specular-ui.js", "specular-ui.css", "specular-ui.cjs"]) {
      const p = path.join(dist, file);
      const buf = await readFile(p);
      rows.push({
        file,
        raw: (buf.length / 1024).toFixed(1) + " KB",
        gzip: (gzipSync(buf).length / 1024).toFixed(1) + " KB",
      });
    }
    console.table(rows);
  }

  console.log("build ok →", path.relative(root, dist));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
