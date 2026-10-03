import type { Mat, Opts, Tup5 } from "./lib";
import { INK, DEFS, ART, uid, f1, rnd, blob, shape, line, E, loopD, poly, ppgArm, ppgLeg, ppgEyeParts, ppgEyeInner, speedLines, rimLit, glowCircle, MX, cel, rig, fxg } from "./lib";
import { BX, BY } from "./room";
// The cast: PPG construction + Zim attitude. Original characters only.
//
// Prototype split: each character is a rig (a root group with a pose matrix) holding cels, the
// drawings limited animation swaps. The cel named 'hero' is always the r11 still's own drawing, so
// with every rig at its hero matrix and every part on 'hero' the frame is the still. Other cels are
// the same construction code with other joint positions. ANCHORS records where props attach.
export const ANCHORS: { raverMitten: Record<string, number[]>; kidHead: Record<string, number[]> } = { raverMitten: {}, kidHead: {} };
export const HERO: Record<string, Mat> = {};   // hero matrices of rigs the still placed with a transform

// The DJ: tiny body, huge head, purple angular bob, spiked headphones.
// Rigs: dj (root, pivot at her feet), djHead (pivot at the neck), djPhones (the headphones jump).
// Cels: djLegs hero|stand, djTorso hero|pumpL|pumpR|windup, djEyes hero|blink.
export function dj() {
  ART.LW = 6.5;
  const skin = '#ffd5c0', hair = '#6d1a9c', dress = '#9cff2e', stripe = '#8a2be2';
  let s = '';
  const L = (hx: number, hy: number, ax: number, ay: number, toe: number): Tup5 => [hx, hy, ax, ay, toe];   // hip, ankle, toe angle
  const legsDraw = (p: Tup5, q: Tup5) => {
    const lA = ppgLeg(p[0], p[1], p[2], p[3], 28, skin, p[4], { stripe }), lB = ppgLeg(q[0], q[1], q[2], q[3], 28, skin, q[4], { stripe });
    return blob([...lA.parts, ...lB.parts], lA.inner + lB.inner);
  };
  s += cel('djLegs', 'hero', legsDraw(L(446, 440, 366, 412, 200), L(436, 462, 356, 470, 178)), true);
  s += cel('djLegs', 'stand', legsDraw(L(436, 448, 426, 528, 196), L(472, 448, 484, 528, -16)));
  const body = 'M414,382 C404,404 400,428 408,452 C434,464 474,464 498,452 C504,428 498,402 486,380 C464,370 432,370 414,382Z';
  const bi = `<path d="M405,432 C432,442 472,442 501,430 L503,442 C472,454 432,454 406,444Z" fill="${INK}"/>`;
  const torso = (l: number[], r: number[]) => blob([...ppgArm(414, 400, l[0], l[1], 24, 44, skin, l[2]), ...ppgArm(490, 396, r[0], r[1], 24, 46, skin, r[2]), { d: body, fill: dress }], bi);
  s += cel('djTorso', 'hero', torso([444, 512, -8], [518, 508, 8]), true);
  s += cel('djTorso', 'pumpL', torso([298, 420, -12], [552, 474, 10]));
  s += cel('djTorso', 'pumpR', torso([362, 480, -10], [604, 330, 14]));
  s += cel('djTorso', 'windup', torso([306, 352, -12], [606, 340, 12]));
  // head + eyes in one outline
  const hx = 410, hy = 262;
  let h = '';
  const head = loopD([[hx - 128, hy - 10], [hx - 100, hy - 82], [hx, hy - 110], [hx + 100, hy - 88], [hx + 132, hy - 6], [hx + 104, hy + 72], [hx + 10, hy + 104], [hx - 96, hy + 76]]);
  const eL: Tup5 = [hx - 40, hy - 4, 56, 64, -10], eR: Tup5 = [hx + 72, hy - 10, 60, 70, 8];
  h += blob([{ d: head, fill: skin }, ppgEyeParts(...eL), ppgEyeParts(...eR)], '', ART.LW);
  h += fxg('djRim', rimLit(head, skin, '#ffc4ea', 3, -13));
  h += cel('djEyes', 'hero', ppgEyeInner(...eL, { iris: '#a35bff', irisLine: '#5a1f9a', look: [0.4, 0.16], irisScale: 0.7, pupilScale: 0.62, glint: true })
    + ppgEyeInner(...eR, { iris: '#a35bff', irisLine: '#5a1f9a', look: [0.3, 0.18], irisScale: 0.7, pupilScale: 0.62, glint: true }), true);
  h += cel('djEyes', 'blink', closedEye(eL, skin) + closedEye(eR, skin));
  const mx = hx + 22, my = hy + 64;
  const mouth = `M${mx - 66},${my - 8} C${mx - 30},${my + 2} ${mx + 30},${my - 4} ${mx + 70},${my - 20} C${mx + 62},${my + 22} ${mx + 20},${my + 40} ${mx - 14},${my + 36} C${mx - 46},${my + 30} ${mx - 64},${my + 14} ${mx - 66},${my - 8}Z`;
  let teeth = '';
  for (let i = 0; i < 7; i++) {
    const t = i / 6, x = mx - 60 + t * 124, y = my - 6 - t * 12 + Math.sin(t * 3.1) * 4;
    teeth += `<path d="M${x - 9},${y} L${x},${y + 15} L${x + 9},${y - 1}Z" fill="#fff"/>`;
  }
  for (let i = 0; i < 6; i++) {
    const t = (i + 0.5) / 6, x = mx - 52 + t * 110, y = my + 30 - Math.sin(t * 3.1) * 8 + t * 2;
    teeth += `<path d="M${x - 8},${y + 2} L${x},${y - 13} L${x + 8},${y + 2}Z" fill="#fff"/>`;
  }
  const mid = uid('mc');
  DEFS.push(`<clipPath id="${mid}"><path d="${mouth}"/></clipPath>`);
  h += `<path d="${mouth}" fill="#3a0a1e"/><g clip-path="url(#${mid})"><ellipse cx="${mx + 4}" cy="${my + 36}" rx="34" ry="16" fill="#ff5f8f"/>${teeth}</g>`;
  h += `<path d="${mouth}" fill="none" stroke="${INK}" stroke-width="${ART.LW * 0.85}" stroke-linejoin="round"/>`;
  h += `<ellipse cx="${hx - 92}" cy="${hy + 46}" rx="18" ry="9" fill="#ff9ab0" opacity="0.8"/>`;
  const H = [
    [hx - 140, hy + 70], [hx - 150, hy - 20], [hx - 130, hy - 92], [hx - 80, hy - 130], [hx - 20, hy - 146], [hx + 50, hy - 140], [hx + 96, hy - 116],
    [hx + 138, hy - 84], [hx + 152, hy - 30], [hx + 150, hy + 6],
    [hx + 122, hy - 60], [hx + 102, hy - 40], [hx + 84, hy - 82], [hx + 52, hy - 60], [hx + 28, hy - 96], [hx - 4, hy - 66], [hx - 26, hy - 100], [hx - 58, hy - 72], [hx - 80, hy - 98], [hx - 100, hy - 50],
    [hx - 110, hy + 10], [hx - 112, hy + 66],
  ];
  h += shape(poly(H), hair, ART.LW);
  let p = '';
  p += shape(`M${hx - 150},${hy - 40} C${hx - 150},${hy - 190} ${hx + 120},${hy - 220} ${hx + 150},${hy - 70} L${hx + 132},${hy - 66} C${hx + 104},${hy - 190} ${hx - 128},${hy - 168} ${hx - 128},${hy - 36}Z`, '#3e3346', ART.LW * 0.85);
  p += shape(loopD([[hx + 128, hy - 92], [hx + 160, hy - 96], [hx + 170, hy - 50], [hx + 150, hy - 14], [hx + 132, hy - 30]]), '#3e3346', ART.LW * 0.85);
  const cup = loopD([[hx - 186, hy - 40], [hx - 150, hy - 74], [hx - 108, hy - 52], [hx - 104, hy + 34], [hx - 140, hy + 62], [hx - 186, hy + 34]]);
  p += shape(`M${hx - 176},${hy - 44} L${hx - 210},${hy - 96} L${hx - 156},${hy - 66}Z`, '#d9d0e4', ART.LW * 0.7);
  p += shape(`M${hx - 186},${hy + 26} L${hx - 226},${hy + 40} L${hx - 180},${hy + 50}Z`, '#d9d0e4', ART.LW * 0.7);
  p += shape(cup, '#3e3346', ART.LW);
  p += `<ellipse cx="${hx - 146}" cy="${hy - 6}" rx="22" ry="38" fill="#ff3fae" stroke="${INK}" stroke-width="4"/><ellipse cx="${hx - 150}" cy="${hy - 16}" rx="8" ry="14" fill="#ffd0ee"/>`;
  h += rig('djPhones', p);
  h += `<path d="M${hx - 104},${hy - 74} L${hx - 2},${hy - 56} L${hx - 10},${hy - 44} Z" fill="${INK}"/>`;
  h += `<path d="M${hx + 122},${hy - 86} L${hx + 34},${hy - 62} L${hx + 42},${hy - 50} Z" fill="${INK}"/>`;
  s += rig('djHead', h);
  return rig('dj', s);
}
// A closed, happy PPG eye (for blinks): skin over the eye, the black ring, a lid curve.
export function closedEye([cx, cy, rx, ry, rot]: Tup5, skin: string) {
  return `<path d="${E(cx, cy, rx, ry, rot)}" fill="${skin}"/><path d="${E(cx, cy, rx, ry, rot)}" fill="none" stroke="${INK}" stroke-width="${ART.LW * 1.05}"/>`
    + line(`M${f1(cx - rx * 0.72)},${f1(cy + ry * 0.2)} Q${f1(cx)},${f1(cy - ry * 0.55)} ${f1(cx + rx * 0.72)},${f1(cy + ry * 0.2)}`, ART.LW * 0.9);
}

