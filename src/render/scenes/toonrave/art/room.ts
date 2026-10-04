import { INK, PLUM, ART, f1, rnd, shape, line, E, crSample, tubeD, crPath, poly, zpanel, glowCircle, glowEllipse, cel, rig, fxg } from "./lib";
// The room: black-heavy round chamber, ceiling ring with scallop lights, ribbed tubes,
// LED bars, porthole, monitor; a balcony rail with an angular crowd of small heads; the booth.
// The blast (flat ray burst in room colours) from the button.
//
// Prototype split: the drawing is the r11 still. The parts that move are wrapped in named groups
// (rig = transform, fxg = opacity, cel = swappable drawing); motion.js says what moves them. Every
// random draw keeps the still's order, so the hero frame is the still. New pieces (lasers, button
// glow, lamp dimmers, lens caps, extra scope traces, eye cels) draw nothing at the hero frame.
export const BX = 470, BY = 588; // button centre
export const LAMPS: number[] = [];          // x of each scallop lamp, left to right
export const LEDS: boolean[][] = [];           // [column][bar] -> true when lit in the still

export function room() {
  ART.seed = 21;
  let s = `<rect x="-400" y="-400" width="2400" height="1700" fill="#14060f"/>`;
  const panels = [[-260, 120, 300], [60, 140, 250], [330, 150, 230], [580, 150, 260], [860, 150, 240], [1120, 140, 260], [1400, 120, 330]];
  for (const [x, y, w] of panels) {
    const h = 420;
    s += zpanel(`M${x},${y} L${x + w},${y} L${x + w - 10},${y + h} L${x + 10},${y + h}Z`, '#2b0c27',
      `M${x + w * 0.62},${y} L${x + w},${y} L${x + w - 10},${y + h} L${x + w * 0.7},${y + h}Z`, '#1f081c',
      `M${x + 6},${y + 8} L${x + 14},${y + h - 8}`, '#5e2457');
    s += `<rect x="${x + w * 0.18}" y="${y + 40}" width="${w * 0.12}" height="${h - 120}" rx="6" fill="#190716" stroke="${PLUM}" stroke-width="2"/>`;
  }
  // LED bar arrays: every bar is drawn dark, its lit face a separate layer the meters switch.
  [[930, 230], [1010, 230], [-120, 250]].forEach(([x0, y0], col) => {
    LEDS[col] = [];
    for (let i = 0; i < 9; i++) {
      const on = rnd() > 0.35;
      LEDS[col][i] = on;
      s += `<rect x="${x0}" y="${y0 + i * 22}" width="52" height="14" rx="2" fill="#5a0d26" stroke="${PLUM}" stroke-width="1.6"/>`;
      s += `<g data-led="${col}:${i}"${on ? '' : ' style="display:none"'}><rect x="${x0}" y="${y0 + i * 22}" width="52" height="14" rx="2" fill="#e8204e" stroke="${PLUM}" stroke-width="1.6"/><rect x="${x0 + 4}" y="${y0 + i * 22 + 3}" width="20" height="3" fill="#ff9ab4"/></g>`;
    }
  });
  // porthole to space
  s += `<circle cx="760" cy="250" r="96" fill="#3a1440" stroke="${PLUM}" stroke-width="3"/>`;
  s += `<circle cx="760" cy="250" r="78" fill="#0b0620" stroke="#6b2a66" stroke-width="5"/>`;
  for (let i = 0; i < 40; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 72; s += `<circle cx="${760 + Math.cos(a) * r}" cy="${250 + Math.sin(a) * r}" r="${0.8 + rnd() * 1.6}" fill="#fff" opacity="${0.4 + rnd() * 0.6}"/>`; }
  s += `<circle cx="732" cy="232" r="22" fill="#4a7bff"/><path d="M712,236 a22,22 0 0 0 40,6 a26,26 0 0 1 -40,-6z" fill="#2440a8"/>`;
  s += line('M698,196 A80,80 0 0 1 760,172', 4, '#c25bb8');
  for (let i = 0; i < 10; i++) { const a = i / 10 * 6.283; s += `<circle cx="${760 + Math.cos(a) * 88}" cy="${250 + Math.sin(a) * 88}" r="4" fill="#7a2c70" stroke="${PLUM}" stroke-width="1.4"/>`; }
  // monitor with scanlines + waveform (left back); the trace flips between drawings on the beat
  s += zpanel('M120,250 L330,236 L338,392 L112,404Z', '#4a1640', 'M300,238 L330,236 L338,392 L306,394Z', '#33102d', 'M124,256 L320,244', '#a04a92', 2.6);
  s += `<path d="M138,266 L312,256 L318,378 L132,388Z" fill="#200a3a"/>`;
  for (let y = 262; y < 386; y += 6) s += `<line x1="132" y1="${y + (y - 262) * 0.05}" x2="318" y2="${y - 8 + (y - 262) * 0.05}" stroke="#3c1a66" stroke-width="2"/>`;
  s += cel('scope', 'hero', line('M142,330 L160,330 L168,300 L180,362 L192,284 L204,350 L216,318 L230,326 L240,296 L252,358 L264,316 L280,322 L308,318', 3.2, '#8cff3a'), true);
  for (let k = 0; k < 3; k++) {
    let d = 'M142,330 L160,330';
    for (let x = 168; x < 300; x += 12) d += ` L${x},${f1(326 - Math.sin(x * 0.11 + k * 2.1) * (18 + 16 * Math.sin(x * 0.05 + k)) * (k === 1 ? 1.4 : 1))}`;
    s += cel('scope', 'k' + k, line(d + ' L308,322', 3.2, '#8cff3a'));
  }
  // ceiling ring: a huge curved band with scalloped lights hanging under it
  const ring = (x: number) => 30 + Math.pow((x - 820) / 900, 2) * 210;
  let top = '', bot = '';
  for (let x = -400; x <= 2000; x += 40) { top += (x === -400 ? 'M' : 'L') + x + ',' + f1(ring(x) - 70); }
  for (let x = 2000; x >= -400; x -= 40) { bot += 'L' + x + ',' + f1(ring(x) + 40); }
  s += `<path d="${top}${bot}Z" fill="#5a1747" stroke="${PLUM}" stroke-width="3"/>`;
  let mid = '';
  for (let x = -400; x <= 2000; x += 40) mid += (x === -400 ? 'M' : 'L') + x + ',' + f1(ring(x) + 6);
  s += `<path d="${mid}${bot}Z" fill="#3d0f33"/>`;
  s += line(top.replace(/,(-?[\d.]+)/g, (_m: string, y: string) => ',' + f1(+y + 8)), 3, '#b04a9a');
  for (let x = -380; x < 2000; x += 120) s += line(`M${x},${f1(ring(x) - 64)} L${x + 6},${f1(ring(x) + 36)}`, 3, '#2a0a24');
  // scallop lights: white half-domes under the band, pink glow below. Each lamp's glow and a dark
  // dimmer over its dome are their own layers, so the chase can light one lamp at a time.
  let glow = '', dome = '';
  for (let x = -360; x < 2000; x += 96) {
    const y = ring(x) + 40, i = LAMPS.length;
    LAMPS.push(x);
    glow += glowEllipse(x, y + 10, 52, 30, 16, '#ff4fb6', `data-o="lampGlow${i}"`);
    const cup = `M${x - 36},${y} A36,22 0 0 0 ${x + 36},${y}Z`;
    dome += `<path d="${cup}" fill="#fff4fb" stroke="${PLUM}" stroke-width="2.4"/>`;
    dome += `<path d="M${x - 30},${y + 3} A30,14 0 0 0 ${x + 30},${y + 3}" fill="none" stroke="#ff9ad6" stroke-width="3"/>`;
    dome += `<path d="${cup}" fill="#3a0a30" data-o="lampDim${i}" opacity="0" style="display:none"/>`;
  }
  s += glow + dome;   // the still's 0.7 group opacity is folded into each glow (motion.js LAMP_GLOW)
  s += tube([[-60, 120], [40, 260], [20, 430], [120, 560]], 46, '#4e1a48', '#2a0b27', '#9a4b8c');
  s += tube([[1560, 140], [1500, 330], [1580, 470]], 40, '#4e1a48', '#2a0b27', '#9a4b8c');
  return s;
}

