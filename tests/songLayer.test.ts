// The song layer (src/audio/song/songLayer.ts) driven the way the app drives it: the engine and the layer get the same
// 128-sample quanta, then one read each per frame with the same dt. That the readings equal audio v6's is checked
// against the bench, outside this repo (docs/audio-engine.md says how); these tests hold what a scene may rely on.

import { describe, expect, it } from "vitest";
import { AudioEngine } from "../src/audio/engine/engine.ts";
import { SongLayer, type SongMarks } from "../src/audio/song/songLayer.ts";
import type { SongFrame } from "../src/audio/types.ts";
import { addHat, addKick, concat, groove, SR, silence } from "./engine/signals.ts";

interface Row {
  t: number;
  song: SongFrame;
  marks: SongMarks;
}

/** Every frame's reading copied out, at `fps`. */
function drive(x: Float32Array, fps = 60): Row[] {
  const engine = new AudioEngine(SR);
  const layer = new SongLayer(SR);
  const rows: Row[] = [];
  let pushed = 0;
  const n = Math.floor((x.length / SR) * fps);
  for (let k = 1; k <= n; k++) {
    const t = k / fps;
    while (pushed + 128 <= t * SR) {
      const quantum = x.subarray(pushed, pushed + 128);
      engine.push(quantum, pushed / SR);
      layer.push(quantum, pushed / SR);
      pushed += 128;
    }
    const reading = engine.read(1 / fps);
    rows.push({ t, song: { ...layer.read(t, 1 / fps, reading) }, marks: { ...layer.marks } });
  }
  return rows;
}

/** A kick on every beat and hats between them for `playS` seconds, then silence. */
function clickTrain(playS: number, silenceS: number): Float32Array {
  return concat(groove(playS, 128), silence(silenceS));
}

const edges = (rows: Row[], from: number, to: number, key: "kick" | "clap" | "hat" | "chord") =>
  rows.filter((r) => r.t >= from && r.t < to && r.song[key]).length;

describe("song layer", () => {
  const rows = drive(clickTrain(40, 20));

  it("a steady kick train fires kick once the window has history, and stops in silence", () => {
    expect(edges(rows, 0, 1, "kick")).toBe(0);
    expect(edges(rows, 5, 40, "kick")).toBeGreaterThan(10);
    expect(edges(rows, 44, 60, "kick")).toBe(0);
  });

  it("every level stays in 0..1", () => {
    const levels = ["clapLevel", "hatLevel", "chordLevel", "keys", "loudness", "dropLevel", "playing"] as const;
    for (const r of rows) {
      for (const k of levels) {
        expect(r.song[k]).toBeGreaterThanOrEqual(0);
        expect(r.song[k]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("playing follows the music in and out", () => {
    expect(rows[Math.round(30 * 60)].song.playing).toBeGreaterThan(0.5);
    expect(rows[rows.length - 1].song.playing).toBeLessThan(0.5);
  });

  it("the marks are NaN at the start and finite later", () => {
    for (const k of ["kick", "clap", "hat", "chord"] as const) {
      expect(rows[0].marks[k]).toBeNaN();
      expect(rows[Math.round(30 * 60)].marks[k]).toBeGreaterThanOrEqual(0);
      expect(rows[Math.round(30 * 60)].marks[k]).toBeLessThanOrEqual(1);
    }
  });

  it("a second layer built after the first starts from a fresh state", () => {
    const x = concat(silence(1), groove(12, 120), silence(3));
    const a = drive(x);
    const b = drive(x);
    expect(b).toEqual(a);
  });

  it("the module state of a layer that heard loud music does not leak into the next", () => {
    const loud = new Float32Array(SR * 6);
    for (let k = 0; k < 8; k++) addKick(loud, 0.5 + k * 0.5, 0.9, k + 1);
    for (let k = 0; k < 8; k++) addHat(loud, 0.75 + k * 0.5, 0.5, k + 9);
    const quiet = concat(silence(1), groove(8, 100));
    const alone = drive(quiet);
    drive(loud);
    expect(drive(quiet)).toEqual(alone);
  });
});
