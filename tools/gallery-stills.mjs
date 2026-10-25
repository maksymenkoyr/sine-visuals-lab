#!/usr/bin/env node
// Writes src/ui/stills/<sceneId>.webp: the still picture a gallery tile shows
// at rest, read by src/ui/galleryStills.ts (the tile only plays its live
// preview while the pointer is on it; src/ui/gallery.ts).
//
// Run it from /release, before the release PR (.claude/commands/release.md),
// and on request for a scene whose look changed. The output is committed; no
// build runs it, and CI can't (no GPU there, and software WebGL draws some
// scenes differently or black).
//
//   npm run gallery-stills [-- id,id] [--at S] [--port P] [--base URL]
//
// Starts its own dev server on --port (default 5299), or uses the one at
// --base. Each scene gets a fresh browser context on synthetic audio at
// STILL_W x STILL_H with the app's chrome hidden, waits --at seconds (a
// growing scene needs a few beats to fill the screen; AT_BY_SCENE overrides
// that per scene), and shoots it. With no id list it shoots every free scene
// and deletes the stills of scenes that no longer exist.
//
// Paid scenes are never shot, and naming one is an error: its picture would
// land in this public repo (CLAUDE.md).
//
// Chromium runs on the real GPU (as tools/master-sweep.mjs does), not
// SwiftShader, so the picture is the one a visitor sees.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "src/ui/stills");

// Must equal PREVIEW_W / PREVIEW_H in src/ui/gallery.ts: the tile draws its
// live canvas at that size, so a still of another size would jump on swap.
const STILL_W = 480;
const STILL_H = 270;
const STILL_QUALITY = 0.8;
const DEFAULT_AT_S = 10;
const BPM = 120;
/** Scenes whose default moment is dark, empty or mid-transition get their own. */
const AT_BY_SCENE = {};

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5299");
const baseArg = opt("--base", null);
const atArg = opt("--at", null);
const idsArg = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const base = (baseArg ?? `https://localhost:${port}`).replace(/\/$/, "");

if (atArg !== null && !(Number(atArg) >= 0)) {
  console.error(`gallery-stills: --at must be seconds, got "${atArg}"`);
  process.exit(2);
}

function answers(url) {
  return new Promise((res) => {
    const req = request(url, { rejectUnauthorized: false, timeout: 2000 }, (r) => {
      r.resume();
      res(true);
    });
    req.on("error", () => res(false));
    req.on("timeout", () => {
      req.destroy();
      res(false);
    });
    req.end();
  });
}

async function startServer() {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", port, "--strictPort"], {
    cwd: ROOT,
    stdio: "ignore",
  });
  child.on("error", (e) => console.error(`gallery-stills: dev server failed to start: ${e.message}`));
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`dev server exited with code ${child.exitCode} (port ${port} busy?)`);
    if (await answers(`${base}/`)) return child;
    await new Promise((r) => setTimeout(r, 500));
  }
  child.kill();
  throw new Error("dev server did not answer within 60 s");
}

const server = baseArg ? null : await startServer();
let browser = null;
let failed = false;
try {
  browser = await chromium.launch({
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

  const bootCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: STILL_W, height: STILL_H } });
  const bootPage = await bootCtx.newPage();
  await bootPage.goto(`${base}/?audio=synthetic&bpm=${BPM}`, { waitUntil: "load", timeout: 60000 });
  await bootPage.waitForFunction(() => typeof window.__viz !== "undefined", null, { timeout: 20000 });
  const allScenes = await bootPage.evaluate(() => window.__viz.scenes());
  await bootCtx.close();

  let ids;
  if (idsArg) {
    ids = idsArg.split(",").map((s) => s.trim()).filter(Boolean);
    for (const id of ids) {
      const meta = allScenes.find((s) => s.id === id);
      if (!meta) throw new Error(`unknown scene id "${id}"`);
      if (meta.paid) throw new Error(`"${id}" is a paid scene: its picture must never land in this public repo`);
    }
  } else {
    ids = allScenes.filter((s) => !s.paid).map((s) => s.id);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  let totalKb = 0;
  for (const id of ids) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: STILL_W, height: STILL_H },
      deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${base}/?audio=synthetic&bpm=${BPM}&quality=high#/v/${id}`, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => typeof window.__viz !== "undefined", null, { timeout: 20000 });
      // The cursor overlay hangs off <html>, outside body.
      await page.addStyleTag({ content: "body > :not(canvas), #__cur { visibility: hidden !important; }" });
      const atS = atArg !== null ? Number(atArg) : (AT_BY_SCENE[id] ?? DEFAULT_AT_S);
      await page.waitForTimeout(atS * 1000);
      const probe = await page.evaluate(() => window.__viz.probe());
      if (probe?.scene && probe.scene !== id) {
        throw new Error(`rendered scene is "${probe.scene}", not "${id}": it likely failed to compile`);
      }
      const png = await page.screenshot({ type: "png" });
      const webpBase64 = await page.evaluate(
        async ({ b64, quality }) => {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          canvas.getContext("2d").drawImage(bitmap, 0, 0);
          const blob = await canvas.convertToBlob({ type: "image/webp", quality });
          const out = new Uint8Array(await blob.arrayBuffer());
          let s = "";
          for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
          return btoa(s);
        },
        { b64: png.toString("base64"), quality: STILL_QUALITY },
      );
      const webp = Buffer.from(webpBase64, "base64");
      writeFileSync(join(OUT_DIR, `${id}.webp`), webp);
      totalKb += webp.length / 1024;
      console.log(`${id}  ${(webp.length / 1024).toFixed(1)} kB`);
    } catch (err) {
      failed = true;
      console.error(`${id}  ERROR: ${err?.message ?? err}`);
    } finally {
      await context.close();
    }
  }
  console.log(`gallery-stills: ${ids.length} scene(s), ${totalKb.toFixed(1)} kB`);

  if (!idsArg) {
    const free = new Set(ids);
    for (const f of readdirSync(OUT_DIR)) {
      if (f.endsWith(".webp") && !free.has(f.slice(0, -".webp".length))) {
        unlinkSync(join(OUT_DIR, f));
        console.log(`removed ${f} (not a free scene any more)`);
      }
    }
  }
} catch (err) {
  failed = true;
  console.error(`gallery-stills: ${err?.message ?? err}`);
} finally {
  await browser?.close();
  server?.kill();
}
process.exit(failed ? 1 : 0);