// A ribbed tube: base + shadow side + rim + rib rings.
export function tube(pts: number[][], w: number, base: string, shade: string, rim: string) {
  let s = shape(tubeD(pts, pts.map(() => w), 40), base, 1.4, PLUM);
  const S = crSample(pts, 40);
  const sh = tubeD(pts.map((p) => [p[0] + w * 0.22, p[1]]), pts.map(() => w * 0.45), 40);
  s += `<path d="${sh}" fill="${shade}" opacity="0.9"/>`;
  for (let i = 1; i < S.length - 1; i += 3) {
    const a = S[i - 1], b = S[i + 1];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy); dx /= l; dy /= l;
    const p = S[i];
    s += line(`M${f1(p[0] - dy * w / 2)},${f1(p[1] + dx * w / 2)} Q${f1(p[0] + dx * 7)},${f1(p[1] + dy * 7)} ${f1(p[0] + dy * w / 2)},${f1(p[1] - dx * w / 2)}`, 2.4, PLUM);
  }
  s += line(crPath(pts.map((p) => [p[0] - w * 0.28, p[1]])), 2.6, rim);
  return s;
}

// The back crowd: rows of small heads behind a curved balcony rail, angular mass.
// Each row is a rig (it bounces); each head carries three eye cels switched per row by class:
// e0 = the still's pinpoint squint, e1 = grooving (big pupils toward the DJ), e2 = wide-eyed.
export const railY = (x: number) => 560 - (x - 600) * 0.03 + Math.pow((x - 1100) / 700, 2) * 20;
export function backCrowd() {
  ART.seed = 5;
  let s = '';
  const cols = ['#ffc7b0', '#f2b3c8', '#c9e88a', '#ffd9a8', '#d9c2ff'];
  for (let row = 0; row < 3; row++) {
    let rs = '';
    for (let x = 600 + row * 22; x < 1700; x += 46 + rnd() * 10) {
      const y = railY(x) - 34 - row * 26 + rnd() * 6;
      const r = 17 - row * 2.5;
      const c = cols[Math.floor(rnd() * cols.length)];
      const lit = 0.55 + row * 0.12;
      let g = '';
      if (rnd() > 0.35) {
        const side = rnd() > 0.5 ? 1 : -1;
        g += `<path d="${tubeD([[x + side * r * 0.6, y + r * 0.6], [x + side * r * 1.3, y - r * 1.2]], [r * 0.45, r * 0.4], 8)}" fill="${c}" stroke="${INK}" stroke-width="3" paint-order="stroke"/>`;
        g += `<circle cx="${x + side * r * 1.35}" cy="${y - r * 1.35}" r="${r * 0.34}" fill="${c}" stroke="${INK}" stroke-width="2.6" paint-order="stroke"/>`;
      }
      const kind = rnd();
      let head;
      if (kind < 0.35) head = `M${x - r * 0.8},${y + r} L${x - r * 0.9},${y - r * 1.2} L${x - r * 0.3},${y - r * 1.5} L${x},${y - r * 1.25} L${x + r * 0.35},${y - r * 1.55} L${x + r * 0.9},${y - r * 1.2} L${x + r * 0.8},${y + r}Z`;
      else head = E(x, y, r * 1.1, r * 0.95);
      g += `<path d="${head}" fill="${c}" stroke="${INK}" stroke-width="3" paint-order="stroke" stroke-linejoin="round"/>`;
      const eye = (ex: number, rx: number, ry: number) => `<ellipse cx="${f1(ex)}" cy="${f1(y - r * 0.05)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
      let e0 = `<ellipse cx="${x - r * 0.38}" cy="${y - r * 0.05}" rx="${r * 0.33}" ry="${r * 0.42}" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
      e0 += `<ellipse cx="${x + r * 0.38}" cy="${y - r * 0.05}" rx="${r * 0.33}" ry="${r * 0.42}" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`;
      e0 += `<circle cx="${x - r * 0.42}" cy="${y}" r="${r * 0.08}" fill="${INK}"/><circle cx="${x + r * 0.34}" cy="${y}" r="${r * 0.08}" fill="${INK}"/>`;
      let e1 = eye(x - r * 0.38, r * 0.33, r * 0.42) + eye(x + r * 0.38, r * 0.33, r * 0.42);
      e1 += `<circle cx="${f1(x - r * 0.46)}" cy="${f1(y + r * 0.02)}" r="${f1(r * 0.21)}" fill="${INK}"/><circle cx="${f1(x + r * 0.3)}" cy="${f1(y + r * 0.02)}" r="${f1(r * 0.21)}" fill="${INK}"/>`;
      e1 += `<circle cx="${f1(x - r * 0.41)}" cy="${f1(y - r * 0.06)}" r="${f1(r * 0.08)}" fill="#fff"/><circle cx="${f1(x + r * 0.35)}" cy="${f1(y - r * 0.06)}" r="${f1(r * 0.08)}" fill="#fff"/>`;
      let e2 = eye(x - r * 0.42, r * 0.42, r * 0.54) + eye(x + r * 0.42, r * 0.42, r * 0.54);
      e2 += `<circle cx="${f1(x - r * 0.42)}" cy="${f1(y - r * 0.05)}" r="${f1(r * 0.07)}" fill="${INK}"/><circle cx="${f1(x + r * 0.42)}" cy="${f1(y - r * 0.05)}" r="${f1(r * 0.07)}" fill="${INK}"/>`;
      g += `<g class="e0">${e0}</g><g class="e1">${e1}</g><g class="e2">${e2}</g>`;
      g += `<ellipse cx="${x}" cy="${y + r * 0.55}" rx="${r * 0.12}" ry="${r * 0.16}" fill="${INK}"/>`;
      rs += `<g opacity="${lit}">${g}</g>`;
    }
    s += rig('crowd' + row, rs, 'class="ev0"');
  }
  s += `<rect x="560" y="420" width="1200" height="200" fill="#3a0a30" opacity="0.18"/>`;
  let rp = [];
  for (let x = 560; x <= 1720; x += 80) rp.push([x, railY(x)]);
  s += `<path d="M560,${railY(560)} ${rp.map(p => 'L' + f1(p[0]) + ',' + f1(p[1])).join('')} L1720,640 L560,640Z" fill="#2b0a24" stroke="${PLUM}" stroke-width="2"/>`;
  for (let x = 600; x < 1720; x += 110) s += `<rect x="${x}" y="${railY(x)}" width="10" height="70" fill="#4a1640" stroke="${PLUM}" stroke-width="1.6"/>`;
  s += `<path d="${tubeD(rp, rp.map(() => 22), 60)}" fill="#b03a8a" stroke="${PLUM}" stroke-width="2.6"/>`;
  s += line(crPath(rp.map(p => [p[0], p[1] - 5])), 4, '#ffc2e8');
  return s;
}

