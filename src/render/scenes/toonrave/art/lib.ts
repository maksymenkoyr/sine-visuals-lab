// Drawing helpers for the Toon Rave frame, plus the prototype's glow, matrix and cel helpers.
// Characters: one thick pure-black union outline, flat fills, mitten nubs, giant eyes.
// World: thin dark-plum outlines, base + hard shadow shape + pale rim line.
export const INK = '#0a0508';      // pure black
export const PLUM = '#1a0614';     // background line
export const DEFS: string[] = [];
export const ART = { LW: 7, id: 0, seed: 7 };
export const uid = (p: string) => `${p}${++ART.id}`;
export const f1 = (n: number) => Math.round(n * 10) / 10;
export const rnd = () => { ART.seed = (ART.seed * 16807) % 2147483647; return (ART.seed - 1) / 2147483646; };
export const xf = (x: number, y: number, rot = 0, s = 1, flip = false) => `translate(${x},${y}) rotate(${rot}) scale(${flip ? -s : s},${s})`;

// Parts with ONE outline around their union: all strokes first, then all fills, then inner.
export type Pt = [number, number];
export type Mat = number[];
export type Stop = [number, string, (number | string)?];
export interface Part { d: string; fill: string; noOutline?: boolean; attr?: string }
export type Tup5 = [number, number, number, number, number];
export type Opts = Record<string, any>;

