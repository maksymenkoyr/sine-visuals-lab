#!/usr/bin/env node
// Headless calibration sweep for the Master card's Picture block
// (src/render/pictureMeter.ts) and the Scale dial it measures
// (src/render/sceneSettings.ts's getSceneMaster): for every scene, at every
// --values master amount, opens the scene on synthetic audio, lets it settle,
// then averages the same five picture measures (Brightness/Colour/Motion/
// Detail/Flashes) the live panel shows — the numbers this file exists to
// produce are what calibrates PICTURE_MEASURES' provisional `fullScale`
// constants (pictureMeter.ts's own header names this file for exactly that).
//
//   node tools/master-sweep.mjs [--port 5173] [--scenes all|featured|id,id]
//        [--values 0,0.25,0.5,0.75,1,1.25,1.5,1.75,2] [--bpm 120]
//        [--settle 4000] [--window 5000] [--size 1280x720] [--out DIR]
//        [--include-paid] [--report-only path/to/sweep.json]
//
// The dev server must already be running (`npm run dev`) — this tool only
// drives a browser against it, the same division of labour as tune-ab.mjs
// and ref-shoot.mjs.
//
// --scenes: "all" is every scene __viz.scenes() reports except paid ones
// (add --include-paid to measure those too); "featured" additionally drops
// drafts; an explicit id list is taken as given, with a warning for any paid
// scene named that way. Paid scenes are the ones checked out under
// src/render/scenes/private/ (see scenes/index.ts's PAID_SCENE_IDS) — never
// commit or publish a sweep.json, publish.html or index.html that measured
// one; that data describes a scene that doesn't belong in this public repo
// at all, the same rule CLAUDE.md states for its code and screenshots.
//
// One fresh browser context per (scene, value), not one page reused across
// values: synthetic audio (src/audio/synthetic.ts) is deterministic in wall-
// clock time from the moment it starts, so every value has to start it fresh
// to be measured over the exact same stretch of the exact same track: reusing
// a page would either replay a stateful scene's own build-up (its trail,
// its population, its accumulated phase) into the next value's measurement,
// or measure two different stretches of the track for two different values.
//
// Chromium is launched with real GPU rendering (--use-angle=metal, not
// SwiftShader's software path some other tools here use): SwiftShader
// renders at roughly 13 fps on this kind of scene, which is slower than
// PICTURE_SAMPLE_INTERVAL_MS's own 15 Hz — a render that slow would starve
// Motion of most of the frame-to-frame changes it's supposed to measure, and
// every scene would read falsely calm.
//
// Output goes to tools/.cache/master-sweep/<YYYY-MM-DD_HHMM>/ by default
// (tools/.cache is gitignored) or --out DIR: sweep.json (written after every
// scene, so a crash still leaves whatever finished measured), plus a report
// built from tools/master-sweep-report.html if that template exists yet —
// see writeReport() below for why it comes out as two files.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

const port = opt("--port", "5173");
const scenesArg = opt("--scenes", "all");
const valuesArg = opt("--values", "0,0.25,0.5,0.75,1,1.25,1.5,1.75,2");
const bpm = Number(opt("--bpm", "120"));
const settleMs = Number(opt("--settle", "4000"));
const windowMs = Number(opt("--window", "5000"));
const sizeArg = opt("--size", "1280x720");
const includePaid = args.includes("--include-paid");
const reportOnlyPath = opt("--report-only", null);
const outArg = opt("--out", null);

const sizeMatch = /^(\d+)x(\d+)$/.exec(sizeArg);
if (!sizeMatch) {
  console.error(`master-sweep: --size must be WxH (e.g. 1280x720), got "${sizeArg}"`);
  process.exit(2);
}
const width = Number(sizeMatch[1]);
const height = Number(sizeMatch[2]);

const values = valuesArg.split(",").map((s) => Number(s.trim()));
if (values.length === 0 || values.some((v) => !Number.isFinite(v))) {
  console.error(`master-sweep: --values must be a comma list of numbers, got "${valuesArg}"`);
  process.exit(2);
}

/** `tools/.cache/master-sweep/<YYYY-MM-DD_HHMM>/` — sortable by name, and
 *  fine-grained enough that two sweeps started a minute apart never collide. */