// Floor: deep red-plum with round lit pads. Each pad is its own layer so it can pulse.
export function floor() {
  let s = `<path d="M-400,610 L2000,560 L2000,1300 L-400,1300Z" fill="#3d0b25"/>`;
  s += `<path d="M-400,640 L2000,600 L2000,620 L-400,662Z" fill="#2a0619"/>`;
  ([[880, 700, 70, '#c04bff'], [1160, 680, 60, '#c04bff'], [1000, 820, 90, '#8cff3a'], [1500, 650, 50, '#c04bff']] as [number, number, number, string][]).forEach(([x, y, rx, c], i) => {
    s += fxg('pad' + i, `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx * 0.28}" fill="${c}" opacity="0.9" stroke="${PLUM}" stroke-width="2"/><ellipse cx="${x - rx * 0.2}" cy="${y - rx * 0.06}" rx="${rx * 0.5}" ry="${rx * 0.1}" fill="#fff" opacity="0.5"/>`);
  });
  return s;
}

// Two laser beams from the ceiling (new; hidden at the hero frame). Each beam points along +x from
// its source and motion.js rotates it.
export const LASERS: [number, number, string][] = [[150, 70, '#8cff3a'], [1470, 60, '#ff4fd8']];
export function lasers() {
  return LASERS.map(([_x, _y, c], i) => rig('laser' + i,
    `<path d="M0,-3 L1900,-22 L1900,22 L0,3Z" fill="${c}" opacity="0.4"/><path d="M0,-1.4 L1900,-7 L1900,7 L0,1.4Z" fill="#f4ffe8" opacity="0.55"/>${glowCircle(0, 0, 12, 8, c)}<circle r="6" fill="#fff"/>`,
    'style="display:none"')).join('');
}

