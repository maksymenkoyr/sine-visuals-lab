// node docs/scenes/alien/scripts/pacecheck.mjs
// Alien's one pace from the shipped code: per dance (slowest first) its
// captured tempo and loop, the moves pace.ts counts in it, the pace it keeps as
// captured, and the stretch reel.ts plays it at to keep DANCE_PACE_HZ; "limit"
// marks a dance held at PACE_STRETCH_MAX.
import { readFileSync } from "node:fs";
const src = (p) => new URL(`../../../../src/render/scenes/${p}`, import.meta.url).pathname;
const { CLIP_LIBRARY_URL, decodeClipLibrary } = await import(src("dancers/clipFormat.ts"));
const { danceMoves } = await import(src("alien/pace.ts"));
const { DANCE_PACE_HZ, LOOPS, PACE_STRETCH_MAX, clipSeconds, pacedSeconds } = await import(src("alien/reel.ts"));

const bin = readFileSync(new URL(`../../../../public${CLIP_LIBRARY_URL}`, import.meta.url));
const lib = decodeClipLibrary(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const t0 = performance.now();
const rows = LOOPS.map((l) => {
  const clip = lib.byName.get(l.clip);
  const captured = clipSeconds(clip);
  const moves = danceMoves(clip);
  const paced = pacedSeconds(captured, moves);
  return { dance: l.dance, bpm: clip.nativeBpm, captured, moves, pace: moves / captured, stretch: captured / paced, paced };
});
const ms = performance.now() - t0;
console.log("dance           bpm    captured  moves  pace as captured  stretch  loop at speed 1");
for (const r of [...rows].sort((a, b) => a.pace - b.pace)) {
  const limit = Math.abs(Math.log(r.stretch)) >= Math.log(PACE_STRETCH_MAX) - 1e-9 ? "  limit" : "";
  console.log(
    `${r.dance.padEnd(14)} ${r.bpm.toFixed(1).padStart(5)}  ${r.captured.toFixed(2).padStart(6)} s  ${r.moves.toFixed(2).padStart(5)}  ${r.pace.toFixed(2).padStart(9)} /s     ×${r.stretch.toFixed(2)}  ${r.paced.toFixed(2).padStart(6)} s${limit}`,
  );
}
const logs = rows.map((r) => Math.log2(r.pace));
const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
const sd = Math.sqrt(logs.reduce((a, b) => a + (b - mean) ** 2, 0) / logs.length);
console.log(`\nDANCE_PACE_HZ ${DANCE_PACE_HZ}; the dances' geometric mean pace as captured ${(2 ** mean).toFixed(3)} /s, spread (sd of log2) ${sd.toFixed(2)}`);
console.log(`measured ${rows.length} dances in ${ms.toFixed(1)} ms`);
