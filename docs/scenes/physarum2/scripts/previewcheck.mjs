// Measures how a pure-culture preview holds up: fraction of cells with visible trail,
// and fraction of total trail held by the densest 2% of cells (collapse indicator).
const DEG = Math.PI / 180;
const STR = [
  { n: "Highway", sa: 22, sensor: 0.5, turn: 0.32, speed: 0.55 },
  { n: "Mesh", sa: 60, sensor: 0.25, turn: 0.28, speed: 0.38 },
  { n: "Spotter", sa: 95, sensor: 0.75, turn: 0.85, speed: 0.8 },
  { n: "Labyrinth", sa: 35, sensor: 0.12, turn: 0.16, speed: 0.12 },
];
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function run({ size, agents, blur, scale, decay, steps, s, dep, respawn = 0, surge = 0 }) {
  const rnd = mulberry32(7), C = size * size, T = new Float32Array(C), tmp = new Float32Array(C);
  const ax = new Float32Array(agents), ay = new Float32Array(agents), ah = new Float32Array(agents);
  for (let i = 0; i < agents; i++) { ax[i] = rnd() * size; ay[i] = rnd() * size; ah[i] = rnd() * 6.283; }
  const m = { sa: s.sa * DEG, reach: (1.2 + s.sensor * 13) * scale, turn: (4 + s.turn * 110) * DEG, step: (0.25 + s.speed * 1.9) * scale, dep };
  const sense = (x, y) => { let xi = Math.floor(x), yi = Math.floor(y); xi = ((xi % size) + size) % size; yi = ((yi % size) + size) % size; return T[yi * size + xi]; };
  const out = [];
  for (let st = 1; st <= steps; st++) {
    for (let i = 0; i < agents; i++) {
      const h = ah[i], x = ax[i], y = ay[i];
      const sC = sense(x + Math.cos(h) * m.reach, y + Math.sin(h) * m.reach);
      const sL = sense(x + Math.cos(h - m.sa) * m.reach, y + Math.sin(h - m.sa) * m.reach);
      const sR = sense(x + Math.cos(h + m.sa) * m.reach, y + Math.sin(h + m.sa) * m.reach);
      if (respawn && rnd() < respawn) { ax[i] = rnd() * size; ay[i] = rnd() * size; ah[i] = rnd() * 6.283; continue; }
      let nh = h;
      if (sC >= sL && sC >= sR) {} else if (sL > sC && sR > sC) nh += (rnd() < 0.5 ? -1 : 1) * m.turn; else if (sL > sR) nh -= m.turn; else nh += m.turn;
      const sk = surge && st % 30 < 6 ? 1 + surge : 1;
      let nx = x + Math.cos(nh) * m.step * sk, ny = y + Math.sin(nh) * m.step * sk;
      nx = ((nx % size) + size) % size; ny = ((ny % size) + size) % size;
      ax[i] = nx; ay[i] = ny; ah[i] = nh; T[(ny | 0) * size + (nx | 0)] += m.dep;
    }
    const r = blur, k = (2 * r + 1) ** 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let a = 0; for (let d = -r; d <= r; d++) a += T[y * size + ((x + d + size) % size)]; tmp[y * size + x] = a; }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { let a = 0; for (let d = -r; d <= r; d++) a += tmp[((y + d + size) % size) * size + x]; T[y * size + x] = (a / k) * decay; }
    if (st === 150 || st === steps) {
      const sorted = Float32Array.from(T).sort(); let tot = 0; for (const v of sorted) tot += v;
      let top = 0; for (let i = Math.floor(C * 0.98); i < C; i++) top += sorted[i];
      let vis = 0; for (const v of T) if (v * 0.85 > 0.03) vis++;
      out.push(`@${st}: visible ${(vis / C * 100).toFixed(0)}% top2% ${(top / tot * 100).toFixed(0)}%`);
    }
  }
  return out.join("  ");
}
const variants = {
  "current + surge": { size: 64, agents: 1200, blur: 2, scale: 1, decay: 0.9, dep: 0.035, surge: 1.2 },
  "64/2000/3x3 +surge": { size: 64, agents: 2000, blur: 1, scale: 1, decay: 0.9, dep: 0.035, surge: 1.2 },
  "64/2000/3x3 +surge +respawn0.3%": { size: 64, agents: 2000, blur: 1, scale: 1, decay: 0.9, dep: 0.035, surge: 1.2, respawn: 0.003 },
  "64/2000/3x3 +surge +respawn1%": { size: 64, agents: 2000, blur: 1, scale: 1, decay: 0.9, dep: 0.035, surge: 1.2, respawn: 0.01 },
};
for (const [name, v] of Object.entries(variants)) {
  console.log("--", name);
  for (const s of STR) console.log("  ", s.n.padEnd(10), run({ ...v, steps: 900, s }));
}