// The blast: hard-edged flat rays from the button, room colours, over the room.
export function blast() {
  ART.seed = 99;
  let s = '';
  const rays = [];
  let a = -200;
  while (a < 25) {
    const w = 4 + rnd() * 8;
    rays.push([a, a + w]);
    a += w + 8 + rnd() * 12;
  }
  const L = 2400;
  let pinks = '', pales = '', greens = '';
  rays.forEach(([a0, a1], i) => {
    const r0 = a0 * Math.PI / 180, r1 = a1 * Math.PI / 180;
    const d = `M${BX},${BY} L${f1(BX + Math.cos(r0) * L)},${f1(BY + Math.sin(r0) * L)} L${f1(BX + Math.cos(r1) * L)},${f1(BY + Math.sin(r1) * L)}Z`;
    if (i % 5 === 3) greens += `<path d="${d}"/>`;
    else if (i % 2) pales += `<path d="${d}"/>`;
    else pinks += `<path d="${d}"/>`;
  });
  s += rig('rays', `<g fill="#ff2fa4" opacity="0.5" data-ray="0.5" style="mix-blend-mode:screen">${pinks}</g><g fill="#ffb3e3" opacity="0.36" data-ray="0.36" style="mix-blend-mode:screen">${pales}</g><g fill="#8cff3a" opacity="0.3" data-ray="0.3" style="mix-blend-mode:screen">${greens}</g>`);
  s += fxg('glowCore', glowCircle(BX, BY - 30, 260, 40, '#ff7fd0', 'opacity="0.55"'));
  const star = (R0: number, R1: number, n: number, rot: number) => {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const aa = rot + i / (n * 2) * Math.PI * 2;
      const rr = i % 2 ? R0 * (0.8 + rnd() * 0.3) : R1 * (0.75 + rnd() * 0.45);
      p.push([BX + Math.cos(aa) * rr, BY - 30 + Math.sin(aa) * rr * 0.8]);
    }
    return poly(p);
  };
  s += rig('star', `<path d="${star(150, 330, 14, 0.1)}" fill="#ff8fd6"/><path d="${star(110, 230, 12, 0.3)}" fill="#ffe3f5"/><path d="${star(70, 150, 10, 0.05)}" fill="#ffffff"/>`);
  return s;
}

