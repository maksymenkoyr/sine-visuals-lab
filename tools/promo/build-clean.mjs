#!/usr/bin/env node
// Builds the app the way a promo should show it: a production build (no
// dev-only labels), on the stable channel (no Insiders badge), and WITHOUT the
// gitignored src/render/scenes/private/ checkout, so no paid scene appears in
// the gallery. The folder is moved aside for the build and put back after,
// even on failure. Output goes outside the repo.
//
//   node tools/promo/build-clean.mjs [outDir=/tmp/promo-dist]
//   npx vite preview --outDir /tmp/promo-dist --port 4173 --strictPort   # https, like dev
//   node tools/promo/capture.mjs ... --port 4173
import { existsSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] || "/tmp/promo-dist");
const priv = resolve("src/render/scenes/private");
const aside = priv + ".promo-aside";
const moved = existsSync(priv);
if (moved) renameSync(priv, aside);
try {
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"], { stdio: "inherit", env: { ...process.env, SVL_CHANNEL: "stable" } });
} finally {
  if (moved) renameSync(aside, priv);
}
console.log(`built ${outDir} without private scenes`);