// Impact around the mittens + shock rings (flat, hard-edged)
export function slamFx() {
  let s = '';
  let r0 = '';
  for (const [r, w] of [[190, 7], [250, 5], [320, 4]]) r0 += `<path d="M${BX - r},${BY - 10} A${r},${r * 0.32} 0 0 0 ${BX + r},${BY - 10}" fill="none" stroke="#fff" stroke-width="${w}" opacity="0.9"/>`;
  s += rig('rings', r0);
  ART.seed = 3;
  let st = '';
  for (const [x, y] of [[452, 536], [526, 532]]) {
    const p = [];
    for (let i = 0; i < 18; i++) { const a = i / 18 * 6.283; const r = i % 2 ? 22 : 44 + rnd() * 16; p.push([x + Math.cos(a) * r, y + Math.sin(a) * r * 0.6]); }
    st += `<path d="${poly(p)}" fill="#fff6c8" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`;
  }
  for (const [x, y, a] of [[404, 516, -160], [400, 546, 175], [572, 496, -25], [580, 528, 0], [486, 470, -95]]) {
    const r = a * Math.PI / 180;
    st += line(`M${f1(x + Math.cos(r) * 10)},${f1(y + Math.sin(r) * 10)} L${f1(x + Math.cos(r) * 40)},${f1(y + Math.sin(r) * 40)}`, 6, INK);
  }
  s += fxg('impactStars', st);
  return s;
}

