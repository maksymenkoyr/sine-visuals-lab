// Headless run of the Strain Console culture (artifacts/strain-console.html)
// with the strain-switching rule, to see how the headcount split settles and
// whether it follows the per-strain settings. Prints each strain's share of
// the agents every `every` steps.
//
//   node docs/scenes/physarum2/scripts/recruit.mjs [case-filter] [steps]
//
// The rule (same as the artifact's): each step an agent, with probability
// `rate`, looks at the ink under it; if another strain's ink there beats its
// own by `margin`, it joins that strain — unless its own strain is already at
// the `floor` share.
const DEG = Math.PI / 180;
const RIVALS = [[1.0, -0.85, -1.1, -0.7], [-1.2, 1.1, -0.6, -0.95], [-0.75, -1.05, 0.9, -1.25], [-1.0, -0.65, -1.15, 1.05]];
const DEF = { nutrient: [0.6, 0.6, 0.6, 0.55], excite: [0.35, 0.25, 0.3, 0.4], sensor: [0.5, 0.25, 0.75, 0.12], angle: [22, 60, 95, 35], turn: [0.32, 0.28, 0.85, 0.16], speed: [0.55, 0.38, 0.8, 0.12], life: [0.9, 0.9, 0.9, 0.9] };
const BEAT = 60 / 124;

export function run({ V = DEF, steps = 4000, rate = 0.02, margin = 1.5, floor = 0.04, every = 500, seed = 1, perCapita = false, W = 256, H = 144, N = 24000, respawn = 0.0015 } = {}) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const K = 4, CELLS = W * H;
  const T = [0, 1, 2, 3].map(() => new Float32Array(CELLS)), tmp = new Float32Array(CELLS);
  const ax = new Float32Array(N), ay = new Float32Array(N), ah = new Float32Array(N), ak = new Uint8Array(N);
  const count = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) { ax[i] = rnd() * W; ay[i] = rnd() * H; ah[i] = rnd() * 6.283; ak[i] = i % K; count[i % K]++; }
  const minCount = Math.round(floor * N);
  const out = [];
  let clock = 0;
  for (let st = 0; st < steps; st++) {
    clock += 1 / 60;
    const pulse = Math.exp(-(clock % BEAT) * 7);
    const M = [0, 1, 2, 3].map((k) => ({ sa: V.angle[k] * DEG, reach: 1.2 + V.sensor[k] * 13, turn: (4 + V.turn[k] * 110) * DEG, step: (0.25 + V.speed[k] * 1.9) * (1 + V.excite[k] * 3.5 * pulse), dep: 0.07 * V.nutrient[k], decay: V.life[k] / 9 }));
    const sense = (x, y, w) => {
      const xi = ((Math.floor(x) % W) + W) % W, yi = ((Math.floor(y) % H) + H) % H;
      const p = yi * W + xi;
      let v = 0;
      for (let b = 0; b < K; b++) v += w[b] * T[b][p];
      return v;
    };
    for (let i = 0; i < N; i++) {
      if (rnd() < respawn) { ax[i] = rnd() * W; ay[i] = rnd() * H; ah[i] = rnd() * 6.283; continue; }
      let a = ak[i];
      const x = ax[i], y = ay[i];
      if (rate > 0 && count[a] > minCount && rnd() < rate) {
        const p = (y | 0) * W + (x | 0);
        const pc = (b) => (perCapita ? T[b][p] / Math.max(1, count[b]) * N / K : T[b][p]);
        let best = a, bv = pc(a) * margin;
        for (let b = 0; b < K; b++) if (b !== a && pc(b) > bv) { bv = pc(b); best = b; }
        if (best !== a && bv > 0.02) { count[a]--; count[best]++; ak[i] = a = best; }
      }
      const m = M[a], w = RIVALS[a], h = ah[i];
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach, w);
      const sL = sense(x + Math.cos(h - m.sa) * m.reach, y + Math.sin(h - m.sa) * m.reach, w);
      const sR = sense(x + Math.cos(h + m.sa) * m.reach, y + Math.sin(h + m.sa) * m.reach, w);
      let nh = h;
      if (sC >= sL && sC >= sR) { /* hold */ } else if (sL > sC && sR > sC) nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      else if (sL > sR) nh -= m.turn; else nh += m.turn;
      let nx = x + Math.cos(nh) * m.step, ny = y + Math.sin(nh) * m.step;
      if (nx < 0) nx += W; else if (nx >= W) nx -= W;
      if (ny < 0) ny += H; else if (ny >= H) ny -= H;
      ax[i] = nx; ay[i] = ny; ah[i] = nh;
      T[a][(ny | 0) * W + (nx | 0)] += m.dep;
    }
    for (let b = 0; b < K; b++) {
      const t = T[b], d = M[b].decay;
      for (let y = 0; y < H; y++) { const r = y * W; for (let x = 0; x < W; x++) tmp[r + x] = t[r + ((x + W - 1) % W)] + t[r + x] + t[r + ((x + 1) % W)]; }
      for (let y = 0; y < H; y++) { const up = ((y + H - 1) % H) * W, r = y * W, dn = ((y + 1) % H) * W; for (let x = 0; x < W; x++) t[r + x] = (tmp[up + x] + tmp[r + x] + tmp[dn + x]) * d; }
    }
    if ((st + 1) % every === 0) out.push(count.map((c) => Math.round((c / N) * 100)));
  }
  return out;
}

const mod = (k, key, v) => { const V = JSON.parse(JSON.stringify(DEF)); V[key][k] = v; return V; };
const cases = {
  defaults: {},
  "defaults seed2": { seed: 2 },
  "A1 nutrient 1.0": { V: mod(0, "nutrient", 1.0) },
  "D4 life 0.97": { V: mod(3, "life", 0.97) },
  "C3 speed 0.2": { V: mod(2, "speed", 0.2) },
};
const perCapita = process.argv.includes("--per-agent");
const [only, stepsArg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
for (const [name, o] of Object.entries(cases)) {
  if (only && only !== "all" && !name.includes(only)) continue;
  const t0 = Date.now();
  const r = run({ perCapita, ...o, steps: Number(stepsArg) || 3000 });
  console.log(name.padEnd(18), r.map((x) => x.join("/")).join("  "), `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
