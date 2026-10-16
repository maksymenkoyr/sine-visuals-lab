// Where the sand freezes, drifts and snaps: a CPU port of chladni.ts SIM_FRAG
// at WEIGHT_REF (every weight factor 1) and the zones' identity remap, stepped
// at a steady drive D on four two-mode figures from a scattered bed. Prints,
// per drive, how far grains moved (in nodal cells) and the share of grains on
// the lines (|field|/2 < 0.06) after 1, 2 and 4 s. FREEZE_REF and SNAP_REF in
// src/render/scenes/chladniSand.ts come from this (see the record's
// Measurements). PULL × SETTLE is chladniSand.ts's PULL_BIAS.
//   node sand-zones-measure.mjs [D1,D2,...]
const PI = Math.PI, LIFT = 0.05, HOP = 1, PULL = 0.3, CAPF = 0.25, SETTLE = 0.5;
const FIGS = [[[3, 5, -1, 0.6], [2, 7, 1, 0.4]], [[2, 5, 1, 0.65], [4, 3, -1, 0.35]], [[1, 6, -1, 0.5], [5, 4, 1, 0.5]], [[4, 7, -1, 0.7], [1, 3, 1, 0.3]]];
function mk(modes) {
  const mo = Math.max(...modes.map((k) => Math.max(k[0], k[1])));
  const field = (x, y) => { let f = 0; for (const [n, m, s, w] of modes) f += w * (Math.cos(n * PI * x) * Math.cos(m * PI * y) + s * Math.cos(m * PI * x) * Math.cos(n * PI * y)); return f; };
  const grad = (x, y) => { let gx = 0, gy = 0; for (const [n, m, s, w] of modes) { gx += w * (-n * PI * Math.sin(n * PI * x) * Math.cos(m * PI * y) + s * -m * PI * Math.sin(m * PI * x) * Math.cos(n * PI * y)); gy += w * (-m * PI * Math.cos(n * PI * x) * Math.sin(m * PI * y) + s * -n * PI * Math.cos(m * PI * x) * Math.sin(n * PI * y)); } return [gx, gy]; };
  return { field, grad, mo };
}
function run(D, modes, secs) {
  const P = mk(modes), N = 3000, dt = 1 / 60;
  const p = new Float64Array(N * 2);
  for (let i = 0; i < p.length; i++) p[i] = Math.random() * 2 - 1;
  const start = p.slice(); const out = [];
  for (let k = 0; k < secs * 60; k++) {
    for (let i = 0; i < N * 2; i += 2) {
      let x = p[i], y = p[i + 1];
      const f = P.field(x, y), a = Math.abs(f) * 0.5, acc = a * D, b = acc * acc / (acc + LIFT);
      const st = HOP * b * Math.sqrt(dt * 60) / 60;
      x += (Math.random() - 0.5) * 2 * st; y += (Math.random() - 0.5) * 2 * st;
      const [gx, gy] = P.grad(p[i], p[i + 1]); const gl = Math.hypot(gx, gy) + 1e-4, sg = Math.sign(f); const cap = CAPF * 2 / P.mo;
      const t = Math.min(1, Math.max(0, acc / (3 * LIFT))); const bias = PULL * SETTLE * t * t * (3 - 2 * t);
      const pull = Math.min(cap, HOP * b * bias * dt);
      x -= gx / gl * sg * pull; y -= gy / gl * sg * pull;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; }
      p[i] = x; p[i + 1] = y;
    }
    if ((k + 1) % 15 === 0) {
      let on = 0, mv = 0;
      for (let i = 0; i < N * 2; i += 2) { if (Math.abs(P.field(p[i], p[i + 1])) * 0.5 < 0.06) on++; mv += Math.hypot(p[i] - start[i], p[i + 1] - start[i + 1]); }
      out.push({ t: (k + 1) / 60, on: on / N, mv: mv / N * P.mo / 2 });
    }
  }
  return out;
}
const Ds = process.argv[2] ? process.argv[2].split(",").map(Number) : [0.1, 0.15, 0.2, 0.3, 0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0];
for (const D of Ds) {
  const r = [0, 0, 0, 0, 0];
  for (const F of FIGS) { const o = run(D, F, 4); r[0] += o[1].mv; r[4] += o[3].mv; r[1] += o[3].on; r[2] += o[7].on; r[3] += o[15].on; }
  console.log(`D=${D.toFixed(2)} move0.5s(cells)=${(r[0] / 4).toFixed(3)} move1s=${(r[4] / 4).toFixed(3)} on@1s=${(r[1] / 4).toFixed(2)} on@2s=${(r[2] / 4).toFixed(2)} on@4s=${(r[3] / 4).toFixed(2)}`);
}