export function blob(parts: Part[], inner = '', lw = ART.LW, ink = INK) {
  const s = parts.filter(p => !p.noOutline).map(p => `<path d="${p.d}" fill="${ink}" stroke="${ink}" stroke-width="${lw * 2}" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  const f = parts.map(p => `<path d="${p.d}" fill="${p.fill}"${p.attr ? ' ' + p.attr : ''}/>`).join('');
  return `<g>${s}${f}${inner}</g>`;
}
export function shape(d: string, fill: string, lw = ART.LW, ink = INK, extra = '') {
  return `<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="${lw * 2}" paint-order="stroke" stroke-linejoin="round" ${extra}/>`;
}
export function line(d: string, w = ART.LW * 0.6, col = INK, extra = '') {
  return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
}
export const E = (cx: number, cy: number, rx: number, ry: number, rot = 0) => {
  // ellipse as a path (so it can go in blob parts)
  const c = Math.cos(rot * Math.PI / 180), s = Math.sin(rot * Math.PI / 180);
  const p = (a: number) => { const x = rx * Math.cos(a), y = ry * Math.sin(a); return [cx + x * c - y * s, cy + x * s + y * c]; };
  let d = '';
  const n = 48;
  for (let i = 0; i <= n; i++) { const q = p(i / n * Math.PI * 2); d += (i ? 'L' : 'M') + f1(q[0]) + ',' + f1(q[1]); }
  return d + 'Z';
};

export function crSample(pts: number[][], n: number) {
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const out: number[][] = [];
  const segs = pts.length - 1;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * segs;
    const k = Math.min(Math.floor(t), segs - 1);
    const u = t - k;
    const p0 = P[k], p1 = P[k + 1], p2 = P[k + 2], p3 = P[k + 3];
    const u2 = u * u, u3 = u2 * u;
    const c = (a: number, b: number, cc: number, d: number) => 0.5 * ((2 * b) + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u2 + (-a + 3 * b - 3 * cc + d) * u3);
    out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1]), t]);
  }
  return out;
}
export function tubeD(pts: number[][], ws: number[], n = 40, caps = [true, true]) {
  const S = crSample(pts, n);
  const wAt = (t: number) => {
    const k = Math.min(Math.floor(t), ws.length - 2);
    const u = t - k; const s = u * u * (3 - 2 * u);
    return ws[k] + (ws[k + 1] - ws[k]) * s;
  };
  const L: Pt[] = [], R: Pt[] = [];
  for (let i = 0; i < S.length; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    const w = wAt(S[i][2]) / 2;
    L.push([S[i][0] - dy * w, S[i][1] + dx * w]);
    R.push([S[i][0] + dy * w, S[i][1] - dx * w]);
  }
  const we = wAt(S[S.length - 1][2]) / 2, ws0 = wAt(0) / 2;
  let d = `M${f1(L[0][0])},${f1(L[0][1])}`;
  for (let i = 1; i < L.length; i++) d += `L${f1(L[i][0])},${f1(L[i][1])}`;
  d += caps[1] ? `A${f1(we)},${f1(we)} 0 0 0 ${f1(R[R.length - 1][0])},${f1(R[R.length - 1][1])}` : `L${f1(R[R.length - 1][0])},${f1(R[R.length - 1][1])}`;
  for (let i = R.length - 2; i >= 0; i--) d += `L${f1(R[i][0])},${f1(R[i][1])}`;
  d += caps[0] ? `A${f1(ws0)},${f1(ws0)} 0 0 0 ${f1(L[0][0])},${f1(L[0][1])}` : '';
  return d + 'Z';
}
export function crPath(pts: number[][], n = 30) {
  const S = crSample(pts, n);
  return 'M' + S.map(p => `${f1(p[0])},${f1(p[1])}`).join('L');
}
// Smooth closed outline through points (Catmull-Rom loop).
export function loopD(pts: number[][], n = 120) {
  const m = pts.length;
  const P = (i: number) => pts[(i + m) % m];
  let d = '';
  for (let i = 0; i < n; i++) {
    const t = i / n * m, k = Math.floor(t), u = t - k;
    const p0 = P(k - 1), p1 = P(k), p2 = P(k + 1), p3 = P(k + 2);
    const u2 = u * u, u3 = u2 * u;
    const c = (a: number, b: number, cc: number, dd: number) => 0.5 * ((2 * b) + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - dd) * u2 + (-a + 3 * b - 3 * cc + dd) * u3);
    d += (i ? 'L' : 'M') + f1(c(p0[0], p1[0], p2[0], p3[0])) + ',' + f1(c(p0[1], p1[1], p2[1], p3[1]));
  }
  return d + 'Z';
}
export const poly = (pts: number[][]) => 'M' + pts.map(p => f1(p[0]) + ',' + f1(p[1])).join('L') + 'Z';

// arm: a short tapered nub from shoulder to a round mitten ball. Returns blob parts.
export function toonArm(sx: number, sy: number, hx: number, hy: number, w0: number, wm: number, col: string, bend = 0): Part[] {
  const mx = (sx + hx) / 2, my = (sy + hy) / 2, l = Math.hypot(hx - sx, hy - sy);
  const nx = -(hy - sy) / l, ny = (hx - sx) / l;
  return [
    { d: tubeD([[sx, sy], [mx + nx * bend, my + ny * bend], [hx, hy]], [w0, w0 * 0.78, w0 * 0.62], 24), fill: col },
    { d: E(hx + (hx - sx) / l * wm * 0.25, hy + (hy - sy) / l * wm * 0.25, wm * 0.62, wm * 0.56, Math.atan2(hy - sy, hx - sx) * 180 / Math.PI), fill: col },
  ];
}
// leg: short tube hip -> ankle, white sock on the lower half, black Mary-Jane shoe pointing toeAng (deg).
export function toonLeg(hx: number, hy: number, ax: number, ay: number, w: number, skin: string, toeAng: number, o: Opts = {}) {
  const parts: Part[] = [];
  parts.push({ d: tubeD([[hx, hy], [ax, ay]], [w, w * 0.94], 10), fill: skin });
  const k = o.sockFrom ?? 0.45;
  const sx = hx + (ax - hx) * k, sy = hy + (ay - hy) * k;
  parts.push({ d: tubeD([[sx, sy], [ax, ay]], [w * 0.97, w * 0.94], 8, [false, true]), fill: o.sock || '#ffffff' });
  const ta = toeAng * Math.PI / 180;
  const cx = ax + Math.cos(ta) * w * 0.32, cy = ay + Math.sin(ta) * w * 0.32;
  parts.push({ d: E(cx, cy, w * 0.82, w * 0.55, toeAng), fill: o.shoe || INK });
  const L = Math.hypot(ax - hx, ay - hy), fx = (ax - hx) / L, fy = (ay - hy) / L;
  let inner = line(`M${f1(sx - fy * w * 0.5)},${f1(sy + fx * w * 0.5)} L${f1(sx + fy * w * 0.5)},${f1(sy - fx * w * 0.5)}`, ART.LW * 0.5);
  if (o.stripe) for (const t of [0.6, 0.78]) {
    const qx = hx + (ax - hx) * t, qy = hy + (ay - hy) * t;
    inner += line(`M${f1(qx - fy * w * 0.47)},${f1(qy + fx * w * 0.47)} L${f1(qx + fy * w * 0.47)},${f1(qy - fx * w * 0.47)}`, w * 0.15, o.stripe, 'stroke-linecap="butt"');
  }
  const hx2 = cx + Math.cos(ta) * w * 0.25 - Math.sin(ta) * w * 0.18, hy2 = cy + Math.sin(ta) * w * 0.25 + Math.cos(ta) * -w * 0.18;
  inner += `<ellipse cx="${f1(hx2)}" cy="${f1(hy2)}" rx="${f1(w * 0.2)}" ry="${f1(w * 0.08)}" fill="#ffffff" opacity="0.9" transform="rotate(${toeAng} ${f1(hx2)} ${f1(hy2)})"/>`;
  return { parts, inner };
}

// eye: sclera ellipse, iris disc pushed toward the look direction, giant pupil, big highlight.
// The sclera is meant to go into the head's blob parts so one outline wraps head+eyes.
// opts: iris colour, look [dx,dy] (-1..1), pupilScale, pin (pinpoint pupil, no iris), lid (top lid cut angle)
export function eyeParts(cx: number, cy: number, rx: number, ry: number, rot = 0): Part { return { d: E(cx, cy, rx, ry, rot), fill: '#ffffff' }; }
export function eyeInner(cx: number, cy: number, rx: number, ry: number, rot: number, o: Opts = {}) {
  const id = uid('eyc');
  DEFS.push(`<clipPath id="${id}"><path d="${E(cx, cy, rx - 0.5, ry - 0.5, rot)}"/></clipPath>`);
  const look = o.look || [0, 0];
  const ir = Math.min(rx, ry) * (o.irisScale || 0.78);
  const ix = cx + look[0] * (rx - ir * 0.75), iy = cy + look[1] * (ry - ir * 0.75);
  let s = `<path d="${E(cx, cy, rx, ry, rot)}" fill="#ffffff"/><g clip-path="url(#${id})">`;
  if (o.pin) {
    // shocked: tiny pupil, no iris (a pinpoint) on the eye
    s += `<circle cx="${ix}" cy="${iy}" r="${ir * 0.16}" fill="${INK}"/>`;
  } else {
    s += `<circle cx="${ix}" cy="${iy}" r="${ir}" fill="${o.iris || '#9a5cff'}"/>`;
    s += `<circle cx="${ix}" cy="${iy}" r="${ir}" fill="none" stroke="${o.irisLine || '#4a1f7a'}" stroke-width="${ART.LW * 0.3}"/>`;
    const pr = ir * (o.pupilScale || 0.62);
    const px = ix + look[0] * ir * 0.12, py = iy + look[1] * ir * 0.12;
    s += `<circle cx="${px}" cy="${py}" r="${pr}" fill="${INK}"/>`;
    s += `<circle cx="${px + pr * (o.hlx ?? 0.28)}" cy="${py - pr * 0.3}" r="${pr * 0.42}" fill="#ffffff"/>`;
    if (o.glint) s += `<circle cx="${px - pr * 0.38}" cy="${py + pr * 0.4}" r="${pr * 0.13}" fill="#ffffff"/>`;
  }
  if (o.lid) s += `<path d="${o.lid}" fill="${o.lidCol || '#ffd8c4'}" stroke="${INK}" stroke-width="${ART.LW * 1.0}"/>`;
  s += `</g>`;
  if (!o.noRing) s += `<path d="${E(cx, cy, rx, ry, rot)}" fill="none" stroke="${INK}" stroke-width="${ART.LW * 1.05}"/>`;
  return s;
}

export function radial(id: string, stops: Stop[], cx = '50%', cy = '50%', r = '50%', fx?: string, fy?: string, units = '') {
  DEFS.push(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${fx ? ` fx="${fx}" fy="${fy}"` : ''}${units ? ` gradientUnits="${units}"` : ''}>${stops.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}" stop-opacity="${s[2] ?? 1}"/>`).join('')}</radialGradient>`);
  return `url(#${id})`;
}
export function linear(id: string, stops: Stop[], x1 = 0, y1 = 0, x2 = 0, y2 = 1, units = '') {
  DEFS.push(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${units ? ` gradientUnits="${units}"` : ''}>${stops.map(s => `<stop offset="${s[0]}" stop-color="${s[1]}" stop-opacity="${s[2] ?? 1}"/>`).join('')}</linearGradient>`);
  return `url(#${id})`;
}

// machine panel: base fill, a hard shadow shape, a thin pale rim line, thin plum outline.
export function zpanel(d: string, base: string, shadowD: string | null | undefined, shade: string | null, rimD: string | null | undefined, rim: string | null, lw = 2.2) {
  let s = `<path d="${d}" fill="${base}" stroke="${PLUM}" stroke-width="${lw}" stroke-linejoin="round"/>`;
  if (shadowD) s += `<path d="${shadowD}" fill="${shade}"/>`;
  if (rimD) s += line(rimD, lw * 1.1, rim as string);
  return s;
}
// Motion/impact lines
export function speedLines(pts: string[], w = 3, col = INK) { return pts.map(p => line(p, w, col)).join(''); }

// Blast-lit rim (the hard second tone, flipped to light): a crescent inside shape d on the side
// facing the light. Drawn over the fill, under the face details.
export function rimLit(d: string, base: string, rim: string, dx: number, dy: number) {
  const id = uid('rim');
  DEFS.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
  return `<g clip-path="url(#${id})"><path d="${d}" fill="${rim}"/><path d="${d}" fill="${base}" transform="translate(${dx},${dy})"/></g>`;
}

// ---------------------------------------------------------------------------------------------
// Baked glow. The still used feGaussianBlur on a few flat discs; an animated SVG must not carry
// filters, so each glow is a radial gradient whose alpha profile is the exact blur of a disc:
// I(r) = ∫0..R (ρ/σ²) e^(-(r-ρ)²/2σ²) i0e(rρ/σ²) dρ, with i0e(x) = e^-x I0(x).
export function i0e(x: number) {
  if (x < 3.75) {
    const t = (x / 3.75) ** 2;
    return Math.exp(-x) * (1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  const t = 3.75 / x;
  return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / Math.sqrt(x);
}
export function blurDisc(r: number, R: number, s: number) {
  const n = 160; let sum = 0;
  for (let i = 0; i < n; i++) {
    const p = (i + 0.5) / n * R;
    sum += (p / (s * s)) * Math.exp(-((r - p) ** 2) / (2 * s * s)) * i0e(r * p / (s * s));
  }
  return Math.min(1, sum * R / n);
}
// A gradient (objectBoundingBox) for a blurred disc of radius R, sigma s, drawn on a circle of radius R+3s.
export const _glowCache: Record<string, any> = {};
export function glowGrad(R: number, s: number, color: string) {
  const key = `${R}_${s}_${color}`;
  if (_glowCache[key]) return _glowCache[key];
  const out = R + 3 * s, stops: Stop[] = [];
  for (let i = 0; i <= 20; i++) { const f = i / 20; stops.push([f, color, blurDisc(f * out, R, s).toFixed(4)]); }
  return (_glowCache[key] = radial(uid('glw'), stops));
}
// Blurred flat circle / ellipse (ellipse: the circle profile stretched; close enough for soft light).
export function glowCircle(cx: number, cy: number, R: number, s: number, color: string, extra = '') {
  return `<circle cx="${cx}" cy="${cy}" r="${f1(R + 3 * s)}" fill="${glowGrad(R, s, color)}" ${extra}/>`;
}
// Blurred flat ellipse: the gradient's profile is the exact 2D blur sampled along the major axis,
// and its minor radius is fitted so the profile along the minor axis matches too (least squares).
export const _ellCache: Record<string, any> = {};
export function glowEllipse(cx: number, cy: number, rx: number, ry: number, s: number, color: string, extra = '') {
  const key = `${rx}_${ry}_${s}_${color}`;
  if (!_ellCache[key]) {
    const exact = (x0: number, y0: number) => {
      let sum = 0;
      for (let x = -rx; x <= rx; x += 1) for (let y = -ry; y <= ry; y += 1) {
        if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) sum += Math.exp(-((x - x0) ** 2 + (y - y0) ** 2) / (2 * s * s));
      }
      return sum / (2 * Math.PI * s * s);
    };
    const RX = rx + 3 * s, prof: number[] = [];
    for (let i = 0; i <= 20; i++) prof.push(exact(i / 20 * RX, 0));
    const at = (f: number) => { if (f >= 1) return 0; const k = f * 20, i = Math.floor(k); return prof[i] + (prof[i + 1] - prof[i]) * (k - i); };
    const ys: number[] = [], ey: number[] = [];
    for (let y = 0; y <= ry + 3 * s; y += 3) { ys.push(y); ey.push(exact(0, y)); }
    let best: Pt = [RX, 1e9];
    for (let RY = ry; RY <= RX; RY += 0.5) {
      let e = 0; ys.forEach((y, i) => { e += (at(y / RY) - ey[i]) ** 2; });
      if (e < best[1]) best = [RY, e];
    }
    _ellCache[key] = { RX, RY: best[0], fill: radial(uid('gle'), prof.map((v, i) => [i / 20, color, v.toFixed(4)])) };
  }
  const g = _ellCache[key];
  return `<ellipse cx="${cx}" cy="${cy}" rx="${f1(g.RX)}" ry="${f1(g.RY)}" fill="${g.fill}" ${extra}/>`;
}

// ---------------------------------------------------------------------------------------------
// 2D affine matrices [a b c d e f] (SVG order). Every pose is a matrix built from a pivot.
export const MX = {
  I: [1, 0, 0, 1, 0, 0] as Mat,
  mul(A: Mat, B: Mat): Mat {
    return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
      A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  },
  chain(...Ms: Mat[]): Mat { return Ms.reduce((a, b) => MX.mul(a, b), MX.I); },
  T: (x: number, y: number): Mat => [1, 0, 0, 1, x, y],
  R(deg: number): Mat { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [c, s, -s, c, 0, 0]; },
  S: (sx: number, sy = sx): Mat => [sx, 0, 0, sy, 0, 0],
  about(px: number, py: number, M: Mat): Mat { return MX.chain(MX.T(px, py), M, MX.T(-px, -py)); },
  pt(M: Mat, p: number[]): Pt { return [M[0] * p[0] + M[2] * p[1] + M[4], M[1] * p[0] + M[3] * p[1] + M[5]]; },
  inv(M: Mat): Mat {
    const det = M[0] * M[3] - M[1] * M[2];
    const a = M[3] / det, b = -M[1] / det, c = -M[2] / det, d = M[0] / det;
    return [a, b, c, d, -(a * M[4] + c * M[5]), -(b * M[4] + d * M[5])];
  },
  str(M: Mat) { return `matrix(${M.map((v) => Math.round(v * 1e6) / 1e6).join(' ')})`; },
};
// A pose about a pivot: translate (x,y), rotate r degrees, scale (sx,sy), all around (px,py).
export function poseM(px: number, py: number, p: Opts = {}) {
  return MX.chain(MX.T(p.x || 0, p.y || 0), MX.about(px, py, MX.mul(MX.R(p.r || 0), MX.S(p.sx ?? 1, p.sy ?? 1))));
}

// ---------------------------------------------------------------------------------------------
// Scene registry markup. A cel is one drawing of a part; only one cel of a part shows at a time
// (limited animation swaps drawings). A rig group carries a transform, an fx group an opacity.
export const cel = (part: string, name: string, content: string, show = false) => `<g data-cel="${part}:${name}"${show ? '' : ' style="display:none"'}>${content}</g>`;
export const rig = (id: string, content: string, extra = '') => `<g data-x="${id}" ${extra}>${content}</g>`;
export const fxg = (id: string, content: string, extra = '') => `<g data-o="${id}" ${extra}>${content}</g>`;
