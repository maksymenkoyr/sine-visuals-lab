// tools/gpu-bench.mjs's --dump with Caustics' stored settings seeded first, so a variant (Prism, Run, spot rings, Rainbow) can be
// pixel-compared between two dev servers (`node tools/gpu-bench.mjs --compare a.rgba b.rgba`). Same frame index = same picture.
// node docs/scenes/caustics/scripts/settings-bench-dump.mjs --port P --out DIR --name NAME --settings '{"sparkleFx":2}' [--frames 30,75]
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i === -1 ? d : args[i + 1];
};
const frames = get("frames", "30,75");
const out = get("out", ".");
const q = new URLSearchParams({ scenes: "caustics", w: "960", h: "540", frames: "1", dump: frames });
const browser = await chromium.launch({
  channel: "chromium",
  args: ["--enable-gpu", "--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.addInitScript((s) => localStorage.setItem("vibe.sceneSettings", JSON.stringify({ caustics: s })), JSON.parse(get("settings", "{}")));
  await page.goto(`https://localhost:${get("port", "5173")}/tools/gpu-bench/index.html?${q}`);
  await page.waitForFunction(() => window.__bench, null, { timeout: 180_000 });
  const r = await page.evaluate(() => window.__bench);
  if (r.error) throw new Error(r.error);
  mkdirSync(out, { recursive: true });
  const at = frames.split(",");
  for (const s of r.results) s.shots.forEach((b64, k) => {
    const file = join(out, `${get("name", "v")}-${at[k]}.rgba`);
    writeFileSync(file, Buffer.from(b64, "base64"));
    console.log(file);
  });
} finally {
  await browser.close();
}