function timestampDir() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function gitHead() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: HERE }).toString().trim();
  } catch {
    return null;
  }
}

/** tools/master-sweep-report.html is a fragment (it starts with <title> and
 *  <style>, no <!doctype>/<html>/<head>/<body> — the same shape a claude.ai
 *  Artifact publish call expects to wrap itself, so it can supply its own
 *  page skeleton). This writes it twice: publish.html is that filled
 *  fragment exactly as-is, for handing to Artifact publishing; index.html
 *  wraps the same fragment in a minimal document so it also opens directly
 *  in a browser from disk. Returns index.html's path, or null if the
 *  template doesn't exist yet (skipped with a message, not an error — the
 *  sweep.json this sits beside is still useful on its own). */
function writeReport(outDir, data) {
  const templatePath = resolve(HERE, "master-sweep-report.html");
  if (!existsSync(templatePath)) {
    console.log(`master-sweep: ${templatePath} doesn't exist yet — skipping the report (sweep.json is still written)`);
    return null;
  }
  const template = readFileSync(templatePath, "utf8");
  const placeholder = "__SWEEP_DATA__";
  // The template's own header comment names this placeholder too (so a
  // reader knows what fills it), which makes it the *first* match in the
  // file — the real one, inside the <script id="sweep-data"> tag, is the
  // last. Splicing at lastIndexOf targets that one regardless of how the
  // comment is worded, where a plain String.replace() (first match only)
  // would silently inject the data into the comment and leave the real slot
  // as literal text the report page can't JSON.parse().
  const idx = template.lastIndexOf(placeholder);
  if (idx === -1) {
    console.error(`master-sweep: ${templatePath} has no ${placeholder} placeholder — can't inject data`);
    return null;
  }
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const filled = template.slice(0, idx) + json + template.slice(idx + placeholder.length);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "publish.html"), filled);
  const indexHtml =
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n` +
    filled +
    `\n</body>\n</html>\n`;
  const indexPath = join(outDir, "index.html");
  writeFileSync(indexPath, indexHtml);
  return indexPath;
}

// --report-only: rebuild the report next to an existing sweep.json, no
// browser involved.
if (reportOnlyPath) {
  const jsonPath = resolve(reportOnlyPath);
  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const reportPath = writeReport(dirname(jsonPath), data);
  if (reportPath) console.log(`master-sweep: report at ${reportPath}`);
  process.exit(0);
}

/** "all"/"featured"/an explicit id list, resolved against __viz.scenes()'s
 *  own id/name/draft/paid — see the file header for what each means. */
function resolveSceneIds(allScenes) {
  if (scenesArg === "all") return allScenes.filter((s) => includePaid || !s.paid).map((s) => s.id);
  if (scenesArg === "featured") return allScenes.filter((s) => !s.draft && !s.paid).map((s) => s.id);
  const ids = scenesArg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    const meta = allScenes.find((s) => s.id === id);
    if (!meta) console.error(`master-sweep: unknown scene id "${id}" — not in __viz.scenes()`);
    else if (meta.paid && !includePaid) {
      console.warn(`master-sweep: "${id}" is a paid scene, measuring it because it was named explicitly — see the file header: never commit or publish this run's output`);
    }
  }
  return ids;
}

const abbrev = { brightness: "bright", colour: "colour", motion: "motion", detail: "detail", flashes: "flash" };

/** `caustics  m=1.00  bright 0.231 colour 0.412 motion 0.031 detail 0.144
 *  flash 0.052  (75 samples, 60 fps)` — one line per point, printed as the
 *  sweep runs so a long run is legible before sweep.json even lands. */
function formatPoint(sceneId, point, measures) {
  const parts = measures.map((m) => {
    const v = point.mean ? point.mean[m.key] : null;
    return `${abbrev[m.key] ?? m.key} ${v === null || v === undefined ? "--" : v.toFixed(3)}`;
  });
  const fps = point.fps === null || point.fps === undefined ? "--" : Math.round(point.fps);
  let line = `${sceneId}  m=${point.master.toFixed(2)}  ${parts.join(" ")}  (${point.samples} samples, ${fps} fps)`;
  if (point.error) line += `  ERROR: ${point.error}`;
  return line;
}

