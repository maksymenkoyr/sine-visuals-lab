// node react_shots.mjs <bundleDir> <outDir> [--port 5190] [--from 8] [--to 24] [--settings JSON]
// Plays a /ref bundle's audio.wav into the swarm scene as the mic and takes
// screenshots back to back between --from and --to seconds of bundle time,
// writing shots.json (file, bundle ms) for react_score.py.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchWithMic, openScene } from "../../../../tools/ref-browser.mjs";

const args = process.argv.slice(2);
const [bundle, out] = args;
const opt = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("port", "5190");
const from = +opt("from", "8") * 1000;
const to = +opt("to", "24") * 1000;
const settings = opt("settings", "");
mkdirSync(out, { recursive: true });
const { browser, ctx } = await launchWithMic(join(bundle, "audio.wav"), { width: 960, height: 540 });
const page = await openScene(ctx, { port, scene: "swarm" });
if (settings) await page.evaluate((s) => window.__viz.setParams({ scene: "swarm", autoPin: true, settings: JSON.parse(s) }), settings);
const now = () => page.evaluate(() => performance.now() - window.__micT0);
while ((await now()) < from) await page.waitForTimeout(50);
const shots = [];
let i = 0;
for (;;) {
  const t0 = await now();
  if (t0 > to) break;
  const file = `s${String(i++).padStart(4, "0")}.png`;
  await page.screenshot({ path: join(out, file) });
  const t1 = await now();
  shots.push({ file, ms: (t0 + t1) / 2 });
}
writeFileSync(join(out, "shots.json"), JSON.stringify(shots));
console.log(`${shots.length} shots, ${(shots.length / ((to - from) / 1000)).toFixed(1)} per second`);
await browser.close();
