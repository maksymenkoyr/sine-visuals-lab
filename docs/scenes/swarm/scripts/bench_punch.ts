// node bench_punch.ts [release=0.8] [decay=6] [scatter=0.4] [bpm=129]
// Settles the swarm 20 s with a bass hit on every beat (a scatter, plus the
// core's attraction released by `release` and recovering at `decay`/s), then
// prints the crowded core's median radius (half-heights) every 50 ms over two
// beats -- how far one hit can move the core in the physics. Answer
// (2026-10-03): barely, inside a beat; hence Thump and Beat flash are drawn.
import {
  createSwarm,
  stepSwarm,
  scatterPhases,
  collapseTrap,
  swarmMetrics,
  DEFAULT_SWARM_PARAMS,
} from "../../../../src/render/scenes/swarm/swarmSim.ts";

const kv = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")));
const release = +(kv.release ?? 0.8);
const decay = +(kv.decay ?? 6);
const scatter = +(kv.scatter ?? 0.4);
const bpm = +(kv.bpm ?? 129);
const s = createSwarm(256, 7);
const p = { ...DEFAULT_SWARM_PARAMS };
const dt = 1 / 60;
const beat = 60 / bpm;
let next = beat;
let lastHit = -10;
const trace: string[] = [];
// Median radius (half-heights) of the crowded particles (> 40 neighbours
// within 90 world units) -- the white core the eye sees.
function coreR50(): number {
  const n = s.count;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += s.x[i]; cy += s.y[i]; }
  cx /= n; cy /= n;
  const rs: number[] = [];
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let j = 0; j < n; j++) {
      const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i];
      if (dx * dx + dy * dy < 8100) d++;
    }
    if (d > 40) rs.push(Math.hypot(s.x[i] - cx, s.y[i] - cy));
  }
  rs.sort((a, b) => a - b);
  return rs.length ? rs[Math.floor(rs.length / 2)] / 360 : NaN;
}
const total = 20 + 2 * beat;
for (let i = 0; i < total * 60; i++) {
  const t = i * dt;
  const b = t / beat;
  const wave = 0.5 + 0.5 * Math.cos(Math.PI * b);
  if (t >= next) {
    scatterPhases(s, scatter);
    lastHit = t;
    next += beat;
  }
  const pulse = Math.exp(-(t - lastHit) * decay);
  p.attract = DEFAULT_SWARM_PARAMS.attract * (1 - release * pulse);
  stepSwarm(s, p, dt, wave, collapseTrap(t, 10));
  if (t > 20 && i % 3 === 0) {
    trace.push(`${((t - 20) * 1000).toFixed(0)}ms:${coreR50().toFixed(3)}`);
  }
}
const m = swarmMetrics(s);
console.log(`release ${release} decay ${decay}: locked ${m.lockedShare.toFixed(2)} r90 ${(m.r90 / 360).toFixed(2)}`);
console.log(trace.join(" "));