// The pompadour raver: tall ridged-rectangle head (Zim shape, PPG line). His pompadour flies off.
// Rigs: guy (root; the still tilts him 22° back), guyHead (pivot at the neck), pomp (the hairpiece,
// in world space, since it travels between heads). Cels: guyLegs, guyTorso, guyEyes, guyBrows, guyMouth.
export const GUY = { hx: 1146, hy: 360, neck: [1146, 470], feet: [1140, 650] };
export function guyM(p: Opts = {}) {
  // the still: translate(0,-10) translate(1150,640) scale(0.9) translate(-1150,-640) rotate(22,1150,560)
  return MX.chain(MX.T(p.x || 0, -10 + (p.y || 0)), MX.about(1150, 640, MX.S(0.9)), MX.about(1150, 560, MX.R(p.r ?? 22)), MX.about(1140, 650, MX.S(p.sx ?? 1, p.sy ?? 1)));
}
export function pompadour() {
  ART.LW = 6;
  const skin = '#f7c6a3', shirt = '#7b2bd6';
  let s = '';
  const legsDraw = (a: Tup5, b: Tup5) => {
    const lA = ppgLeg(a[0], a[1], a[2], a[3], 30, skin, a[4]), lB = ppgLeg(b[0], b[1], b[2], b[3], 30, skin, b[4]);
    return blob([...lA.parts, ...lB.parts], lA.inner + lB.inner);
  };
  let g = '';
  g += cel('guyLegs', 'hero', legsDraw([1128, 560, 1090, 640, 160], [1162, 562, 1150, 646, 170]), true);
  g += cel('guyLegs', 'stand', legsDraw([1126, 560, 1114, 644, 196], [1164, 562, 1178, 644, -16]));
  g += cel('guyLegs', 'crouch', legsDraw([1122, 566, 1092, 640, 200], [1168, 566, 1200, 640, -20]));
  const body = 'M1110,480 C1100,520 1102,556 1114,574 C1140,584 1170,584 1188,572 C1196,550 1192,512 1182,480 C1160,470 1130,470 1110,480Z';
  const vee = `<path d="M1124,482 L1146,512 L1170,480" fill="none" stroke="#9cff2e" stroke-width="8" stroke-linejoin="round"/>`;
  const torso = (l: number[], r: number[]) => blob([...ppgArm(1116, 494, l[0], l[1], 24, 38, skin, l[2]), ...ppgArm(1182, 490, r[0], r[1], 24, 40, skin, r[2]), { d: body, fill: shirt }], vee);
  g += cel('guyTorso', 'hero', torso([1040, 452, 8], [1268, 432, -10]), true);
  g += cel('guyTorso', 'pumpA', torso([1018, 418, 10], [1256, 532, -8]));
  g += cel('guyTorso', 'pumpB', torso([1050, 546, 8], [1274, 400, -12]));
  g += cel('guyTorso', 'crouch', torso([1062, 530, 6], [1232, 532, -6]));
  const hx = GUY.hx, hy = GUY.hy;
  let h = '';
  const head = `M${hx - 82},${hy + 92} C${hx - 92},${hy + 20} ${hx - 92},${hy - 60} ${hx - 80},${hy - 112} L${hx - 50},${hy - 128} L${hx - 26},${hy - 116} L${hx},${hy - 132} L${hx + 26},${hy - 116} L${hx + 52},${hy - 128} L${hx + 82},${hy - 112} C${hx + 94},${hy - 60} ${hx + 94},${hy + 20} ${hx + 84},${hy + 92} C${hx + 50},${hy + 114} ${hx - 50},${hy + 114} ${hx - 82},${hy + 92}Z`;
  const eL: Tup5 = [hx - 36, hy - 8, 46, 58, -4], eR: Tup5 = [hx + 46, hy - 10, 46, 58, 6];
  h += blob([{ d: head, fill: skin }, ppgEyeParts(...eL), ppgEyeParts(...eR)], '', ART.LW);
  h += fxg('guyRim', rimLit(head, skin, '#ffc4ea', 13, -3));
  const eyes = (oL: Opts, oR: Opts) => ppgEyeInner(...eL, oL) + ppgEyeInner(...eR, oR);
  const iris = { iris: '#7a5230', irisLine: '#3e2614', irisScale: 0.6, pupilScale: 0.66 };
  h += cel('guyEyes', 'hero', eyes({ pin: true, look: [-0.1, 0] }, { pin: true, look: [-0.15, 0] }), true);
  h += cel('guyEyes', 'normal', eyes({ ...iris, look: [-0.25, 0.1] }, { ...iris, look: [-0.3, 0.1] }));
  h += cel('guyEyes', 'up', eyes({ ...iris, look: [0.25, -0.75] }, { ...iris, look: [0.2, -0.75] }));
  h += cel('guyEyes', 'left', eyes({ ...iris, look: [-0.8, -0.1] }, { ...iris, look: [-0.8, -0.1] }));
  h += cel('guyEyes', 'blink', closedEye(eL, skin) + closedEye(eR, skin));
  h += cel('guyBrows', 'hero', `<path d="M${hx - 80},${hy - 82} L${hx - 10},${hy - 96} L${hx - 20},${hy - 84}Z" fill="${INK}"/><path d="M${hx + 92},${hy - 90} L${hx + 18},${hy - 100} L${hx + 26},${hy - 86}Z" fill="${INK}"/>`, true);
  h += cel('guyBrows', 'calm', `<path d="M${hx - 78},${hy - 70} L${hx - 10},${hy - 76} L${hx - 16},${hy - 64}Z" fill="${INK}"/><path d="M${hx + 92},${hy - 74} L${hx + 20},${hy - 78} L${hx + 26},${hy - 66}Z" fill="${INK}"/>`);
  h += cel('guyBrows', 'sad', `<path d="M${hx - 80},${hy - 66} L${hx - 8},${hy - 90} L${hx - 12},${hy - 76}Z" fill="${INK}"/><path d="M${hx + 94},${hy - 70} L${hx + 18},${hy - 94} L${hx + 24},${hy - 80}Z" fill="${INK}"/>`);
  h += cel('guyMouth', 'hero', `<ellipse cx="${hx + 6}" cy="${hy + 80}" rx="9" ry="12" fill="#3a0a1e" stroke="${INK}" stroke-width="4"/>`, true);
  h += cel('guyMouth', 'smile', `<path d="M${hx - 26},${hy + 70} C${hx - 14},${hy + 98} ${hx + 26},${hy + 98} ${hx + 38},${hy + 66} C${hx + 18},${hy + 74} ${hx - 6},${hy + 76} ${hx - 26},${hy + 70}Z" fill="#3a0a1e" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/><path d="M${hx - 4},${hy + 86} C${hx + 4},${hy + 80} ${hx + 16},${hy + 80} ${hx + 22},${hy + 84}" fill="none" stroke="#ff5f8f" stroke-width="5" stroke-linecap="round"/>`);
  h += cel('guyMouth', 'flat', line(`M${hx - 18},${hy + 82} C${hx},${hy + 76} ${hx + 16},${hy + 80} ${hx + 28},${hy + 76}`, 5));
  h += fxg('guyShine', `<path d="M${hx - 60},${hy - 104} L${hx - 40},${hy - 116}" stroke="#fff" stroke-width="8" stroke-linecap="round"/><path d="M${hx - 66},${hy - 92} L${hx - 64},${hy - 70}" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`);
  g += rig('guyHead', h);
  HERO.guy = guyM();
  s += rig('guy', g, `transform="${MX.str(HERO.guy)}"`);
  // the hairpiece: one solid black shape with a big curl, drawn around its own origin
  const px = 0, py = 0;
  const pomp = `M${px + 100},${py + 30} C${px + 40},${py + 12} ${px - 40},${py + 12} ${px - 104},${py + 30} C${px - 140},${py - 10} ${px - 130},${py - 80} ${px - 70},${py - 96} C${px - 10},${py - 110} ${px + 60},${py - 90} ${px + 100},${py - 60} C${px + 124},${py - 40} ${px + 120},${py + 10} ${px + 100},${py + 30}Z`;
  HERO.pomp = MX.chain(MX.T(1440, 300), MX.R(-18), MX.S(0.82));
  s += rig('pomp', `${shape(pomp, '#16101a', ART.LW)}${line(`M${px - 96},${py + 6} C${px - 124},${py - 40} ${px - 84},${py - 74} ${px - 58},${py - 54} C${px - 40},${py - 38} ${px - 60},${py - 22} ${px - 74},${py - 32}`, 6, '#5d4f72')}<path d="M${px - 30},${py - 80} C${px + 10},${py - 90} ${px + 50},${py - 78} ${px + 80},${py - 54}" fill="none" stroke="#8a7aa3" stroke-width="8" stroke-linecap="round"/>`, `transform="${MX.str(HERO.pomp)}"`);
  s += fxg('pompFx', line('M1196,262 C1226,190 1300,176 1350,236', 5, '#ffffff', 'stroke-dasharray="18 14"') + speedLines([`M1300,320 L1330,306`, `M1316,356 L1346,350`], 5));
  return s;
}

