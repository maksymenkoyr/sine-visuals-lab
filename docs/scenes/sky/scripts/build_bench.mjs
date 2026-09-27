// Sky: builds the Sky tuning bench artifact, one self-contained HTML page.
// Bundles sky-bench/sim-entry.ts (the scene's real fluid solver) with esbuild
// and inlines it where sky-bench/bench.html says /*SKY_SIM_BUNDLE*/.
// The page's display shader is a hand port of sky.ts's sky and cloud passes,
// so re-check it against buildDisplayFrag after changing either.
// usage: node docs/scenes/sky/scripts/build_bench.mjs <out.html>
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = process.argv[2];
if (!out) {
  console.error("usage: node build_bench.mjs <out.html>");
  process.exit(1);
}
const dir = fileURLToPath(new URL("../artifacts/sky-bench/", import.meta.url));
const bundle = await build({
  entryPoints: [dir + "sim-entry.ts"],
  bundle: true,
  format: "iife",
  target: "es2017",
  minify: true,
  write: false,
});
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const page = readFileSync(dir + "bench.html", "utf8");
if (!page.includes("/*SKY_SIM_BUNDLE*/")) throw new Error("bench.html has no /*SKY_SIM_BUNDLE*/ slot");
writeFileSync(out, page.replace("/*SKY_SIM_BUNDLE*/", () => js));
console.log(`${out} (${(js.length / 1024).toFixed(1)} KB sim bundle)`);
