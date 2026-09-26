import {
  type PlacedTick,
  type SliderScale,
  type TickLevel,
  dragStep,
  layoutTicks,
  lens,
  nearestTick,
  nextPrecisionLevel,
  pointerSpeed,
  precisionValue,
  snap,
  LENS_CORE_PX,
  LENS_EDGE_PX,
  PRECISION_SUB,
} from "./sliderScale.ts";
import { FONT_MONO } from "./controlsTheme.ts";

/**
 * The controls panel's one slider control — every `<input type="range">`
 * used to be its own native element with a magnet effect (deviceMenu.ts's
 * `wireThumbMagnet`) bolted on; this replaces all of them with a single
 * canvas-drawn control built on top of src/ui/sliderScale.ts's pure scale
 * math. Canvas, not a styled `<div>` per tick, because a scale can carry a
 * few dozen ticks (a log gain row's every 1.2/1.5/2/2.5/... mantissa across
 * several decades) each with its own distance-based glow — recomputing that
 * many DOM nodes' styles every frame a drag moves the thumb would be far
 * costlier than one `fillRect` per tick on a single canvas.
 *
 * Look: the "Ruler" skin — a thin track, ticks hanging below it sized by
 * `TickLevel` (`TICK_LEN`, +1px for a detent), the tick the thumb is
 * *latched* to drawn in the row's own accent with a glow, its neighbours
 * lighting up by distance (`GLOW_REACH_PX`), and level-2 ticks carrying a
 * text label placed by priority (the latched tick, then detents, then the
 * track's own ends, then everything else) and skipped on overlap. A
 * precision drag (see sliderScale.ts's own header) opens a faint lens window
 * with its own sub-ticks in the magnified core.
 *
 * Interaction contract (`createMagnetSlider` below): pointerdown captures
 * the pointer and lands the thumb *right under it* — nearestTick, not a
 * magnet pull — so the first frame of a drag never jumps; every pointermove
 * after that runs the real magnet/precision math (sliderScale.ts's `snap`,
 * `dragStep`, `precisionValue`). A `click` on the control stops there — it
 * never bubbles to a wrapping row's own "click anywhere pins/focuses" logic
 * (deviceMenu.ts's `createControlRow`, `buildWeightSlider`). Double-click
 * jumps to `defaultValue` when the caller gave one. Keyboard: arrows step
 * one tick, Shift+arrow/PageUp/PageDown jump to the next marked
 * value/major, Home/End to the ends; letter keys (a/r/t/z/x/c) are left
 * alone entirely — deviceMenu.ts's `wireRowKeys`/`wireSliderQuickJump` bind
 * those on this same element. ARIA: `role="slider"` with
 * aria-valuemin/max/now/text, the last from the caller's own `format`.
 *
 * Every instance shares one `requestAnimationFrame` loop (`ensureLoopRunning`
 * below) rather than each running its own — idle cost has to be zero on a
 * page whose whole point is a WebGL visualizer running underneath. The loop
 * starts on any state change that needs easing (a drag, a value change, a
 * hover/focus flip) and stops itself the instant every instance has settled;
 * it also prunes any instance whose element has left the document, so a
 * panel rebuild (deviceMenu.ts's own `renderSceneSettings`/`buildPatchPanel`)
 * doesn't pile up dead entries forever. What it can't reclaim is a
 * per-instance `ResizeObserver` on an element that's simply thrown away
 * without ever resizing again after being detached — the same gap
 * `buildWeightSlider`'s own patch-panel rebuilds already had before this
 * file existed, not a new one.
 */

// ---- Rendering constants (Ruler look) ------------------------------------

/** Room for the thumb at both ends of the track, in canvas px. */
const PAD = 8;
/** Track centre to where the ticks start. */
const TRACK_GAP = 4.5;
/** Ruler's own vertical centre for the track/fill/thumb — fixed regardless
 *  of the element's own height, which just gives the tick labels room. */
const CY = 11;
/** Tick length by TickLevel, plus 1px more for a detent. */
const TICK_LEN: readonly [number, number, number] = [3, 6, 9];
/** How far a neighbouring tick's glow reaches, in canvas px — the exp(-(d/R)^2)
 *  falloff around the thumb every tick (not just the latched one) reads. */
const GLOW_REACH_PX = 14;
/** The overshoot kick (px) when a drag lands a new detent/major tick. */
const OVERSHOOT_KICK_PX = 2.4;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

