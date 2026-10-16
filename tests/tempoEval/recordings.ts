import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SR, type Track } from "./synth.ts";

/**
 * The real-audio sets in the main checkout's gitignored tools/.cache, loaded
 * as tempoEval Tracks: `tempo-tracks` (well-known songs, clean, cut from
 * their published audio) and `mic-recordings` (phone videos of a real party,
 * made by tools/mic-recordings.py). Each recording is
 * <set>/<slug>/{audio.wav,meta.json}: mono 16-bit audio at synth.ts's SR,
 * and a meta.json whose `bpm` is the true tempo. A recording without a
 * `bpm` is skipped. Real audio has no scripted beat times, so a Track built
 * here is one tempo segment over the whole file with empty `beats`: only
 * the tempo metrics mean anything.
 *
 * The cache lives only on the machine that made it (private recordings of
 * copyrighted music), so a missing set loads as an empty list and
 * tests/tempoRecordings.test.ts skips.
 */

export type RecordingSet = "tempo-tracks" | "mic-recordings";

export function cacheDir(set: RecordingSet): string {
  // The main checkout, not a worktree: the cache outlives worktrees.
  let root: string;
  try {
    root = join(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim(), "..");
  } catch {
    return "";
  }
  return join(root, "tools", ".cache", set);
}

/** A mono 16-bit PCM WAV's samples, skipping any chunk before `data` (ffmpeg writes a LIST chunk). */
export function readWav(path: string): Float32Array {
  const b = readFileSync(path);
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const len = b.readUInt32LE(p + 4);
    if (id === "fmt ") {
      const channels = b.readUInt16LE(p + 10);
      const rate = b.readUInt32LE(p + 12);
      const bits = b.readUInt16LE(p + 22);
      if (channels !== 1 || rate !== SR || bits !== 16) throw new Error(`${path}: need mono 16-bit ${SR} Hz`);
    }
    if (id === "data") {
      const n = Math.floor(Math.min(len, b.length - p - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + 2 * i) / 32768;
      return out;
    }
    p += 8 + len + (len & 1);
  }
  throw new Error(`${path}: no data chunk`);
}

export function loadRecordings(set: RecordingSet): Track[] {
  const dir = cacheDir(set);
  if (!dir || !existsSync(dir)) return [];
  const tracks: Track[] = [];
  for (const slug of readdirSync(dir).sort()) {
    const metaPath = join(dir, slug, "meta.json");
    const wavPath = join(dir, slug, "audio.wav");
    if (!existsSync(metaPath) || !existsSync(wavPath)) continue;
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as { bpm?: number | null };
    if (!meta.bpm) continue;
    const mono = readWav(wavPath);
    tracks.push({ name: slug, mono, tempo: [{ from: 0, to: mono.length / SR, bpm: meta.bpm }], beats: [], gridBeats: [] });
  }
  return tracks;
}