// The booth: spiky tech console, thin plum line, hard shade, rim lights, claws, lenses.
export function booth() {
  let s = '';
  const claw = (x: number, y: number, dir: number, h: number) => {
    const d = `M${x - 26},${y} C${x - 20},${y - h * 0.5} ${x + dir * 20},${y - h * 0.9} ${x + dir * 70},${y - h} C${x + dir * 30},${y - h * 0.7} ${x + 24},${y - h * 0.4} ${x + 26},${y}Z`;
    return zpanel(d, '#3e3346', `M${x + 4},${y} C${x + 6},${y - h * 0.45} ${x + dir * 30},${y - h * 0.78} ${x + dir * 70},${y - h} C${x + dir * 34},${y - h * 0.68} ${x + 24},${y - h * 0.4} ${x + 26},${y}Z`, '#26202c',
      `M${x - 18},${y - 10} C${x - 12},${y - h * 0.5} ${x + dir * 18},${y - h * 0.85} ${x + dir * 60},${y - h * 0.97}`, '#b9a3c9', 2);
  };
  s += claw(130, 640, -1, 230) + claw(800, 610, 1, 250);
  s += tube([[60, 900], [90, 760], [170, 700]], 34, '#3a1238', '#240a22', '#8a3c80');
  s += zpanel('M80,620 L860,585 L900,640 L60,690Z', '#b02a6a', 'M60,690 L900,640 L896,652 L62,704Z', '#6e1440', 'M92,622 L852,588', '#ff9ad2', 2.4);
  s += zpanel('M60,690 L900,640 L950,1000 L20,1000Z', '#8c1a4f', 'M620,655 L900,640 L950,1000 L700,1000Z', '#5c0f35', 'M68,700 L892,652', '#ff7fc0', 2.4);
  for (let i = 0; i < 9; i++) {
    const t = i / 8, x = 80 + t * 800, y = 694 - t * 50;
    s += zpanel(`M${x - 14},${y} L${x},${y + 34} L${x + 14},${y - 1}Z`, '#d9d0e4', `M${x},${y + 34} L${x + 14},${y - 1} L${x + 4},${y}Z`, '#8d84a0', null, null, 1.6);
  }
  s += zpanel('M120,760 L420,740 L428,900 L112,920Z', '#2a0a1e', null, null, 'M124,766 L414,746', '#7a2f68');
  for (let i = 0; i < 4; i++) {
    const x = 160 + i * 72, y = 790 - i * 5;
    s += `<circle cx="${x}" cy="${y}" r="24" fill="#ff2a3a" stroke="${PLUM}" stroke-width="3"/><circle cx="${x}" cy="${y}" r="14" fill="#ff8a96"/><circle cx="${x - 6}" cy="${y - 7}" r="5" fill="#fff"/>`;
    // the lens dims between its beats: a dark cap (absent at the hero frame)
    s += `<circle cx="${x}" cy="${y}" r="22.5" fill="#4a0816" data-o="lens${i}" opacity="0" style="display:none"/>`;
  }
  s += zpanel('M470,736 L790,716 L800,870 L476,890Z', '#16210c', null, null, null, null, 3);
  for (let y = 742; y < 884; y += 7) s += `<line x1="474" y1="${y}" x2="798" y2="${y - 20}" stroke="#203414" stroke-width="2.4"/>`;
  s += cel('wave', 'hero', line('M484,812 L520,810 L534,760 L552,866 L572,744 L596,880 L620,770 L640,846 L664,792 L700,800 L790,788', 4, '#8cff3a'), true);
  for (let k = 0; k < 4; k++) {   // the bass scope: four more traces, one per beat
    let d = 'M484,812';
    for (let x = 500; x <= 790; x += 14) {
      const tt = (x - 484) / 306, env = Math.sin(tt * Math.PI) * (1 - 0.18 * k);
      d += ` L${x},${f1(806 - tt * 20 + Math.sin(tt * (9 + k * 5) + k) * 52 * env * (k % 2 ? 0.6 : 1))}`;
    }
    s += cel('wave', 'k' + k, line(d, 4, '#8cff3a'));
  }
  [[230, 640], [710, 612]].forEach(([x, y], i) => {
    s += `<ellipse cx="${x}" cy="${y}" rx="96" ry="26" fill="#2a2030" stroke="${PLUM}" stroke-width="2.4"/>`;
    s += `<ellipse cx="${x}" cy="${y - 4}" rx="80" ry="20" fill="#120c16"/>`;
    s += `<ellipse cx="${x}" cy="${y - 4}" rx="24" ry="7" fill="#8cff3a"/>`;
    s += cel('groove' + i, 'hero', line(`M${x - 60},${y - 8} A60,14 0 0 1 ${x + 40},${y - 16}`, 2, '#5a4a66'), true);
    // the record spins: three more groove-glint drawings around the platter ellipse
    for (let k = 1; k < 4; k++) {
      const a0 = Math.PI * (1.08 + k * 0.5), a1 = a0 + 1.9;
      const p0 = [x + Math.cos(a0) * 60, y - 4 + Math.sin(a0) * 14], p1 = [x + Math.cos(a1) * 60, y - 4 + Math.sin(a1) * 14];
      s += cel('groove' + i, 'k' + k, line(`M${f1(p0[0])},${f1(p0[1])} A60,14 0 0 1 ${f1(p1[0])},${f1(p1[1])}`, 2, '#5a4a66'));
    }
  });
  return s;
}