export interface MagnetSliderOpts {
  scale: SliderScale;
  value: number;
  /** aria-label. */
  label: string;
  /** Any CSS colour — resolved once (and on setAccent) through a 1x1 canvas
   *  fillStyle round-trip, so hex/rgb/hsl/named colours all work uniformly. */
  accent: string;
  /** aria-valuetext and every ruler tick label (always called with
   *  `precision` 0 for a label — a tick's own text doesn't change with the
   *  current drag's precision level, only the live readout does). */
  format: (value: number, precision: TickLevel) => string;
  /** Where a double-click travels to. Omit to make double-click a no-op. */
  defaultValue?: number;
  /** The element whose hover/focus lights the scale — a row wrapping this
   *  slider, typically, so the whole row "wakes" it, matching the row's own
   *  CSS hover/focus-within rule (controlsTheme.ts). Defaults to this
   *  control's own element. */
  hoverHost?: HTMLElement;
  /** Fires on every user-driven change: a drag, a keypress, a double-click,
   *  or setFromUser. Never fires from setValue. */
  onInput: (value: number) => void;
  /** Fires exactly at drag start/end. */
  onDragChange?: (dragging: boolean) => void;
}

export interface MagnetSlider {
  el: HTMLDivElement;
  /** Programmatic — never calls onInput. A no-op redraw if the value hasn't
   *  actually changed (auto rows call this on every ~100ms refresh tick). */
  setValue(value: number): void;
  /** Like a user-driven change — calls onInput. For the z/x/c quick-jump keys
   *  (deviceMenu.ts's wireSliderQuickJump). */
  setFromUser(value: number): void;
  setAccent(color: string): void;
  /** `f` is a fraction (0..1) across this control's own full width — the
   *  same frame pointerFraction (deviceMenu.ts) measures a hovered pointer
   *  in, so the two stay consistent without either needing to know the
   *  other's internals. Internally corrected for the track's own PAD inset. */
  valueAtFraction(f: number): number;
  isDragging(): boolean;
}

// ---- the shared animation loop -------------------------------------------
// See this file's own header. Each instance registers a `step` closure; the
// loop runs only while at least one of them reports it's still animating,
// and prunes any whose element has left the document.

interface LoopEntry {
  el: HTMLElement;
  step: (now: number, dt: number) => boolean;
}
const loopEntries: LoopEntry[] = [];
let rafHandle: number | null = null;
let lastLoopTime = 0;

function ensureLoopRunning(): void {
  if (rafHandle !== null) return;
  lastLoopTime = 0;
  rafHandle = requestAnimationFrame(runLoop);
}

function runLoop(now: number): void {
  rafHandle = null;
  const dt = lastLoopTime ? Math.min(100, now - lastLoopTime) : 16;
  lastLoopTime = now;
  let again = false;
  for (let i = loopEntries.length - 1; i >= 0; i--) {
    const entry = loopEntries[i];
    if (!entry.el.isConnected) {
      loopEntries.splice(i, 1);
      continue;
    }
    if (entry.step(now, dt)) again = true;
  }
  if (again) {
    rafHandle = requestAnimationFrame(runLoop);
  } else {
    lastLoopTime = 0;
  }
}

/** The "1x1 canvas fillStyle round-trip" — draws a pixel in `color` and reads
 *  it back, so any valid CSS colour resolves to concrete RGB regardless of
 *  syntax (hex, rgb(), hsl(), a named colour, color-mix()...). */
