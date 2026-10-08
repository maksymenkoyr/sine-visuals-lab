// Where does a grain of weight w end up? CPU port of SIM_FRAG with weight
// factors, steady drive D, scattered bed, several two-mode figures. Reports per
// weight the share of grains on the lines (a < 0.06) and in heaps (a > 0.6)
// after T seconds.
const PI = Math.PI, LIFT = 0.05, HOP = 1, PULL_BIAS = 0.15, CAPF = 0.25;
const WEIGHT_REF = 0.7, HOP_PER_WEIGHT = 1, LIFT_PER_WEIGHT = 1, STREAM_RATE = 0.3, GRAIN_HEAVY = 0.6;
const FIGS = [[[3, 5, -1, 0.6], [2, 7, 1, 0.4]], [[2, 5, 1, 0.65], [4, 3, -1, 0.35]], [[1, 6, -1, 0.5], [5, 4, 1, 0.5]], [[1, 2, -1, 1.0]], [[2, 3, 1, 1.0]]];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function mk(modes) {
  const mo = Math.max(...modes.map((k) => Math.max(k[0], k[1])));
  const field = (x, y) => { let f = 0; for (const [n, m, s, w] of modes) f += w * (Math.cos(n * PI * x) * Math.cos(m * PI * y) + s * Math.cos(m * PI * x) * Math.cos(n * PI * y)); return f; };
  const grad = (x, y) => { let gx = 0, gy = 0; for (const [n, m, s, w] of modes) { gx += w * (-n * PI * Math.sin(n * PI * x) * Math.cos(m * PI * y) + s * -m * PI * Math.sin(m * PI * x) * Math.cos(n * PI * y)); gy += w * (-m * PI * Math.cos(n * PI * x) * Math.sin(m * PI * y) + s * -n * PI * Math.cos(m * PI * x) * Math.sin(n * PI * y)); } return [gx, gy]; };
  return { field, grad, mo };
}
function run(D, modes, w, secs) {
  const P = mk(modes), N = 1500, dt = 1 / 60;
  const p = new Float64Array(N * 2);
  for (let i = 0; i < p.length; i++) p[i] = Math.random() * 2 - 1;
  const hopScale = 1 + HOP_PER_WEIGHT * (w - WEIGHT_REF);
  const lift = LIFT * (1 - LIFT_PER_WEIGHT * (w - WEIGHT_REF));
  const pullScale = w / WEIGHT_REF;
  const light = 1 - ss(0, GRAIN_HEAVY, w);
  for (let k = 0; k < secs * 60; k++) {
    for (let i = 0; i < N * 2; i += 2) {
      let x = p[i], y = p[i + 1];
      const f = P.field(x, y), a = Math.abs(f) * 0.5, acc = a * D, b = acc * acc / (acc + lift);
      const st = HOP * hopScale * b * Math.sqrt(dt * 60) / 60;
      x += (Math.random() - 0.5) * 2 * st; y += (Math.random() - 0.5) * 2 * st;
      const [gx, gy] = P.grad(p[i], p[i + 1]); const gl = Math.hypot(gx, gy) + 1e-4, sg = Math.sign(f); const cap = CAPF * 2 / P.mo;
      const bias = PULL_BIAS * pullScale * ss(0, 3 * lift, acc);
      const pull = Math.min(cap, HOP * hopScale * b * bias * dt);
      x -= gx / gl * sg * pull; y -= gy / gl * sg * pull;
      let sx = STREAM_RATE * light * D * D * 0.5 * f * gx / P.mo * dt, sy = STREAM_RATE * light * D * D * 0.5 * f * gy / P.mo * dt;
      const sl = Math.hypot(sx, sy); if (sl > cap) { sx *= cap / sl; sy *= cap / sl; }
      x += sx; y += sy;
      if (Math.abs(x) > 1 || Math.abs(y) > 1) { x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; }
      p[i] = x; p[i + 1] = y;
    }
  }
  let on = 0, heap = 0, ma = 0;
  for (let i = 0; i < N * 2; i += 2) { const a = Math.abs(P.field(p[i], p[i + 1])) * 0.5; if (a < 0.06) on++; if (a > 0.6) heap++; ma += a; }
  return { on: on / N, heap: heap / N, ma: ma / N };
}
const D = Number(process.argv[2] ?? 0.8), T = Number(process.argv[3] ?? 6);
// Scattered baseline
console.log(`D=${D} T=${T}s`);
for (const w of [0, 0.1, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85, 1]) {
  let on = 0, heap = 0, ma = 0;
  for (const F of FIGS) { const r = run(D, F, w, T); on += r.on; heap += r.heap; ma += r.ma; }
  const n = FIGS.length;
  console.log(`w=${w.toFixed(2)} onLines=${(on / n).toFixed(2)} inHeaps=${(heap / n).toFixed(2)} meanAmp=${(ma / n).toFixed(3)}`);
}
