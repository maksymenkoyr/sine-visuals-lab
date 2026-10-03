// Can a sim change make the *size* of a negative Smell value show?
// padresponse.mjs found every Smell value from −1.5 to 0 gives the same
// picture (2026-10-02). This copies the pair culture's step
// (src/render/scenes/physarum2Preview.ts, touch left out) and tries two
// alternative steering models against the shipped one:
//   now   — the shipped rule: argmax over three weighted sensor reads.
//   gate  — the agent heeds the other strain's trail only some of the time,
//           with probability |value| / 1.5, at full ±1.5 strength.
//   reach — the other strain's trail is smelled further out the stronger the
//           value (reach × (1 + 1.5·|value|)).
// Overlap is padresponse.mjs's measure (6×6-cell blocks, Σ min). Result on
// 2026-10-02: neither gate nor reach made avoid strength change the overlap,
// so no sim change was proposed — see the record's Decisions entry of that
// date.
//
//   node padmodels.mjs
const DEG = Math.PI / 180, TWO_PI = Math.PI * 2;
const L = [
  { d: 30, turn: 40, step: 1.4, angle: 22 },
  { d: 12, turn: 35, step: 0.9, angle: 60 },
  { d: 45, turn: 100, step: 1.8, angle: 95 },
  { d: 5, turn: 20, step: 0.45, angle: 35 },
];
const OWN = [1.0, 1.1, 0.9, 1.05];
const mo = (k) => ({ sensorAngle: L[k].angle * DEG, reach: L[k].d / 4, turn: L[k].turn * DEG, step: L[k].step / 4, deposit: 0.03 });
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function culture(mode, seed) {
  const size = 72, agents = 1600, rnd = mulberry32(seed), C = size * size;
  const tr = [new Float32Array(C), new Float32Array(C)], tmp = new Float32Array(C);
  const ax = new Float32Array(agents), ay = new Float32Array(agents), ah = new Float32Array(agents), ak = new Uint8Array(agents);
  for (let i = 0; i < agents; i++) { ax[i] = rnd() * size; ay[i] = rnd() * size; ah[i] = rnd() * TWO_PI; ak[i] = i & 1; }
  const idx = (x, y) => {
    let xi = Math.floor(x), yi = Math.floor(y);
    xi = ((xi % size) + size) % size;
    yi = ((yi % size) + size) % size;
    return yi * size + xi;
  };
  const probe = (x, y, h, r) => idx(x + Math.cos(h) * r, y + Math.sin(h) * r);
  function step(motion, smell) {
    for (let i = 0; i < agents; i++) {
      if (rnd() < 0.004) { ax[i] = rnd() * size; ay[i] = rnd() * size; ah[i] = rnd() * TWO_PI; continue; }
      const a = ak[i], m = motion[a], b = 1 - a, wo = smell[a][a];
      let wx = smell[a][b];
      if (mode === "gate") wx = rnd() < Math.min(1, Math.abs(wx) / 1.5) ? Math.sign(wx) * 1.5 : 0;
      const h = ah[i], x = ax[i], y = ay[i], sa = m.sensorAngle;
      const own = [probe(x, y, h, m.reach), probe(x, y, h - sa, m.reach), probe(x, y, h + sa, m.reach)];
      let oth = own, w = wx;
      if (mode === "reach") {
        const R = m.reach * (1 + 1.5 * Math.abs(wx));
        oth = [probe(x, y, h, R), probe(x, y, h - sa, R), probe(x, y, h + sa, R)];
        w = Math.sign(wx) * Math.min(1, Math.abs(wx)) * 1.2;
      }
      const sC = wo * tr[a][own[0]] + w * tr[b][oth[0]];
      const sL = wo * tr[a][own[1]] + w * tr[b][oth[1]];
      const sR = wo * tr[a][own[2]] + w * tr[b][oth[2]];
      let nh = h;
      if (sC >= sL && sC >= sR) { /* hold */ }
      else if (sL > sC && sR > sC) nh += (rnd() < 0.5 ? -1 : 1) * m.turn;
      else if (sL > sR) nh -= m.turn;
      else nh += m.turn;
      const nx = (x + Math.cos(nh) * m.step + size) % size, ny = (y + Math.sin(nh) * m.step + size) % size;
      ax[i] = nx; ay[i] = ny; ah[i] = nh;
      tr[a][(ny | 0) * size + (nx | 0)] += m.deposit;
    }
    const keep = 0.9 / 9;
    for (let k = 0; k < 2; k++) {
      const t = tr[k];
      for (let y = 0; y < size; y++) { const r = y * size; for (let x = 0; x < size; x++) tmp[r + x] = t[r + ((x + size - 1) % size)] + t[r + x] + t[r + ((x + 1) % size)]; }
      for (let y = 0; y < size; y++) { const r = y * size, up = ((y + size - 1) % size) * size, dn = ((y + 1) % size) * size; for (let x = 0; x < size; x++) t[r + x] = (tmp[up + x] + tmp[r + x] + tmp[dn + x]) * keep; }
    }
  }
  function overlap(B = 6) {
    const n = size / B, A = new Float64Array(n * n), Bb = new Float64Array(n * n);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const k = Math.floor(y / B) * n + Math.floor(x / B); A[k] += tr[0][y * size + x]; Bb[k] += tr[1][y * size + x]; }
    let sa = 0, sb = 0;
    for (let k = 0; k < n * n; k++) { sa += A[k]; sb += Bb[k]; }
    let o = 0;
    for (let k = 0; k < n * n; k++) o += Math.min(A[k] / sa, Bb[k] / sb);
    return o;
  }
  return { step, overlap };
}
const xs = [-1.5, -1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1, 1.5];
for (const mode of ["now", "gate", "reach"])
  for (const [A, B, y] of [[0, 1, -1.2], [2, 3, -1.15]]) {
    const row = xs.map((x) => {
      let s = 0;
      for (const seed of [3, 5]) {
        const c = culture(mode, seed);
        for (let t = 0; t < 500; t++) c.step([mo(A), mo(B)], [[OWN[A], x], [y, OWN[B]]]);
        s += c.overlap();
      }
      return (s / 2).toFixed(2);
    });
    console.log(`${mode.padEnd(5)} pair ${A}${B}: ` + row.join(" "));
  }
console.log("x:              " + xs.join(" "));