function resolveAccent(color: string): [number, number, number] {
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  const pctx = probe.getContext("2d")!;
  pctx.fillStyle = color;
  pctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = pctx.getImageData(0, 0, 1, 1).data;
  return [r, g, b];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function createMagnetSlider(opts: MagnetSliderOpts): MagnetSlider {
  // touch-action/cursor/size/etc. all come from the .vc-slider class rule
  // (controlsTheme.ts) — nothing inline here, so a caller is always free to
  // merge its own inline style (cssText +=) onto `el` without clobbering
  // anything this constructor set up.
  const el = document.createElement("div");
  el.className = "vc-slider";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", opts.label);

  const canvas = document.createElement("canvas");
  el.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;

  const hoverHost = opts.hoverHost ?? el;

  const s = {
    value: opts.value,
    ticks: [] as PlacedTick[],
    w: 0,
    h: 0,
    dpr: 1,
    latched: null as PlacedTick | null,
    dispX: 0,
    targetX: 0,
    dragging: false,
    hover: false,
    intensity: 0.55,
    pulse: 0,
    kick: 0,
    acc: resolveAccent(opts.accent),
    u: 0,
    lastClientX: 0,
    samples: [] as { t: number; x: number }[],
    slowMs: 0,
    level: 0 as TickLevel,
    mag: 1,
    shownSub: 1,
    grabOffset: 0,
    homeOffset: 0,
    thumbX: 0,
    rawX: null as number | null,
    lensAppear: 0,
    dirty: true,
  };

  function x0(): number {
    return PAD;
  }
  function x1(): number {
    return s.w - PAD;
  }
  function xOf(v: number): number {
    return x0() + opts.scale.toPos(v) * (x1() - x0());
  }

  function markDirty(): void {
    s.dirty = true;
    ensureLoopRunning();
  }

  function setAria(): void {
    el.setAttribute("aria-valuemin", String(opts.scale.min));
    el.setAttribute("aria-valuemax", String(opts.scale.max));
    el.setAttribute("aria-valuenow", String(+s.value.toFixed(4)));
    el.setAttribute("aria-valuetext", opts.format(s.value, s.level));
  }

  function relayout(): void {
    const r = el.getBoundingClientRect();
    s.dpr = window.devicePixelRatio || 1;
    s.w = r.width;
    s.h = r.height;
    canvas.width = Math.round(s.w * s.dpr);
    canvas.height = Math.round(s.h * s.dpr);
    s.ticks = layoutTicks(opts.scale, x0(), x1());
    s.latched = s.ticks.find((t) => near(t.v, s.value)) ?? null;
    s.targetX = xOf(s.value);
    if (!s.dragging) s.dispX = s.targetX;
    markDirty();
  }

  function commit(v: number, tick: PlacedTick | null): void {
    const prevLatched = s.latched;
    const prevValue = s.value;
    s.latched = tick;
    if (tick && tick !== prevLatched && (tick.detent || tick.level === 2) && s.dragging) {
      s.pulse = 1;
      try {
        navigator.vibrate?.(6);
      } catch {
        /* unsupported/blocked — purely a nicety */
      }
      if (!reduceMotion) s.kick = Math.sign(v - prevValue) * OVERSHOOT_KICK_PX;
    }
    s.value = v;
    s.targetX = tick ? tick.x : xOf(v);
    if (reduceMotion) s.dispX = s.targetX;
    setAria();
    markDirty();
    opts.onInput(v);
  }

  function updatePrecision(now: number, dt: number): void {
    if (opts.scale.discrete) {
      if (s.level !== 0) {
        s.level = 0;
        s.shownSub = 1;
      }
      return;
    }
    const speed = pointerSpeed(s.samples, now);
    const result = nextPrecisionLevel(s.level, speed, s.slowMs, dt);
    s.slowMs = result.slowMs;
    if (result.level !== s.level) {
      const entering = result.level > s.level;
      s.level = result.level;
      if (entering) {
        s.shownSub = PRECISION_SUB[result.level];
        s.pulse = Math.max(s.pulse, 0.6);
        try {
          navigator.vibrate?.(4);
        } catch {
          /* unsupported/blocked */
        }
      }
      setAria();
    }
  }

  // `landing` is the pointerdown: the thumb goes right under the pointer
  // (nearestTick, or the exact spot in a Shift-bypassed continuous row) —
  // magnets only act once the drag actually moves.
  function fromPointer(clientX: number, bypass: boolean, landing: boolean): void {
    const rect = el.getBoundingClientRect();
    const fx = clientX - rect.left;
    const dx = clientX - s.lastClientX;
    const sub = PRECISION_SUB[s.level];
    const pos = dragStep({ u: s.u, grabOffset: s.grabOffset }, fx, dx, sub, x0(), x1(), s.homeOffset);
    s.u = pos.u;
    s.grabOffset = pos.grabOffset;
    s.lastClientX = clientX;
    const x = s.u;
    s.rawX = x;
    if (s.level > 0) {
      const v = precisionValue(x, s.ticks, sub);
      commit(v, s.ticks.find((t) => near(t.v, v)) ?? null);
      return;
    }
    const tick = landing
      ? bypass && !opts.scale.discrete
        ? null
        : nearestTick(x, s.ticks)
      : snap(x, s.ticks, s.latched, opts.scale.discrete, bypass);
    const p = (x - x0()) / (x1() - x0());
    commit(tick ? tick.v : opts.scale.toVal(p), tick);
  }

  // ---- pointer -------------------------------------------------------
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    el.focus({ preventScroll: true });
    s.grabOffset = 0;
    s.homeOffset = 0;
    s.dragging = true;
    el.classList.add("vc-dragging");
    s.level = 0;
    s.slowMs = 0;
    s.lastClientX = e.clientX;
    s.samples = [{ t: performance.now(), x: e.clientX }];
    el.setPointerCapture(e.pointerId);
    opts.onDragChange?.(true);
    fromPointer(e.clientX, e.shiftKey, true);
    ensureLoopRunning();
  });
  el.addEventListener("pointermove", (e) => {
    if (!s.dragging) return;
    s.samples.push({ t: performance.now(), x: e.clientX });
    // A fast move leaves precision on this event, not next frame (dt 0 —
    // see nextPrecisionLevel's own comment).
    updatePrecision(performance.now(), 0);
    fromPointer(e.clientX, e.shiftKey, false);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!s.dragging) return;
    s.dragging = false;
    s.rawX = null;
    s.level = 0;
    s.slowMs = 0;
    el.classList.remove("vc-dragging");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    markDirty();
    opts.onDragChange?.(false);
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);
  // Never lets a click bubble to a wrapping row's own click-to-pin/focus
  // handler (createControlRow, buildWeightSlider) — dragging the slider
  // must never also fire whatever the rest of the row does on click.
  el.addEventListener("click", (e) => e.stopPropagation());
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (opts.defaultValue === undefined) return;
    const tick = s.ticks.find((t) => near(t.v, opts.defaultValue!)) ?? null;
    s.pulse = 1;
    commit(opts.defaultValue, tick);
  });

  hoverHost.addEventListener("pointerenter", () => {
    s.hover = true;
    markDirty();
  });
  hoverHost.addEventListener("pointerleave", () => {
    s.hover = false;
    markDirty();
  });
  el.addEventListener("focus", () => markDirty());
  el.addEventListener("blur", () => markDirty());

  // ---- keyboard --------------------------------------------------------
  // Arrows step one tick; Shift+arrow, PageUp/PageDown jump to the next
  // marked value/major; Home/End to the ends. Letter keys (a/r/t/z/x/c) are
  // deliberately not handled here — deviceMenu.ts's wireRowKeys/
  // wireSliderQuickJump bind those directly on this same element.
  const ARROW_DIR: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 };
  el.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let tick: PlacedTick | null;
    if (e.key === "Home") {
      tick = s.ticks[0] ?? null;
    } else if (e.key === "End") {
      tick = s.ticks[s.ticks.length - 1] ?? null;
    } else {
      const pageDir = e.key === "PageUp" ? 1 : e.key === "PageDown" ? -1 : undefined;
      const dir = pageDir ?? ARROW_DIR[e.key];
      if (dir === undefined) return;
      const jumpToMarked = e.shiftKey || pageDir !== undefined;
      const cur = xOf(s.value);
      const pool = jumpToMarked ? s.ticks.filter((t) => t.detent || t.level === 2) : s.ticks;
      const candidates = dir > 0 ? pool.filter((t) => t.x > cur + 0.5) : pool.filter((t) => t.x < cur - 0.5).reverse();
      tick = candidates[0] ?? null;
    }
    if (!tick) return;
    e.preventDefault();
    commit(tick.v, tick);
  });

  new ResizeObserver(relayout).observe(el);

  // ---- drawing (Ruler look — see this file's own header) --------------

  function lensedTicks(): { t: PlacedTick; x: number; fade: number; g: number; latched: boolean }[] {
    const R = GLOW_REACH_PX;
    return s.ticks.map((t) => {
      const L = lens(t.x, s.dispX, s.mag);
      const d = Math.abs(t.x - s.dispX);
      const latched = t === s.latched;
      const g = latched ? 1 : Math.exp(-(d * d) / (R * R)) * s.intensity * 0.32;
      return { t, x: Math.round(L.x * s.dpr) / s.dpr, fade: L.fade, g, latched };
    });
  }

  function scaleAlpha(k: { x: number; fade: number }): number {
    const outside = Math.abs(k.x - s.dispX) > LENS_CORE_PX + 2;
    return k.fade * (outside ? 1 - 0.6 * s.lensAppear : 1);
  }

  function forSubTicks(fn: (x: number, appear: number, isCurrentValue: boolean) => void): void {
    if (!(s.mag > 1.03 && s.shownSub > 1)) return;
    const S = s.shownSub;
    const appear = Math.min(1, (s.mag - 1) / (S - 1));
    const c = LENS_CORE_PX / s.mag;
    const T = s.ticks;
    for (let i = 0; i < T.length - 1; i++) {
      const a = T[i];
      const b = T[i + 1];
      if (b.x < s.dispX - c - 1 || a.x > s.dispX + c + 1) continue;
      for (let k = 1; k < S; k++) {
        const v = a.v + ((b.v - a.v) * k) / S;
        const L = lens(xOf(v), s.dispX, s.mag);
        if (Math.abs(L.x - s.dispX) > LENS_CORE_PX + 2) continue;
        fn(Math.round(L.x * s.dpr) / s.dpr, appear, near(+v.toPrecision(10), s.value));
      }
    }
  }

  function lensBackdrop(): void {
    s.lensAppear = 0;
    if (!(s.mag > 1.03 && s.shownSub > 1)) return;
    const appear = Math.min(1, (s.mag - 1) / (s.shownSub - 1));
    s.lensAppear = appear;
    const [ar, ag, ab] = s.acc;
    const c = (a: number) => `rgba(${ar},${ag},${ab},${a})`;
    const gx = ctx.createLinearGradient(s.dispX - LENS_EDGE_PX, 0, s.dispX + LENS_EDGE_PX, 0);
    gx.addColorStop(0, c(0));
    gx.addColorStop(0.5 - LENS_CORE_PX / LENS_EDGE_PX / 2, c(0.1 * appear));
    gx.addColorStop(0.5, c(0.16 * appear));
    gx.addColorStop(0.5 + LENS_CORE_PX / LENS_EDGE_PX / 2, c(0.1 * appear));
    gx.addColorStop(1, c(0));
    ctx.fillStyle = gx;
    roundRect(ctx, s.dispX - LENS_EDGE_PX, 1, LENS_EDGE_PX * 2, s.h - 2, 4);
    ctx.fill();
  }

  function drawRulerScale(): void {
    const [ar, ag, ab] = s.acc;
    ctx.font = `9px ${FONT_MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const lensed = lensedTicks();
    const labels: typeof lensed = [];
    for (const k of lensed) {
      const len = TICK_LEN[k.t.level] + (k.t.detent ? 1 : 0);
      ctx.globalAlpha = scaleAlpha(k);
      if (k.latched) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgba(${ar},${ag},${ab},1)`;
        ctx.shadowColor = `rgba(${ar},${ag},${ab},1)`;
        ctx.shadowBlur = 8 + s.pulse * 6;
        ctx.fillRect(k.x - 0.8, CY + TRACK_GAP, 1.6, len);
      } else {
        const baseAlpha = [0.18, 0.28, 0.42][k.t.level];
        ctx.fillStyle = k.g > 0.1 ? `rgba(${ar},${ag},${ab},${Math.min(1, 0.3 + k.g * 2)})` : `rgba(255,255,255,${baseAlpha})`;
        ctx.shadowBlur = 0;
        ctx.fillRect(k.x - 0.5, CY + TRACK_GAP, 1, len);
      }
      if (k.t.level === 2) labels.push(k);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // Labels by priority — the latched tick, marked values, the ends, then
    // the rest — each skipped if it would touch one already placed.
    const rank = (k: (typeof labels)[number]): number =>
      k.latched ? 0 : k.t.detent ? 1 : k === labels[0] || k === labels[labels.length - 1] ? 2 : 3;
    const placed: [number, number][] = [];
    for (const k of labels.slice().sort((x, y) => rank(x) - rank(y))) {
      const label = opts.format(k.t.v, 0).replace(/^0\./, ".");
      const width = ctx.measureText(label).width;
      const half = width / 2;
      const x = Math.max(half + 1, Math.min(s.w - half - 1, k.x));
      if (placed.some(([l, r]) => x - half < r + 4 && x + half > l - 4)) continue;
      placed.push([x - half, x + half]);
      ctx.globalAlpha = scaleAlpha(k);
      ctx.fillStyle = k.latched ? `rgba(${ar},${ag},${ab},1)` : `rgba(255,255,255,${Math.min(0.9, 0.35 + k.g)})`;
      ctx.fillText(label, x, CY + TRACK_GAP + 12);
    }
    ctx.globalAlpha = 1;

    forSubTicks((x, appear, isCurrentValue) => {
      if (isCurrentValue) return;
      ctx.fillStyle = `rgba(${ar},${ag},${ab},${0.6 * appear})`;
      ctx.fillRect(x - 0.5, CY + TRACK_GAP, 1, 2.5);
    });
  }

  function draw(): void {
    const { w, h, dpr } = s;
    if (w <= 0 || h <= 0) return;
    const [ar, ag, ab] = s.acc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // track + fill
    const tx0 = PAD;
    const tx1 = w - PAD;
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, tx0, CY - 1.5, tx1 - tx0, 3, 1.5);
    ctx.fill();
    const fx = PAD + opts.scale.toPos(opts.scale.fillFrom) * (tx1 - tx0);
    const a = Math.min(fx, s.dispX);
    const b = Math.max(fx, s.dispX);
    if (b - a > 0.5) {
      ctx.fillStyle = `rgba(${ar},${ag},${ab},0.9)`;
      ctx.shadowColor = `rgba(${ar},${ag},${ab},${0.35 * s.intensity})`;
      ctx.shadowBlur = 8;
      roundRect(ctx, a, CY - 1.5, b - a, 3, 1.5);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    lensBackdrop();
    drawRulerScale();

    // thumb: a wide accent halo, a tight one, then a white core on top.
    const active = s.dragging || s.hover || document.activeElement === el;
    const tw = active ? 5 : 3.5;
    const th = active ? 16 : 13;
    const neonAlpha = 0.55 + 0.45 * s.intensity;
    ctx.fillStyle = `rgb(${ar},${ag},${ab})`;
    ctx.shadowColor = `rgba(${ar},${ag},${ab},${neonAlpha})`;
    ctx.shadowBlur = 14 + s.pulse * 10;
    roundRect(ctx, s.thumbX - tw / 2, CY - th / 2, tw, th, 2);
    ctx.fill();
    ctx.shadowBlur = 5;
    roundRect(ctx, s.thumbX - tw / 2, CY - th / 2, tw, th, 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.shadowColor = "rgba(255,255,255,0.8)";
    ctx.shadowBlur = 2;
    roundRect(ctx, s.thumbX - tw / 2 + 0.6, CY - th / 2 + 0.6, tw - 1.2, th - 1.2, 1.5);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function step(now: number, dt: number): boolean {
    if (s.w === 0) return s.dragging;
    if (s.dragging) updatePrecision(now, dt);
    const magWant = PRECISION_SUB[s.level];
    let moving = false;
    if (Math.abs(s.mag - magWant) > 0.01) {
      s.mag += (magWant - s.mag) * (reduceMotion ? 1 : 0.3);
      moving = true;
    } else {
      s.mag = magWant;
      if (s.level === 0) s.shownSub = 1;
    }
    const wantIntensity = s.dragging || s.hover || document.activeElement === el ? 1 : 0.55;
    const k = reduceMotion ? 1 : 0.86;
    if (Math.abs(s.dispX - s.targetX) > 0.15) {
      s.dispX += (s.targetX - s.dispX) * k;
      moving = true;
    } else {
      s.dispX = s.targetX;
    }
    if (Math.abs(s.intensity - wantIntensity) > 0.01) {
      s.intensity += (wantIntensity - s.intensity) * 0.2;
      moving = true;
    } else {
      s.intensity = wantIntensity;
    }
    if (s.pulse > 0) {
      s.pulse = Math.max(0, s.pulse - 0.1);
      moving = true;
    }
    if (Math.abs(s.kick) > 0.05) {
      s.kick *= -0.55;
      moving = true;
    } else {
      s.kick = 0;
    }
    s.thumbX = s.dispX + s.kick;
    if (moving || s.dirty) {
      draw();
      s.dirty = false;
    }
    return moving || s.dragging;
  }
  loopEntries.push({ el, step });

  relayout();
  setAria();

  return {
    el,
    setValue(value: number): void {
      if (near(value, s.value)) return;
      s.value = value;
      s.latched = s.ticks.find((t) => near(t.v, value)) ?? null;
      s.targetX = xOf(value);
      if (!s.dragging) s.dispX = s.targetX;
      setAria();
      markDirty();
    },
    setFromUser(value: number): void {
      const clamped = Math.max(opts.scale.min, Math.min(opts.scale.max, value));
      commit(clamped, s.ticks.find((t) => near(t.v, clamped)) ?? null);
    },
    setAccent(color: string): void {
      s.acc = resolveAccent(color);
      markDirty();
    },
    valueAtFraction(f: number): number {
      const clampedF = Math.max(0, Math.min(1, f));
      if (s.w <= 2 * PAD) return opts.scale.toVal(clampedF);
      const trackFrac = Math.max(0, Math.min(1, (clampedF * s.w - PAD) / (s.w - 2 * PAD)));
      return opts.scale.toVal(trackFrac);
    },
    isDragging(): boolean {
      return s.dragging;
    },
  };
}