/** One (scene, master value) point: a fresh context (see the file header for
 *  why fresh), the master pinned via localStorage before the app ever reads
 *  it, `settleMs` to let the scene's own build-up pass, pictureReset() to
 *  start the mean clean, then `windowMs` of averaging. `probe().scene !==
 *  sceneId` means the scene failed to compile and the app fell back to
 *  whatever was previously mounted — recorded as this point's error rather
 *  than silently measuring the wrong scene. */
async function measurePoint(browser, sceneId, value) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
  const consoleErrors = [];
  await context.addInitScript((v) => {
    try {
      localStorage.setItem("vibe.sceneMaster", String(v));
    } catch {
      // Private-mode localStorage, or similar — the app's own loadMaster()
      // falls back to the identity default, same as a real user would see.
    }
  }, value);
  try {
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    const url = `https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/${sceneId}`;
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForFunction(() => typeof window.__viz !== "undefined", null, { timeout: 20000 });
    await page.evaluate(() => window.__viz.clearPins());
    await page.evaluate(() => window.__viz.pictureForce(true));
    await page.waitForTimeout(settleMs);
    await page.evaluate(() => window.__viz.pictureReset());
    await page.waitForTimeout(windowMs);
    const [picture, probe] = await Promise.all([page.evaluate(() => window.__viz.picture()), page.evaluate(() => window.__viz.probe())]);
    const point = { master: value, mean: picture.mean, samples: picture.samples, fps: probe?.fps ?? null };
    if (probe?.scene && probe.scene !== sceneId) {
      point.error = `rendered scene is "${probe.scene}", not "${sceneId}" — it likely failed to compile and the app fell back`;
    }
    if (consoleErrors.length) point.consoleErrors = consoleErrors.slice(0, 3);
    return point;
  } catch (err) {
    return { master: value, mean: null, samples: 0, fps: null, error: String(err?.message ?? err), consoleErrors: consoleErrors.slice(0, 3) };
  } finally {
    await context.close();
  }
}

const outDir = resolve(outArg ?? join("tools/.cache/master-sweep", timestampDir()));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: "chromium",
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-gpu",
    "--use-angle=metal",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});

console.log(`master-sweep: discovering scenes via https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/caustics ...`);
const bootCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width, height } });
const bootPage = await bootCtx.newPage();
await bootPage.goto(`https://localhost:${port}/?audio=synthetic&bpm=${bpm}#/v/caustics`, { waitUntil: "load", timeout: 60000 });
await bootPage.waitForFunction(() => typeof window.__viz !== "undefined", null, { timeout: 20000 });
const allScenes = await bootPage.evaluate(() => window.__viz.scenes());
const measures = await bootPage.evaluate(() => window.__viz.pictureMeasures());
await bootCtx.close();

const sceneIds = resolveSceneIds(allScenes);
if (sceneIds.length === 0) {
  console.error(`master-sweep: no scenes matched --scenes ${scenesArg}`);
  await browser.close();
  process.exit(1);
}
console.log(`master-sweep: sweeping ${sceneIds.length} scene(s) × ${values.length} value(s) → ${outDir}`);

const data = {
  generated: new Date().toISOString(),
  gitHead: gitHead(),
  bpm,
  settleMs,
  windowMs,
  size: `${width}x${height}`,
  values,
  measures,
  scenes: [],
};

for (const id of sceneIds) {
  const meta = allScenes.find((s) => s.id === id);
  const points = [];
  for (const value of values) {
    const point = await measurePoint(browser, id, value);
    points.push(point);
    console.log(formatPoint(id, point, measures));
  }
  data.scenes.push({ id, name: meta?.name ?? id, draft: meta?.draft ?? false, points });
  // After every scene, not just at the end — a crash partway through a long
  // sweep still leaves whatever finished on disk.
  writeFileSync(join(outDir, "sweep.json"), JSON.stringify(data, null, 1));
}

await browser.close();

console.log(`master-sweep: wrote ${join(outDir, "sweep.json")}`);
const reportPath = writeReport(outDir, data);
if (reportPath) console.log(`master-sweep: report at ${reportPath}`);
