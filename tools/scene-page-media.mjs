#!/usr/bin/env node
// Films the media a public scene page shows (tools/scenePagesLib.mjs's
// header): public/scenes/<id>/still-<date>.jpg, also the page's OG image, and
// loop-<date>.mp4, a short silent clip that loops without a seam. Older
// stills and loops of that scene are removed: a page fetches its media when
// it loads, so no open tab can still be waiting for an old name.
//
//   node tools/scene-page-media.mjs <sceneId>... --wav <song.wav>
//        [--from 30] [--seconds 8] [--still-at 4] [--port 4179]
//
// The scene hears the song through the fake mic from --from seconds on, in a
// production build without paid scenes (tools/promo/build-clean.mjs) served by
// `vite preview`, recorded by tools/promo/capture.mjs on the Metal GPU. The
// clip is OG-sized; the loop is scaled down and its last second fades into
// its first, so the cut never shows. Pick --from on a busy part of the song:
// the page is the scene's advert.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ffmpeg } from "./promo/ffmpeg.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const valued = new Set(["--wav", "--from", "--seconds", "--still-at", "--port"]);
const scenes = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
const wav = opt("--wav", null);
const from = +opt("--from", "30");
const seconds = +opt("--seconds", "8");
const stillAt = +opt("--still-at", "4");
const port = opt("--port", "4179");
if (!scenes.length || !wav) {
  console.error("usage: node tools/scene-page-media.mjs <sceneId>... --wav <song.wav> [--from S] [--seconds N] [--still-at S] [--port P]");
  process.exit(2);
}

// The page's frame is the OG image's size; the loop plays at most ~920 CSS px
// wide (the page's column), so it is stored smaller.
const SIZE = "1200x630";
const LOOP_SIZE = "960:504";
const FADE = 1;
// Dropped from the clip's start: the app's buttons show for a moment after
// the mic starts, and a growing scene (Physarum 2) needs a few beats to
// fill the screen.
const LEAD = 6;
// Measured on Caustics, the busiest picture: CRF 30 made a 3 MB loop.
const CRF = 34;
const date = new Date().toISOString().slice(0, 10);
const work = mkdtempSync(join(tmpdir(), "scene-page-media-"));
const dist = join(work, "dist");
const vite = join("node_modules", "vite", "bin", "vite.js");

execFileSync(process.execPath, ["tools/promo/build-clean.mjs", dist], { stdio: "inherit" });
// Chromium's fake mic plays only 48 kHz mono 16-bit (tools/promo/capture.mjs).
const mic = join(work, "song.wav");
ffmpeg(["-i", wav, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", mic]);

const preview = spawn(process.execPath, [vite, "preview", "--outDir", dist, "--port", port, "--strictPort"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((resolve, reject) => {
  preview.stdout.on("data", (d) => String(d).includes(port) && resolve(undefined));
  preview.on("exit", (code) => reject(new Error(`vite preview exited (${code})`)));
});

try {
  for (const id of scenes) {
    const clip = join(work, `${id}.mp4`);
    execFileSync(
      process.execPath,
      ["tools/promo/capture.mjs", mic, "--scene", id, "--out", clip, "--size", SIZE, "--chrome", "none", "--wav-start", String(from), "--seconds", String(LEAD + seconds + FADE), "--port", port],
      { stdio: "inherit" },
    );
    const dir = join("public", "scenes", id);
    mkdirSync(dir, { recursive: true });
    for (const old of readdirSync(dir).filter((f) => /^(still|loop)-/.test(f))) rmSync(join(dir, old));
    // Seconds LEAD+FADE..end, whose last FADE seconds dissolve into
    // LEAD..LEAD+FADE: the loop's end frame is the frame before its first.
    ffmpeg([
      "-i", clip, "-an",
      "-filter_complex",
      // xfade needs a constant frame rate on both inputs, which the clip's
      // stream doesn't declare; it has to come after setpts.
      `[0:v]split[a][b];[a]trim=start=${LEAD + FADE},setpts=PTS-STARTPTS,fps=30[body];[b]trim=start=${LEAD}:end=${LEAD + FADE},setpts=PTS-STARTPTS,fps=30[head];` +
        `[body][head]xfade=transition=fade:duration=${FADE}:offset=${seconds - FADE},scale=${LOOP_SIZE}[v]`,
      "-map", "[v]", "-c:v", "libx264", "-preset", "slow", "-crf", String(CRF), "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      join(dir, `loop-${date}.mp4`),
    ]);
    ffmpeg(["-ss", String(LEAD + stillAt), "-i", clip, "-frames:v", "1", "-q:v", "3", join(dir, `still-${date}.jpg`)]);
    console.log(`${id}: ${dir}/still-${date}.jpg, loop-${date}.mp4`);
  }
} finally {
  preview.kill();
  if (existsSync(work)) rmSync(work, { recursive: true, force: true });
}
