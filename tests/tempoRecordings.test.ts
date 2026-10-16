import { describe, it, expect } from "vitest";
import { evaluate, type EvalMetrics } from "./tempoEval/run.ts";
import { micChain } from "./tempoEval/micChain.ts";
import { loadRecordings } from "./tempoEval/recordings.ts";
import { hitGrid, roomStats } from "./tempoEval/room.ts";
import { SR, type Track } from "./tempoEval/synth.ts";

// The tempo scoreboard on real audio, next to tests/tempoEval.test.ts's
// synthetic one: the well-known songs clean (`tempo-tracks`), the same songs
// through micChain.ts's simulated room, and phone recordings of a real party
// (`mic-recordings`, made by tools/mic-recordings.py). Both sets live only in
// the main checkout's gitignored cache (tempoEval/recordings.ts), so
// everything here skips where they're absent, CI included. Run it with
// `npm run eval:tempo:real`.
//
// Two tables print, win or lose:
// - Tempo, on the fixed-hop path (solo mode): % right, time to the right
//   tempo, and the detector's hits per bar on and off the beat grid
//   (room.ts's hitGrid).
// - The room (room.ts's roomStats): level, the floor between hits, how fast
//   a hit fades, and the bass left. The simulated room is only worth tuning
//   against where its numbers sit near the party's.

const songs: Track[] = loadRecordings("tempo-tracks");
const party: Track[] = loadRecordings("mic-recordings");
const rows: { set: string; track: Track }[] = [
  ...songs.map((track) => ({ set: "clean", track })),
  ...songs.map((track) => ({ set: "sim room", track: { ...track, mono: micChain(track.mono, SR) } })),
  ...party.map((track) => ({ set: "party", track })),
];

const tempo: Record<string, EvalMetrics> = {};
const tempoTable: Record<string, Record<string, string>> = {};
const roomTable: Record<string, Record<string, string>> = {};
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "--");
for (const { set, track } of rows) {
  const key = `${set}: ${track.name}`;
  const m = evaluate(track, 60, { analyzer: true });
  tempo[key] = m;
  const grid = hitGrid(track.mono, track.tempo[0]!.bpm);
  tempoTable[key] = {
    bpm: String(track.tempo[0]!.bpm),
    "% right": fmt(m.tempoOk * 100, 0),
    "to tempo, s": fmt(m.timeToLockSec, 2),
    "hits/bar on beat": fmt(grid.onPerBar),
    "hits/bar off beat": fmt(grid.offPerBar),
  };
  const r = roomStats(track.mono);
  roomTable[key] = {
    "level, dBFS": fmt(r.levelDb),
    "floor below peaks, dB": fmt(r.floorDb),
    "hit fade, dB": fmt(r.fadeDb),
    "bass vs mid, dB": fmt(r.bassDb),
  };
}
if (rows.length) {
  // eslint-disable-next-line no-console
  console.log("Tempo on real audio (fixed-hop path, 60 fps)");
  // eslint-disable-next-line no-console
  console.table(tempoTable);
  // eslint-disable-next-line no-console
  console.log("The room");
  // eslint-disable-next-line no-console
  console.table(roomTable);
}

describe.skipIf(rows.length === 0)("tempo on real audio (local cache only)", () => {
  it("every recording was scored", () => {
    expect(Object.keys(tempo).length).toBe(rows.length);
  });
});