// The button's glow for the build (new; dark at the hero frame).
export function buttonGlow() {
  return fxg('btnGlow', glowEllipse(BX, BY - 26, 170, 90, 40, '#ff3f7a'), 'style="display:none"');
}

// The giant button: thick-black prop line on the room hardware. Squashed by the slam; the dome
// is a rig so it can stand tall in the groove and squash back to the still at the drop.
export function button() {
  let s = '';
  s += shape(E(BX, BY + 6, 132, 40), '#2a2230', 5);
  for (let i = 0; i < 18; i++) {
    const a = Math.PI * (0.05 + 0.9 * i / 17);
    s += line(`M${f1(BX - Math.cos(a) * 128)},${f1(BY + 6 + Math.sin(a) * 36)} L${f1(BX - Math.cos(a) * 112)},${f1(BY + 6 + Math.sin(a) * 26)}`, 2.6, '#5a4a66');
  }
  const dome = `M${BX - 124},${BY + 2} C${BX - 130},${BY - 40} ${BX - 70},${BY - 58} ${BX},${BY - 58} C${BX + 70},${BY - 58} ${BX + 130},${BY - 40} ${BX + 124},${BY + 2} C${BX + 80},${BY + 22} ${BX - 80},${BY + 22} ${BX - 124},${BY + 2}Z`;
  let d = shape(dome, '#ff1f3d', 5.5);
  d += `<path d="M${BX + 40},${BY - 50} C${BX + 96},${BY - 46} ${BX + 120},${BY - 22} ${BX + 120},${BY} C${BX + 90},${BY + 14} ${BX + 60},${BY + 16} ${BX + 40},${BY + 16} C${BX + 70},${BY - 6} ${BX + 70},${BY - 30} ${BX + 40},${BY - 50}Z" fill="#c4102c"/>`;
  d += `<path d="M${BX - 96},${BY - 22} C${BX - 80},${BY - 44} ${BX - 40},${BY - 50} ${BX - 16},${BY - 48}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>`;
  s += rig('dome', d);
  return s;
}
