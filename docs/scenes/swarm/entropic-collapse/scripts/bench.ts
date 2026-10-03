// node bench.ts [scatter=0.4] [bpm=128] [count=256] [secs=25]
// Runs the scene's sim the way the scene does (fixed 1/60 steps, beat-wave
// breath, a hit on every beat, the collapse ramp) and prints the shape and
// the neighbour-count spread of core vs rim particles.
import {
  createSwarm,
  stepSwarm,
  scatterPhases,
  collapseTrap,
  swarmMetrics,
  DEFAULT_SWARM_PARAMS,
} from "../../../../../src/render/scenes/swarm/swarmSim.ts";

const kv = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const scatter = +(kv.scatter ?? 0.4);
const bpm = +(kv.bpm ?? 128);
const count = +(kv.count ?? 256);
const secs = +(kv.secs ?? 25);
const reach = +(kv.reach ?? 90);
const p = { ...DEFAULT_SWARM_PARAMS };
for (const k of Object.keys(p)) if (kv[k] !== undefined) (p as Record<string, number>)[k] = +kv[k];
const s = createSwarm(count, 7);
const dt = 1 / 60;
const beat = 60 / bpm;
let nextHit = beat;
const coreRs: number[] = [];
for (let i = 0; i < secs * 60; i++) {
  const t = i * dt;
  const wave = 0.5 + 0.5 * Math.cos((2 * Math.PI * t) / beat);
  if (t >= nextHit) {
    scatterPhases(s, scatter);
    nextHit += beat;
  }
  stepSwarm(s, p, dt, wave, collapseTrap(t, 10));
  if (t > secs - 4) coreRs.push(swarmMetrics(s).coreR90);
}
const m = swarmMetrics(s);
const n = s.count;
let cx = 0;
let cy = 0;
for (let i = 0; i < n; i++) {
  cx += s.x[i];
  cy += s.y[i];
}
cx /= n;
cy /= n;
const deg = new Array(n).fill(0);
for (let i = 0; i < n; i++)
  for (let j = i + 1; j < n; j++) {
    const dx = s.x[j] - s.x[i];
    const dy = s.y[j] - s.y[i];
    if (dx * dx + dy * dy < reach * reach) {
      deg[i]++;
      deg[j]++;
    }
  }
const pct = (a: number[], q: number) => {
  const b = [...a].sort((x, y) => x - y);
  return b.length ? b[Math.floor((b.length - 1) * q)] : NaN;
};
const r = (i: number) => Math.hypot(s.x[i] - cx, s.y[i] - cy);
const idx = [...Array(n).keys()];
const outer = idx.filter((i) => r(i) > m.r90 * 0.85);
const inner = idx.filter((i) => r(i) < m.r90 * 0.5);
const f = (x: number) => x.toFixed(2);
console.log(
  `locked ${f(m.lockedShare)} R ${f(m.order)} r90 ${(m.r90 / 360).toFixed(2)} core90 now ${(m.coreR90 / 360).toFixed(2)}`,
  `core90 last4s p10/p90 ${(pct(coreRs, 0.1) / 360).toFixed(2)}/${(pct(coreRs, 0.9) / 360).toFixed(2)} (half-heights)`,
);
console.log(
  `deg inner p10/50/90 ${pct(inner.map((i) => deg[i]), 0.1)}/${pct(inner.map((i) => deg[i]), 0.5)}/${pct(inner.map((i) => deg[i]), 0.9)}`,
  `outer p10/50/90 ${pct(outer.map((i) => deg[i]), 0.1)}/${pct(outer.map((i) => deg[i]), 0.5)}/${pct(outer.map((i) => deg[i]), 0.9)}  n inner ${inner.length} outer ${outer.length}`,
);