// The round raver, foreground right. Rig: raver (root). Cels: raverTorso (arm), raverEyes,
// raverMouth, raverHair. Her glowstick is its own rig (stick) in world space.
export const RAVER = { hx: 1380, hy: 690, shoulder: [1310, 840] };
export function raverM(p: Opts = {}) {
  // the still: translate(1240,760) scale(0.74) translate(-1380,-690) rotate(8,1380,690)
  return MX.chain(MX.T(1240 + (p.x || 0), 760 + (p.y || 0)), MX.S(0.74), MX.T(-1380, -690), MX.about(1380, 690, MX.mul(MX.R(p.r ?? 8), MX.S(p.sx ?? 1, p.sy ?? 1))));
}
export function roundRaver() {
  ART.LW = 7.5;
  const skin = '#ffcfb4', hair = '#18c9b8';
  let s = '';
  const hx = RAVER.hx, hy = RAVER.hy;
  const body = `M${hx - 70},${hy + 120} C${hx - 90},${hy + 180} ${hx - 90},${hy + 260} ${hx - 70},${hy + 300} L${hx + 90},${hy + 300} C${hx + 100},${hy + 240} ${hx + 90},${hy + 170} ${hx + 70},${hy + 120}Z`;
  const belt = `<path d="M${hx - 84},${hy + 200} C${hx - 30},${hy + 214} ${hx + 40},${hy + 214} ${hx + 92},${hy + 198} L${hx + 94},${hy + 218} C${hx + 40},${hy + 234} ${hx - 30},${hy + 234} ${hx - 86},${hy + 220}Z" fill="${INK}"/>`;
  const torso = (name: string, ex: number, ey: number, bend: number, show?: boolean) => {
    const arm = ppgArm(hx - 70, hy + 150, ex, ey, 34, 54, skin, bend);
    const [sx, sy] = RAVER.shoulder, l = Math.hypot(ex - sx, ey - sy);
    ANCHORS.raverMitten[name] = [ex + (ex - sx) / l * 13.5, ey + (ey - sy) / l * 13.5, Math.atan2(ey - sy, ex - sx) * 180 / Math.PI];
    return cel('raverTorso', name, blob([{ d: body, fill: '#ff3fae' }, ...arm], belt), show);
  };
  s += torso('hero', hx - 204, hy + 20, -16, true);
  [-164, -149, -134, -119].forEach((a, i) => {
    const r = a * Math.PI / 180;
    s += torso('w' + i, RAVER.shoulder[0] + Math.cos(r) * 188, RAVER.shoulder[1] + Math.sin(r) * 188, -16 + i * 4);
  });
  const pts = [];
  for (let i = 0; i < 40; i++) {
    const a = i / 40 * Math.PI * 2;
    let rx = 168, ry = 140;
    let r = 1;
    if (Math.cos(a) > 0.2) r += 0.05 * Math.sin(a * 14);
    pts.push([hx + Math.cos(a) * rx * r, hy + Math.sin(a) * ry * r]);
  }
  const head = loopD(pts, 200);
  const eL: Tup5 = [hx - 74, hy - 6, 62, 76, -8], eR: Tup5 = [hx + 52, hy - 14, 66, 80, 8];
  s += blob([{ d: head, fill: skin }, ppgEyeParts(...eL), ppgEyeParts(...eR)], '', ART.LW);
  s += fxg('raverRim', rimLit(head, skin, '#ffc4ea', 15, 6));
  const gold = { iris: '#ffb02e', irisLine: '#a8600a', pupilScale: 0.6, glint: true };
  s += cel('raverEyes', 'hero', ppgEyeInner(...eL, { ...gold, look: [-0.42, -0.1] }) + ppgEyeInner(...eR, { ...gold, look: [-0.5, -0.1] }), true);
  s += cel('raverEyes', 'up', ppgEyeInner(...eL, { ...gold, look: [0.15, -0.7] }) + ppgEyeInner(...eR, { ...gold, look: [0.1, -0.7] }));
  s += cel('raverEyes', 'pin', ppgEyeInner(...eL, { pin: true, look: [-0.2, -0.05] }) + ppgEyeInner(...eR, { pin: true, look: [-0.25, -0.05] }));
  s += cel('raverEyes', 'blink', closedEye(eL, skin) + closedEye(eR, skin));
  s += cel('raverMouth', 'hero', shape(E(hx - 18, hy + 96, 20, 24, -10), '#3a0a1e', ART.LW * 0.5) + `<ellipse cx="${hx - 16}" cy="${hy + 108}" rx="12" ry="7" fill="#ff5f8f"/>`, true);
  s += cel('raverMouth', 'smile', `<path d="M${hx - 62},${hy + 82} C${hx - 40},${hy + 136} ${hx + 14},${hy + 136} ${hx + 30},${hy + 76} C${hx - 2},${hy + 88} ${hx - 34},${hy + 88} ${hx - 62},${hy + 82}Z" fill="#3a0a1e" stroke="${INK}" stroke-width="${ART.LW * 0.7}" stroke-linejoin="round"/><path d="M${hx - 34},${hy + 112} C${hx - 20},${hy + 102} ${hx},${hy + 102} ${hx + 10},${hy + 110} C${hx},${hy + 122} ${hx - 24},${hy + 122} ${hx - 34},${hy + 112}Z" fill="#ff5f8f"/>`);
  s += `<ellipse cx="${hx - 120}" cy="${hy + 70}" rx="22" ry="10" fill="#ff8aa8" opacity="0.85"/>`;
  // hair: one solid shape. hero = the still (streaming flat in the blast); stream2 = its flutter
  // drawing; calmA/calmB = hanging down the side, two flutter drawings for the groove.
  const fringe = [[132, -94], [102, -74], [86, -118], [42, -98], [22, -134], [-28, -110], [-58, -138], [-98, -104], [-132, -118], [-142, -40]];
  const HP = [[-162, -10], [-170, -90], [-112, -152], [-10, -170], [90, -164], [200, -176], [330, -184], [440, -168], [486, -156], [372, -128], [492, -100], [364, -76], [462, -34], [336, -26], [412, 40], [250, 20], [176, 62], [154, 40], [162, -20], ...fringe];
  const hairD = (P: number[][], hl: string) => shape(poly(P.map(([x, y]) => [hx + x, hy + y])), hair, ART.LW) + `<path d="${hl}" fill="none" stroke="#7af2e6" stroke-width="9" stroke-linecap="round"/>`;
  const hlHero = `M${hx - 80},${hy - 140} C${hx - 20},${hy - 156} ${hx + 120},${hy - 162} ${hx + 300},${hy - 166}`;
  s += cel('raverHair', 'hero', hairD(HP, hlHero), true);
  const HP2 = HP.map(([x, y], i) => (x > 300 ? [x - 14, y + (i % 2 ? 22 : -10)] : [x, y]));
  s += cel('raverHair', 'stream2', hairD(HP2, hlHero));
  const calm = (k: number) => [[-162, -10], [-170, -90], [-112, -152], [-10, -170], [90, -164], [158, -134], [194, -78], [206, -8], [216 + k * 8, 62 - k * 4], [230 + k * 14, 128 - k * 8], [194, 100], [184 - k * 6, 158 + k * 4], [154, 96], [160, 40], [162, -20], ...fringe];
  const hlCalm = `M${hx - 80},${hy - 140} C${hx - 20},${hy - 156} ${hx + 90},${hy - 160} ${hx + 150},${hy - 126}`;
  s += cel('raverHair', 'calmA', hairD(calm(0), hlCalm));
  s += cel('raverHair', 'calmB', hairD(calm(1), hlCalm));
  HERO.raver = raverM();
  return rig('raver', s, `transform="${MX.str(HERO.raver)}"`);
}
// Her glowstick, around its own origin. The still: translate(190,70) rotate(-40,1250,520) on a
// stick centred at (1255,520), then a soft glow at (1445,590).
export function glowstick() {
  HERO.stick = MX.chain(MX.T(190, 70), MX.about(1250, 520, MX.R(-40)), MX.T(1255, 520));
  const g = MX.pt(MX.inv(HERO.stick), [1445, 590]);
  const s = `${shape('M-45,-8 L45,-8 C55,-8 55,8 45,8 L-45,8 C-55,8 -55,-8 -45,-8Z', '#9cff2e', 4)}<path d="M-39,-4 L35,-4" stroke="#eaffd0" stroke-width="4" stroke-linecap="round"/>`
    + fxg('stickGlow', glowCircle(f1(g[0]), f1(g[1]), 40, 16, '#9cff2e', 'opacity="0.35"'));
  return rig('stick', s, `transform="${MX.str(HERO.stick)}"`);
}

