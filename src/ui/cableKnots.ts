/**
 * The knots on the pinned setting's cables (cableLayer.ts draws the cable in
 * two halves around each one): a small bead sitting in its cable in the open
 * gap between the meters and settings columns, the cable running into its
 * left edge and out of its right. It has three states:
 *  - rest: a bead, hollow on a plain wire, or filled with the wire's colour
 *    and a glyph of the modifier's transfer curve (`CableKnotSpec.curve`);
 *  - peek: hovered (the knot, or its cable via setPeek) or focused, a small
 *    pill with a live graph of the wire's input and output;
 *  - open: clicked, a panel holding whatever `CableKnotSpec.buildBody` builds
 *    (deviceMenu.ts: the wire's Height, weight, modifier and Unplug).
 * One knot opens at a time; the others dim while it is open.
 *
 * A closed knot sits on its cable, so a press on it can pull the cable too:
 * the press goes to the layer's `onPress` (cableLayer.ts's startPull), and
 * while that pull is held drag() keeps the knot at the pointer, at rest size,
 * with the cable's halves following it. A press that moved never opens the
 * knot.
 *
 * HTML over the SVG, not SVG, because an open knot holds real controls. It
 * lives on `<body>`, outside `.vc-root`, for the same reason the cable layer
 * does: every card clips its overflow, and a knot sits over the gap between
 * cards.
 *
 * Knots are kept by key across sync() calls, since a scroll recomputes every
 * cable and must never tear out the open knot's body (or a slider in it
 * mid-drag). The motion (centre, width, height) is a spring stepped in tick(),
 * so the cable's halves can follow an open knot's edges every frame: tick()
 * only writes styles, never reads layout. A peek's pill sits over a still
 * cable instead (`Knot.cableW`): a cable reshaped under the pointer slides out
 * from under it, ends the peek, and springs back under it again. The fades (body, peek graph, glyph,
 * dimming) are CSS transitions (controlsTheme.ts's `.vc-knot` rules).
 *
 * The graphs keep the panel's convention: newest sample at the right, a fixed
 * 0..1 scale.
 */

export interface CableKnotBody {
  el: HTMLElement;
  /** Where the cable enters the open knot: its centre's height in the body. Absent: the header's middle. */
  entryEl?: HTMLElement;
  /** Once per frame while open. */
  update(): void;
  /** The knot closed (or its body is being rebuilt). */
  dispose(): void;
}

export interface CableKnotSpec {
  /** The wire's name, for aria. */
  label: string;
  /** Samples of the modifier's transfer curve over 0..1 for the rest glyph; null for a plain wire (a hollow bead). */
  curve: readonly number[] | null;
  /** Live input and output; null when nothing reads. Read every tick. */
  read(): { input: number; output: number } | null;
  /** The open knot's body, built on each open and on ctx.rebuild(). */
  buildBody(ctx: { close(): void; rebuild(): void }): CableKnotBody;
}

export interface CableKnotPlacement {
  key: string;
  color: string;
  /** The rest point, on the whole cable's bend (cableLayer.ts's cablePointAt). */
  anchor: { x: number; y: number };
  /** The open gap between the two cards (cableLayer.ts's press band). */
  gap: { left: number; right: number };
  spec: CableKnotSpec;
}

export interface CableKnotGeometry {
  cx: number;
  /** Where both cable halves meet the knot: its sides when open, its rest bead's otherwise. */
  entryY: number;
  left: number;
  right: number;
}

export interface CableKnotLayer {
  el: HTMLDivElement;
  /** Called from cableLayer.ts's recompute() write pass; `viewport` was read in its read pass. */
  sync(knots: readonly CableKnotPlacement[], viewport: { w: number; h: number }): void;
  tick(dtSec: number): void;
  setPeek(key: string, on: boolean): void;
  open(key: string): void;
  close(): void;
  openKey(): string | null;
  setVisible(v: boolean): void;
  /** The knot's current (animated) geometry, or null when it has none. */
  geometry(key: string): CableKnotGeometry | null;
  /** Holds a knot at `at` while its cable is pulled by it (see this file's
   *  header); null lets it spring back onto its cable. */
  drag(key: string, at: { x: number; y: number } | null): void;
}

