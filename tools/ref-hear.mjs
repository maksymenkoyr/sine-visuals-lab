#!/usr/bin/env node
// Records what *our* analyser hears on a ref bundle's audio: plays the
// bundle's audio.wav into the app as the microphone (tools/ref-browser.mjs)
// and samples window.__viz.probe() every animation frame for the clip's
// length, writing <bundle>/hears.json. tools/ref-scan.py --hear joins it to
// the reference's beat grid so every finding in report.md can say whether
// the runtime (src/audio/features.ts + render/beatClock.ts) actually sees
// the trigger the reference reacts to.
//
//   node tools/ref-hear.mjs tools/.cache/refs/<name> [--port 5173] [--scene spectrum] [--quality high]
//
// The scene doesn't matter — the probe's audio fields are the same on every
// scene — so the default is the cheapest one to render. Fields recorded per
// sample, straight from ProbeSnapshot (src/tuning/probe.ts): t (bundle
// seconds), onset (beat.fired), bpm, phase (beatPhase), low/mid/high/energy,
// section (sectionIntensity), drop (dropPulse), centroid. probe() reads the
// last frame's objects and doesn't consume anything, so sampling at rAF
// rate sees every onset the renderer saw — but not more often than the
// render loop runs, which is why a 60 fps sample can still miss an onset
// that fired and cleared inside one throttled frame.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { launchWithMic, openScene } from "./ref-browser.mjs";

const args = process.argv.slice(2);
const bundleDir = args.find((a) => !a.startsWith("--"));
if (!bundleDir) {
  console.error("usage: node tools/ref-hear.mjs <bundleDir> [--port P] [--scene id] [--quality Q]");
  process.exit(2);
}
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const scene = opt("--scene", "spectrum");
const quality = opt("--quality", "high");
const bundle = resolve(bundleDir);
const meta = JSON.parse(readFileSync(join(bundle, "audio.json"), "utf8"));
if (!meta.hasAudio) {
  console.error("ref-hear: bundle has no audio — nothing to hear");
  process.exit(1);
}
const durMs = meta.dur * 1000 + 300;

const { browser, ctx } = await launchWithMic(join(bundle, "audio.wav"));
const page = await openScene(ctx, { port, scene, quality });
console.log(`${basename(bundle)}: hearing ${meta.dur.toFixed(1)}s through ${scene} on :${port}`);

const samples = await page.evaluate(
  (durMs) =>
    new Promise((done) => {
      const out = [];
      const tick = () => {
        const t = (performance.now() - window.__micT0) / 1000;
        const p = window.__viz?.probe?.();
        if (p) {
          out.push([
            +t.toFixed(4), p.beat.fired ? 1 : 0, +p.beat.bpm.toFixed(2), +p.beat.phase.toFixed(3),
            +p.bands.low.toFixed(3), +p.bands.mid.toFixed(3), +p.bands.high.toFixed(3), +p.bands.energy.toFixed(3),
            +p.section.toFixed(3), +p.drop.toFixed(3), +p.centroid.toFixed(3),
          ]);
        }
        if (t * 1000 < durMs) requestAnimationFrame(tick);
        else done(out);
      };
      tick();
    }),
  durMs,
);
await browser.close();

const onsets = samples.filter((s) => s[1]).length;
const bpms = samples.map((s) => s[2]).filter((b) => b > 0);
writeFileSync(
  join(bundle, "hears.json"),
  JSON.stringify({
    bundle: basename(bundle), scene, port: +port,
    columns: ["t", "onset", "bpm", "phase", "low", "mid", "high", "energy", "section", "drop", "centroid"],
    samples,
  }),
);
console.log(`wrote hears.json: ${samples.length} samples, ${onsets} onsets, bpm ${bpms.length ? Math.min(...bpms).toFixed(0) + ".." + Math.max(...bpms).toFixed(0) : "never locked"} (reference ${meta.tempo.toFixed(1)})`);
console.log("REF_HEAR_OK");