// A small raver at the rail. Hero: clinging on, blown out flat like a flag. In the groove he dances
// standing on the rail. Rig: kid (root). Cels: kid hero|flap|standA|standB|crouch (whole drawings).
export const KID = { root: [140, -4], feet: [820, 540] };
export function flagRaver() {
  ART.LW = 4.5;
  const skin = '#ffd9b8';
  let s = '';
  // the still's drawing, with the legs as parameters (flap = the next drawing of the flag)
  const flag = (la: number[], lb: number[]) => {
    let k = '';
    const rx0 = 900, ry0 = 552;
    const lA = ppgLeg(842, 548, la[0], la[1], 18, skin, la[2]);
    const lB = ppgLeg(842, 558, lb[0], lb[1], 18, skin, lb[2]);
    k += blob([...lA.parts, ...lB.parts], lA.inner + lB.inner);
    const body = 'M800,538 C820,532 840,534 850,540 C852,552 852,562 848,570 C832,576 814,574 800,566Z';
    const a1 = ppgArm(806, 546, rx0 - 134, ry0 - 4, 14, 22, skin, -3);
    const a2 = ppgArm(806, 560, rx0 - 136, ry0 + 6, 14, 22, skin, 3);
    k += blob([{ d: body, fill: '#ff8a1f' }, ...a1, ...a2]);
    const hx = 812, hy = 506;
    const head = E(hx, hy, 46, 38, 8);
    const eL: Tup5 = [hx - 18, hy - 2, 18, 22, 0], eR: Tup5 = [hx + 16, hy - 4, 18, 22, 0];
    k += blob([{ d: head, fill: skin }, ppgEyeParts(...eL), ppgEyeParts(...eR)], '', ART.LW);
    k += fxg('kidRim', rimLit(head, skin, '#ffc4ea', 7, 0));
    k += ppgEyeInner(...eL, { pin: true }) + ppgEyeInner(...eR, { pin: true });
    k += `<path d="M${hx - 8},${hy + 24} L${hx + 4},${hy + 20} L${hx + 14},${hy + 26}" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
    k += shape(`M${hx - 44},${hy - 10} C${hx - 40},${hy - 40} ${hx},${hy - 50} ${hx + 40},${hy - 34} L${hx + 76},${hy - 40} L${hx + 52},${hy - 20} L${hx + 84},${hy - 14} L${hx + 44},${hy - 6} C${hx + 10},${hy - 30} ${hx - 20},${hy - 26} ${hx - 44},${hy - 10}Z`, '#1a1018', ART.LW);
    k += speedLines([`M870,500 L930,496`, `M880,520 L950,518`, `M900,584 L956,588`], 4);
    return k;
  };
  s += cel('kid', 'hero', flag([892, 534, -10], [894, 566, 10]), true);
  s += cel('kid', 'flap', flag([894, 522, -24], [890, 578, 22]));
  // standing on the rail: o = {l, r: hands [x,y,bend], eyes, mouth, dy (crouch)}
  const stand = (name: string, o: Opts) => {
    let k = '';
    const dy = o.dy || 0, hx = 820, hy = 410 + dy * 1.4;
    ANCHORS.kidHead[name] = [hx + 2, hy - 40];
    const lA = ppgLeg(810, 498 + dy, o.crouch ? 796 : 804, 534, 18, skin, 196);
    const lB = ppgLeg(830, 498 + dy, o.crouch ? 846 : 838, 534, 18, skin, -16);
    k += blob([...lA.parts, ...lB.parts], lA.inner + lB.inner);
    const by = 452 + dy;
    const body = `M800,${by} C795,${by + 18} 797,${by + 38} 803,${by + 48} C815,${by + 54} 831,${by + 54} 839,${by + 48} C845,${by + 36} 845,${by + 16} 838,${by} C828,${by - 6} 810,${by - 6} 800,${by}Z`;
    const a1 = ppgArm(804, by + 10, o.l[0], o.l[1] + dy, 14, 22, skin, o.l[2]);
    const a2 = ppgArm(836, by + 10, o.r[0], o.r[1] + dy, 14, 22, skin, o.r[2]);
    k += blob([{ d: body, fill: '#ff8a1f' }, ...a1, ...a2]);
    const head = E(hx, hy, 46, 38, 0);
    const eL: Tup5 = [hx - 17, hy - 2, 18, 22, 0], eR: Tup5 = [hx + 17, hy - 2, 18, 22, 0];
    k += blob([{ d: head, fill: skin }, ppgEyeParts(...eL), ppgEyeParts(...eR)], '', ART.LW);
    const iris = o.pin ? { pin: true } : { iris: '#3fa0ff', irisLine: '#1a4a8a', irisScale: 0.62, pupilScale: 0.66, look: o.look || [0, 0.1] };
    k += ppgEyeInner(...eL, iris) + ppgEyeInner(...eR, iris);
    k += o.mouth === 'o' ? `<ellipse cx="${hx}" cy="${hy + 22}" rx="5" ry="7" fill="#3a0a1e" stroke="${INK}" stroke-width="3"/>`
      : `<path d="M${hx - 12},${hy + 18} C${hx - 6},${hy + 30} ${hx + 8},${hy + 30} ${hx + 14},${hy + 18}Z" fill="#3a0a1e" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>`;
    k += shape(`M${hx - 44},${hy - 6} C${hx - 46},${hy - 28} ${hx - 32},${hy - 42} ${hx - 16},${hy - 42} L${hx - 14},${hy - 62} L${hx + 2},${hy - 44} L${hx + 16},${hy - 66} L${hx + 20},${hy - 42} L${hx + 38},${hy - 56} L${hx + 34},${hy - 32} C${hx + 44},${hy - 24} ${hx + 46},${hy - 14} ${hx + 44},${hy - 6} C${hx + 20},${hy - 28} ${hx - 20},${hy - 28} ${hx - 44},${hy - 6}Z`, '#1a1018', ART.LW);
    return cel('kid', name, k);
  };
  s += stand('standA', { l: [774, 418, -6], r: [866, 470, 4] });
  s += stand('standB', { l: [774, 470, -4], r: [866, 418, 6] });
  s += stand('crouch', { l: [790, 486, 4], r: [850, 486, -4], dy: 10, crouch: true, pin: true, mouth: 'o' });
  return rig('kid', s, `transform="translate(140,-4)"`);
}

// Debris and confetti blown along the rays, plus a black PPG speed line. Each confetti piece is a
// rig so it can keep flying after the hero frame.
export const CONFETTI: { x: number; y: number; a: number }[] = [];
export function debris() {
  ART.seed = 41;
  let s = '';
  const cols = ['#ff3fae', '#9cff2e', '#ffffff', '#a35bff', '#ffd23f'];
  for (let i = 0; i < 46; i++) {
    const a = (-150 + rnd() * 165) * Math.PI / 180, r = 240 + rnd() * 1200;
    const x = BX + Math.cos(a) * r, y = BY - 30 + Math.sin(a) * r * 0.85;
    if (x > 1600 || y > 900 || y < -10) continue;
    const c = cols[Math.floor(rnd() * cols.length)];
    const w = f1(10 + rnd() * 10), h = f1(6 + rnd() * 6), rot = f1(rnd() * 180);
    CONFETTI.push({ x: +f1(x), y: +f1(y), a });
    s += rig('cf' + (CONFETTI.length - 1), `<rect x="${f1(x)}" y="${f1(y)}" width="${w}" height="${h}" fill="${c}" stroke="${INK}" stroke-width="2.4" transform="rotate(${rot} ${f1(x)} ${f1(y)})"/>`);
  }
  let l = '';
  for (const [x, y, len] of [[1460, 380, 110]]) {
    const a = Math.atan2(y - BY, x - BX);
    l += line(`M${x},${y} L${f1(x + Math.cos(a) * len)},${f1(y + Math.sin(a) * len)}`, 5, INK);
  }
  s += fxg('debrisLine', l);
  return s;
}