const REST_PX = 18;
const PEEK_W_PX = 116;
const PEEK_H_PX = 36;
const OPEN_W_PX = 272;
/** Room kept between an open knot and the gap's or the viewport's edge. */
const OPEN_MARGIN_PX = 12;
/** The peek graph's inset inside the pill's border. */
const PEEK_INSET_PX = 3;
/** Samples the peek graph keeps: its time span. */
const PEEK_RING = 140;
/** A spring a little under critical damping, for the mockup's slight overshoot. */
const SPRING_STIFFNESS = 420;
const SPRING_DAMPING = 27;
/** Longest spring step: a longer frame is split so the spring stays stable. */
const SPRING_MAX_STEP_SEC = 1 / 120;
const SPRING_SETTLE_PX = 0.15;
const SPRING_SETTLE_SPEED = 2;
/** How far the output must move before the glow is rewritten. */
const GLOW_STEP = 0.03;
const INPUT_TRACE = "rgba(255,255,255,0.35)";
const GLYPH_STROKE = "#17131c";
const SVG_NS = "http://www.w3.org/2000/svg";

let reduceMotionMQ: MediaQueryList | null = null;
const reduceMotion = () => (reduceMotionMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;

interface Spring {
  v: number;
  vel: number;
  to: number;
}

function spring(v: number): Spring {
  return { v, vel: 0, to: v };
}

/** Steps `s` toward its target; true while it is still moving. */
function stepSpring(s: Spring, dt: number, snap: boolean): boolean {
  if (snap || (Math.abs(s.to - s.v) < SPRING_SETTLE_PX && Math.abs(s.vel) < SPRING_SETTLE_SPEED)) {
    const moved = s.v !== s.to;
    s.v = s.to;
    s.vel = 0;
    return moved;
  }
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, SPRING_MAX_STEP_SEC);
    s.vel += (SPRING_STIFFNESS * (s.to - s.v) - SPRING_DAMPING * s.vel) * h;
    s.v += s.vel * h;
    left -= h;
  }
  return true;
}

function settled(s: Spring): boolean {
  return s.v === s.to && s.vel === 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}

interface Knot {
  key: string;
  color: string;
  spec: CableKnotSpec;
  anchor: { x: number; y: number };
  gap: { left: number; right: number };
  el: HTMLDivElement;
  glyphPath: SVGPathElement;
  peekCanvas: HTMLCanvasElement;
  peekCtx: CanvasRenderingContext2D | null;
  peekDpr: number;
  bodyHost: HTMLDivElement;
  body: CableKnotBody | null;
  openH: number;
  /** The cable's entry height within the open body; Infinity until first measured. */
  entryOff: number;
  /** The springs were replaced by a snap, so the element's left/top are stale though nothing is moving. */
  snapped: boolean;
  x: Spring;
  y: Spring;
  w: Spring;
  h: Spring;
  /** The width the cable's halves end at: the open width when open, else the rest bead's, never the peek's. */
  cableW: Spring;
  hoverPeek: boolean;
  cablePeek: boolean;
  focusPeek: boolean;
  /** Where a pull by this knot holds it (drag), or null. */
  dragAt: { x: number; y: number } | null;
  /** The last press dragged the knot, so the click that ends it isn't an open. */
  dragged: boolean;
  inRing: Float32Array;
  outRing: Float32Array;
  ringHead: number;
  glow: number;
  shownState: "" | "rest" | "peek" | "open";
  shownDim: boolean;
  shownCurve: readonly number[] | null | undefined;
}

function glyphD(curve: readonly number[]): string {
  const n = curve.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = 2 + (10 * i) / Math.max(1, n - 1);
    const y = 12 - 10 * clamp(curve[i]!, 0, 1);
    d += `${i === 0 ? "M" : " L"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

/** `onPress` gets a press on a closed knot, by the knot's key (see this
 *  file's header). */
export function createCableKnotLayer(onPress?: (key: string, e: PointerEvent) => void): CableKnotLayer {
  const layer = document.createElement("div");
  layer.className = "vc-knot-layer";
  const knots = new Map<string, Knot>();
  let openKey: string | null = null;
  let viewport = { w: window.innerWidth, h: window.innerHeight };

  const isPeek = (k: Knot): boolean => openKey === null && !k.dragAt && (k.hoverPeek || k.cablePeek || k.focusPeek);
  const stateOf = (k: Knot): "rest" | "peek" | "open" => (openKey === k.key ? "open" : isPeek(k) ? "peek" : "rest");

  function openX(k: Knot): number {
    const { left, right } = k.gap;
    if (right - left >= OPEN_W_PX + 2 * OPEN_MARGIN_PX) return (left + right) / 2;
    return clamp(k.anchor.x, OPEN_W_PX / 2 + OPEN_MARGIN_PX, viewport.w - OPEN_W_PX / 2 - OPEN_MARGIN_PX);
  }

  function clampOpenY(k: Knot, y: number): number {
    return clamp(y, k.openH / 2 + OPEN_MARGIN_PX, viewport.h - k.openH / 2 - OPEN_MARGIN_PX);
  }

  /** Sets each spring's target for the knot's current state. */
  function aim(k: Knot): void {
    const st = stateOf(k);
    k.cableW.to = st === "open" ? OPEN_W_PX : REST_PX;
    if (st === "open") {
      k.w.to = OPEN_W_PX;
      k.h.to = k.openH;
      return;
    }
    k.x.to = k.dragAt?.x ?? k.anchor.x;
    k.y.to = k.dragAt?.y ?? k.anchor.y;
    k.w.to = st === "peek" ? PEEK_W_PX : REST_PX;
    k.h.to = st === "peek" ? PEEK_H_PX : REST_PX;
  }

  function aimAll(): void {
    for (const k of knots.values()) aim(k);
  }

  function makeKnot(p: CableKnotPlacement): Knot {
    const el = document.createElement("div");
    el.className = "vc-knot vc-knot-rest";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute("aria-expanded", "false");
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "vc-knot-glyph");
    svg.setAttribute("width", "14");
    svg.setAttribute("height", "14");
    svg.setAttribute("viewBox", "0 0 14 14");
    svg.setAttribute("aria-hidden", "true");
    const glyphPath = document.createElementNS(SVG_NS, "path");
    glyphPath.setAttribute("stroke", GLYPH_STROKE);
    glyphPath.setAttribute("stroke-width", "1.7");
    glyphPath.setAttribute("fill", "none");
    glyphPath.setAttribute("stroke-linecap", "round");
    svg.append(glyphPath);
    const peekCanvas = document.createElement("canvas");
    peekCanvas.className = "vc-knot-peek";
    peekCanvas.setAttribute("aria-hidden", "true");
    const bodyHost = document.createElement("div");
    bodyHost.className = "vc-knot-body";
    bodyHost.style.width = `${OPEN_W_PX}px`;
    el.append(svg, peekCanvas, bodyHost);
    const k: Knot = {
      key: p.key,
      color: p.color,
      spec: p.spec,
      anchor: p.anchor,
      gap: p.gap,
      el,
      glyphPath,
      peekCanvas,
      peekCtx: null,
      peekDpr: 0,
      bodyHost,
      body: null,
      openH: REST_PX,
      entryOff: Number.POSITIVE_INFINITY,
      snapped: false,
      x: spring(p.anchor.x),
      y: spring(p.anchor.y),
      w: spring(REST_PX),
      h: spring(REST_PX),
      cableW: spring(REST_PX),
      hoverPeek: false,
      cablePeek: false,
      focusPeek: false,
      dragAt: null,
      dragged: false,
      inRing: new Float32Array(PEEK_RING),
      outRing: new Float32Array(PEEK_RING),
      ringHead: 0,
      glow: -1,
      shownState: "",
      shownDim: false,
      shownCurve: undefined,
    };
    el.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      k.hoverPeek = true;
      aim(k);
    });
    el.addEventListener("pointerleave", () => {
      k.hoverPeek = false;
      aim(k);
    });
    el.addEventListener("focus", () => {
      // Keyboard focus only: a tap focuses the knot too, and a tap's peek
      // should end when the pointer leaves, not on blur.
      k.focusPeek = el.matches(":focus-visible");
      aim(k);
    });
    el.addEventListener("blur", () => {
      k.focusPeek = false;
      aim(k);
    });
    el.addEventListener("pointerdown", (e) => {
      k.dragged = false;
      if (openKey !== k.key) onPress?.(k.key, e);
    });
    el.addEventListener("click", () => {
      if (!k.dragged && openKey !== k.key) open(k.key);
    });
    el.addEventListener("keydown", (e) => {
      if (e.target === el && (e.key === "Enter" || e.key === " ") && openKey !== k.key) {
        e.preventDefault();
        open(k.key);
      }
    });
    return k;
  }

  /** Builds the body and measures it at the open width. An event-time read
   *  (open, rebuild), never in tick(). */
  function mountBody(k: Knot): void {
    const body = k.spec.buildBody({
      close: () => {
        if (openKey === k.key) closeOpen(true);
      },
      rebuild: () => {
        if (openKey !== k.key) return;
        k.body?.dispose();
        mountBody(k);
        k.y.to = clampOpenY(k, k.y.to);
        aim(k);
      },
    });
    k.body = body;
    k.bodyHost.replaceChildren(body.el);
    k.openH = k.bodyHost.offsetHeight;
    const hostTop = k.bodyHost.getBoundingClientRect().top;
    // The entry element's middle, else the header's (the body's first child).
    const entry = body.entryEl ?? body.el.firstElementChild;
    if (entry) {
      const r = entry.getBoundingClientRect();
      k.entryOff = r.top - hostTop + r.height / 2;
    } else {
      k.entryOff = k.openH / 2;
    }
  }

  function open(key: string): void {
    const k = knots.get(key);
    if (!k || openKey === key) return;
    if (openKey !== null) closeOpen(false);
    openKey = key;
    mountBody(k);
    k.x.to = openX(k);
    k.y.to = clampOpenY(k, k.anchor.y);
    aimAll();
    document.addEventListener("pointerdown", onOutsidePointerDown, true);
  }

  function closeOpen(refocus: boolean): void {
    const k = openKey === null ? undefined : knots.get(openKey);
    openKey = null;
    document.removeEventListener("pointerdown", onOutsidePointerDown, true);
    if (k) {
      const body = k.body;
      k.body = null;
      body?.dispose();
      if (refocus) k.el.focus({ preventScroll: true });
    }
    aimAll();
  }

  function onOutsidePointerDown(e: PointerEvent): void {
    const k = openKey === null ? undefined : knots.get(openKey);
    if (k && !k.el.contains(e.target as Node | null)) closeOpen(false);
  }

  layer.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || openKey === null) return;
    e.preventDefault();
    e.stopPropagation();
    closeOpen(true);
  });

  function removeKnot(k: Knot): void {
    if (openKey === k.key) closeOpen(false);
    k.el.remove();
    knots.delete(k.key);
  }

  function sync(list: readonly CableKnotPlacement[], vp: { w: number; h: number }): void {
    viewport = vp;
    const live = new Set<string>();
    for (const p of list) {
      live.add(p.key);
      let k = knots.get(p.key);
      if (!k) {
        k = makeKnot(p);
        knots.set(p.key, k);
        layer.append(k.el);
      }
      const gapMoved = k.gap.left !== p.gap.left || k.gap.right !== p.gap.right;
      k.color = p.color;
      k.spec = p.spec;
      k.anchor = p.anchor;
      k.gap = p.gap;
      // The rebuilt cable's hit stroke never sends the old one's leave.
      k.cablePeek = false;
      k.el.style.setProperty("--c", p.color);
      k.el.setAttribute("aria-label", `${p.spec.label}: Height and modifier`);
      if (openKey === k.key) {
        if (gapMoved) k.x.to = openX(k);
      } else {
        // A scroll moves the cable's middle: a knot at rest follows at once
        // rather than springing after it. A dragged knot stays at the pointer.
        if (!k.dragAt && settled(k.x) && settled(k.y)) {
          k.x = spring(p.anchor.x);
          k.y = spring(p.anchor.y);
          k.snapped = true;
        }
        aim(k);
      }
    }
    for (const k of [...knots.values()]) if (!live.has(k.key)) removeKnot(k);
  }

  function drawPeek(k: Knot): void {
    const cw = PEEK_W_PX - 2 * PEEK_INSET_PX;
    const ch = PEEK_H_PX - 2 * PEEK_INSET_PX;
    const dpr = window.devicePixelRatio || 1;
    if (!k.peekCtx || k.peekDpr !== dpr) {
      k.peekCanvas.width = Math.round(cw * dpr);
      k.peekCanvas.height = Math.round(ch * dpr);
      k.peekCtx = k.peekCanvas.getContext("2d");
      k.peekDpr = dpr;
    }
    const ctx = k.peekCtx;
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const pad = 2;
    const X = (i: number) => (cw * i) / (PEEK_RING - 1);
    const Y = (v: number) => pad + (ch - 2 * pad) * (1 - clamp(v, 0, 1));
    // Oldest at ringHead, so the newest lands at the right edge.
    const at = (ring: Float32Array, i: number) => ring[(k.ringHead + i) % PEEK_RING]!;
    ctx.beginPath();
    ctx.moveTo(0, Y(0));
    for (let i = 0; i < PEEK_RING; i++) ctx.lineTo(X(i), Y(at(k.outRing, i)));
    ctx.lineTo(cw, Y(0));
    ctx.closePath();
    ctx.fillStyle = k.color;
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = k.color;
    ctx.beginPath();
    for (let i = 0; i < PEEK_RING; i++) ctx.lineTo(X(i), Y(at(k.outRing, i)));
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = INPUT_TRACE;
    ctx.beginPath();
    for (let i = 0; i < PEEK_RING; i++) ctx.lineTo(X(i), Y(at(k.inRing, i)));
    ctx.stroke();
  }

  function tick(dtSec: number): void {
    const snap = reduceMotion();
    const dimOthers = openKey !== null;
    for (const k of knots.values()) {
      const st = stateOf(k);
      if (st !== k.shownState) {
        k.el.classList.toggle("vc-knot-rest", st === "rest");
        k.el.classList.toggle("vc-knot-peeking", st === "peek");
        k.el.classList.toggle("vc-knot-open", st === "open");
        k.el.setAttribute("aria-expanded", String(st === "open"));
        k.shownState = st;
      }
      const dim = dimOthers && st !== "open";
      if (dim !== k.shownDim) {
        k.el.classList.toggle("vc-knot-dim", dim);
        k.shownDim = dim;
      }
      if (k.spec.curve !== k.shownCurve) {
        k.el.classList.toggle("vc-knot-mod", k.spec.curve !== null);
        k.glyphPath.setAttribute("d", k.spec.curve ? glyphD(k.spec.curve) : "");
        k.shownCurve = k.spec.curve;
      }
      let moved = stepSpring(k.x, dtSec, snap);
      moved = stepSpring(k.y, dtSec, snap) || moved;
      moved = stepSpring(k.w, dtSec, snap) || moved;
      moved = stepSpring(k.h, dtSec, snap) || moved;
      stepSpring(k.cableW, dtSec, snap);
      if (moved || k.snapped || k.el.style.width === "") {
        k.snapped = false;
        const s = k.el.style;
        s.left = `${(k.x.v - k.w.v / 2).toFixed(1)}px`;
        s.top = `${(k.y.v - k.h.v / 2).toFixed(1)}px`;
        s.width = `${Math.max(0, k.w.v).toFixed(1)}px`;
        s.height = `${Math.max(0, k.h.v).toFixed(1)}px`;
      }
      // A closed knot keeps its body until it has shrunk back, so the fade
      // and the shrink play over the old controls.
      if (st !== "open" && !k.body && k.bodyHost.firstChild && settled(k.w) && settled(k.h)) k.bodyHost.replaceChildren();

      const r = k.spec.read();
      const out = r ? clamp(r.output, 0, 1) : 0;
      k.inRing[k.ringHead] = r ? clamp(r.input, 0, 1) : 0;
      k.outRing[k.ringHead] = out;
      k.ringHead = (k.ringHead + 1) % PEEK_RING;
      if (Math.abs(out - k.glow) > GLOW_STEP) {
        k.glow = out;
        k.el.style.boxShadow = `0 0 ${(4 + 18 * out).toFixed(1)}px color-mix(in srgb, ${k.color} ${Math.round(15 + 60 * out)}%, transparent)`;
      }
      if (st === "peek") drawPeek(k);
      if (st === "open") k.body?.update();
    }
  }

  return {
    el: layer,
    sync,
    tick,
    setPeek(key, on) {
      const k = knots.get(key);
      if (!k || k.cablePeek === on) return;
      k.cablePeek = on;
      aim(k);
    },
    open,
    close() {
      if (openKey !== null) closeOpen(false);
    },
    openKey: () => openKey,
    setVisible(v) {
      layer.style.display = v ? "" : "none";
      if (!v && openKey !== null) closeOpen(false);
    },
    geometry(key) {
      const k = knots.get(key);
      if (!k) return null;
      const top = k.y.v - k.h.v / 2;
      const half = k.cableW.v / 2;
      return { cx: k.x.v, entryY: top + Math.min(k.h.v / 2, k.entryOff), left: k.x.v - half, right: k.x.v + half };
    },
    drag(key, at) {
      const k = knots.get(key);
      if (!k) return;
      if (at) k.dragged = true;
      k.dragAt = at ? { x: at.x, y: at.y } : null;
      aim(k);
    },
  };
}
