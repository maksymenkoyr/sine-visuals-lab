/**
 * Orchestrate (issues #624 and #625, plans/controls-first.md): one time axis
 * on the beat clock that shows the launch queue, the live look, the held
 * effects and Autopilot's next pick (the Timeline), and a map that places each
 * pad by its measured picture, with a puck that blends two looks of one scene
 * or launches another scene's pad (the Map). The main page gets a small form
 * of both (createOrchestrateMini).
 *
 * Drawing and layout only. Every change goes through the deps the desk passes
 * in (app.ts builds them), so the launch queue, Autopilot and the scene
 * settings keep one owner each. The music, the live pad and the held effects
 * are recorded here on every tick, against the beat count; the full view and
 * the small form both tick, so they read one record.
 */
import { EFFECTS, type EffectId, type HeldEffects } from "../../render/heldEffects.ts";
import { getLaunchOn, PHRASE_BARS, type LaunchOn, type QueuedLaunch } from "../../render/launchQueue.ts";
import { getPalette } from "../../render/palette.ts";
import { type MapItem, type MapPoint, nearestTwo, placeLooks } from "../../render/lookMap.ts";
import { METRONOME_BEATS_PER_BAR } from "../../render/metronome.ts";
import type { SetPad } from "../../render/sceneSet.ts";
import { FONT_MONO } from "../controlsTheme.ts";
import { padStill, padStillAt } from "./padStills.ts";
import type { PadsDeps } from "./pads.ts";

export interface OrchestrateDeps extends PadsDeps {
  /** The song's energy now, 0..1 (AnimFrame.sectionIntensity). */
  energy(): number;
  effects(): HeldEffects;
  /** Queue `padId` at that beat (the Timeline's drop). */
  queueAt(padId: string, atBeats: number): void;
  cancelAt(atBeats: number): void;
  /** The pad's measured picture, null before it has been on NEXT. */
  reading(padId: string): { busy: number; bright: number } | null;
  /** The Map's puck between two pads of one scene: NEXT takes the blend and plays to LIVE with a short glide. */
  blend(aPadId: string, bPadId: string, share: number): void;
  /** The Map's puck reached another scene's pad: launch it now. */
  launchNow(padId: string): void;
  follow(): boolean;
  setFollow(on: boolean): void;
}

const BPB = METRONOME_BEATS_PER_BAR;

/** Bars of the Timeline's window: NOW sits at NOW_FRACTION of the width and the window is these bars wide. */
const TIMELINE_PAST_BARS = 8;
const TIMELINE_FUTURE_BARS = 24;
const MINI_PAST_BARS = 4;
const MINI_FUTURE_BARS = 12;
/** Bars of music and effects kept in the history; the windows above read from it. */
const HISTORY_BARS = 16;
const HISTORY_SAMPLE_BEATS = 0.25;
const NOW_FRACTION = 0.35;

const CHIP_DRAG_PX = 4;
const PUCK_DRAG_MS = 120;
const PUCK_FOLLOW_MS = 500;
/** Follow's target runs along the diagonal from FOLLOW_LOW (calm) to FOLLOW_LOW + FOLLOW_SPAN (loud). */
const FOLLOW_LOW = 0.15;
const FOLLOW_SPAN = 0.7;
const FOLLOW_EASE_S = 0.6;

const DOT_PX = 48;
const DOT_CANVAS_PX = 96;
const CHIP_W = 160;
const CHIP_H = 90;
const GUTTER_PX = 74;

const C = {
  bar: "rgba(232, 238, 234, 0.12)",
  phrase: "rgba(232, 238, 234, 0.35)",
  now: "#e9eee9",
  nowText: "#070908",
  text: "#a7b0aa",
  live: "#ef4444",
  past: "rgba(167, 176, 170, 0.22)",
  queued: "#22c55e",
  queuedFill: "rgba(34, 197, 94, 0.32)",
  pick: "#59bbfb",
  pickFill: "rgba(89, 187, 251, 0.12)",
  music: "#c3a5f9",
  musicFill: "rgba(195, 165, 249, 0.22)",
  effect: "rgba(232, 238, 234, 0.85)",
};

type LaneId = "bars" | "music" | "look" | "effects";
const LANE_HEIGHT: Record<LaneId, number> = { bars: 20, music: 48, look: 44, effects: 24 };
const LANE_LABEL: Record<LaneId, string> = { bars: "BARS", music: "MUSIC", look: "LOOK", effects: "EFFECTS" };

interface Lane {
  id: LaneId;
  top: number;
  height: number;
}

function stack(ids: readonly LaneId[]): Lane[] {
  let top = 0;
  return ids.map((id) => {
    const lane = { id, top, height: LANE_HEIGHT[id] };
    top += lane.height;
    return lane;
  });
}

const FULL_LANES = stack(["bars", "music", "look", "effects"]);
const MINI_LANES = stack(["look"]);

function laneOf(lanes: readonly Lane[], id: LaneId): Lane | undefined {
  return lanes.find((l) => l.id === id);
}

function laneTotal(lanes: readonly Lane[]): number {
  const tail = last(lanes);
  return tail ? tail.top + tail.height : 0;
}

// ---- history ---------------------------------------------------------------

interface Span {
  padId: string | null;
  from: number;
  to: number | null;
}

interface EffectSpan {
  id: EffectId;
  from: number;
  to: number | null;
}

interface EnergySample {
  beats: number;
  energy: number;
}

interface History {
  samples: EnergySample[];
  live: Span[];
  effects: EffectSpan[];
  lastBeats: number | null;
  lastSampleBeats: number;
}

/** One history for both the full view and the small form: each tick records the same beat count, so the two read one record. */
const history: History = { samples: [], live: [], effects: [], lastBeats: null, lastSampleBeats: -Infinity };

function clearHistory(): void {
  history.samples = [];
  history.live = [];
  history.effects = [];
  history.lastSampleBeats = -Infinity;
}

function last<T>(xs: readonly T[]): T | undefined {
  return xs[xs.length - 1];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Records the music, the live pad and the held effects against the beat count. A clock that jumped back, or a gap longer than the history, starts it over. */
function recordHistory(deps: OrchestrateDeps): void {
  const now = deps.nowBeats();
  const span = HISTORY_BARS * BPB;
  if (history.lastBeats !== null && (now < history.lastBeats || now - history.lastBeats > span)) clearHistory();
  history.lastBeats = now;

  const live = deps.livePadId();
  const tail = last(history.live);
  if (!tail) history.live.push({ padId: live, from: now, to: null });
  else if (tail.padId !== live) {
    tail.to = now;
    history.live.push({ padId: live, from: now, to: null });
  }

  const held = deps.effects();
  for (const d of EFFECTS) {
    const open = history.effects.find((s) => s.id === d.id && s.to === null);
    if (held[d.id] && !open) history.effects.push({ id: d.id, from: now, to: null });
    else if (!held[d.id] && open) open.to = now;
  }

  if (now - history.lastSampleBeats >= HISTORY_SAMPLE_BEATS) {
    history.lastSampleBeats = now;
    history.samples.push({ beats: now, energy: clamp01(deps.energy()) });
  }

  const cutoff = now - span - BPB;
  history.samples = history.samples.filter((s) => s.beats >= cutoff);
  history.live = history.live.filter((s) => s.to === null || s.to >= cutoff);
  history.effects = history.effects.filter((s) => s.to === null || s.to >= cutoff);
}

// ---- geometry --------------------------------------------------------------

interface Win {
  w: number;
  h: number;
  now: number;
  nowX: number;
  pxPerBeat: number;
}

function windowOf(w: number, h: number, now: number, pastBars: number, futureBars: number): Win {
  return { w, h, now, nowX: w * NOW_FRACTION, pxPerBeat: w / ((pastBars + futureBars) * BPB) };
}

function xOf(win: Win, beat: number): number {
  return win.nowX + (beat - win.now) * win.pxPerBeat;
}

function beatAt(win: Win, x: number): number {
  return win.now + (x - win.nowX) / win.pxPerBeat;
}

/** Beats between two launch lines for a launch-on choice; "now" and "beat" both snap to a beat. */
function lineBeats(on: LaunchOn): number {
  if (on === "now" || on === "beat") return 1;
  if (on === "bar") return BPB;
  if (on === "4bars") return 4 * BPB;
  return PHRASE_BARS * BPB;
}

function isPhrase(bar: number): boolean {
  return ((bar % PHRASE_BARS) + PHRASE_BARS) % PHRASE_BARS === 0;
}

// ---- canvas ----------------------------------------------------------------

function fitCanvas(canvas: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w === 0 || h === 0) return null;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function line(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

interface Hit {
  atBeats: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

interface DrawState {
  win: Win;
  lanes: readonly Lane[];
  names: ReadonlyMap<string, string>;
  queue: readonly QueuedLaunch[];
  pick: { padId: string; beat: number } | null;
  guide: number | null;
  hits: Hit[];
}

interface BlockStyle {
  fill?: string;
  stroke?: string;
  dash?: boolean;
  text: string;
}

function drawBlock(ctx: CanvasRenderingContext2D, win: Win, x0: number, x1: number, y0: number, y1: number, label: string, style: BlockStyle): void {
  if (x1 < 0 || x0 > win.w) return;
  const w = Math.max(x1 - x0, 1);
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fillRect(x0, y0, w, y1 - y0);
  }
  if (style.stroke) {
    ctx.strokeStyle = style.stroke;
    ctx.setLineDash(style.dash ? [4, 3] : []);
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, y1 - y0 - 1);
    ctx.setLineDash([]);
  }
  if (label && w > 24) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, y1 - y0);
    ctx.clip();
    ctx.fillStyle = style.text;
    ctx.fillText(label, x0 + 4, y0 + 4);
    ctx.restore();
  }
}

function drawLanes(ctx: CanvasRenderingContext2D, st: DrawState): void {
  const { win, lanes, names } = st;
  const h = laneTotal(lanes);
  const nameOf = (id: string): string => names.get(id) ?? "";
  ctx.clearRect(0, 0, win.w, win.h);
  ctx.font = `10px ${FONT_MONO}`;
  ctx.textBaseline = "top";
  ctx.lineWidth = 1;

  const left = beatAt(win, 0);
  const right = beatAt(win, win.w);
  for (let bar = Math.floor(left / BPB); bar <= Math.ceil(right / BPB); bar++) {
    const x = xOf(win, bar * BPB);
    ctx.strokeStyle = isPhrase(bar) ? C.phrase : C.bar;
    line(ctx, x, 0, x, h);
  }

  const bars = laneOf(lanes, "bars");
  if (bars) {
    const labelEvery = win.pxPerBeat * BPB >= 16 ? 1 : PHRASE_BARS;
    ctx.fillStyle = C.text;
    for (let bar = Math.floor(left / BPB); bar <= Math.ceil(right / BPB); bar++) {
      if (bar < 0 || bar % labelEvery !== 0) continue;
      ctx.fillText(String(bar + 1), xOf(win, bar * BPB) + 3, bars.top + 4);
    }
    ctx.strokeStyle = C.bar;
    for (let beat = Math.ceil(left); beat <= Math.floor(right); beat++) {
      const x = xOf(win, beat);
      line(ctx, x, bars.top + bars.height - 5, x, bars.top + bars.height);
    }
  }

  const music = laneOf(lanes, "music");
  if (music && history.samples.length > 1) {
    const base = music.top + music.height - 2;
    const span = music.height - 4;
    const pts: { x: number; y: number }[] = [];
    for (const s of history.samples) {
      const x = xOf(win, s.beats);
      if (x < 0) continue;
      if (x > win.nowX) break;
      pts.push({ x, y: base - s.energy * span });
    }
    const head = pts[0];
    const tailPt = last(pts);
    if (head && tailPt) {
      ctx.beginPath();
      ctx.moveTo(head.x, base);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.lineTo(tailPt.x, base);
      ctx.closePath();
      ctx.fillStyle = C.musicFill;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(head.x, head.y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = C.music;
      ctx.stroke();
    }
  }

  const look = laneOf(lanes, "look");
  if (look) {
    const y0 = look.top + 6;
    const y1 = look.top + look.height - 6;
    for (const s of history.live) {
      if (s.padId === null || s.to === null) continue;
      drawBlock(ctx, win, xOf(win, s.from), xOf(win, s.to), y0, y1, nameOf(s.padId), { fill: C.past, text: C.text });
    }
    const liveTail = last(history.live);
    if (liveTail && liveTail.padId !== null) {
      drawBlock(ctx, win, xOf(win, liveTail.from), win.nowX, y0, y1, nameOf(liveTail.padId), { stroke: C.live, text: C.live });
    }
    for (const q of st.queue) {
      const x0 = xOf(win, q.atBeats);
      const x1 = xOf(win, q.atBeats + BPB);
      drawBlock(ctx, win, x0, x1, y0, y1, nameOf(q.padId), { fill: C.queuedFill, stroke: C.queued, text: C.queued });
      if (x1 >= 0 && x0 <= win.w) st.hits.push({ atBeats: q.atBeats, x0: Math.max(0, x0), x1: Math.min(win.w, x1), y0, y1 });
    }
    if (st.pick) {
      const x0 = xOf(win, st.pick.beat);
      const x1 = xOf(win, st.pick.beat + BPB);
      drawBlock(ctx, win, x0, x1, y0, y1, nameOf(st.pick.padId), { fill: C.pickFill, stroke: C.pick, dash: true, text: C.pick });
    }
  }

  const fx = laneOf(lanes, "effects");
  if (fx) {
    const rowH = fx.height / EFFECTS.length;
    for (const s of history.effects) {
      const row = EFFECTS.findIndex((d) => d.id === s.id);
      const x0 = xOf(win, s.from);
      const x1 = xOf(win, s.to ?? win.now);
      if (x1 < 0 || x0 > win.w) continue;
      ctx.fillStyle = C.effect;
      ctx.fillRect(x0, fx.top + row * rowH + 2, Math.max(1, x1 - x0), rowH - 3);
    }
  }

  if (st.guide !== null) {
    const x = xOf(win, st.guide);
    ctx.strokeStyle = C.queued;
    ctx.lineWidth = 2;
    line(ctx, x, 0, x, h);
    ctx.lineWidth = 1;
  }

  ctx.strokeStyle = C.now;
  ctx.lineWidth = 1.5;
  line(ctx, win.nowX, 0, win.nowX, h);
  ctx.lineWidth = 1;
  ctx.fillStyle = C.now;
  ctx.fillRect(win.nowX - 17, 0, 34, 12);
  ctx.fillStyle = C.nowText;
  ctx.textAlign = "center";
  ctx.fillText("NOW", win.nowX, 1);
  ctx.textAlign = "left";
}

/** Paints a pad's still (or its palette colour) into a canvas, covering it; re-paints only when the still was grabbed again. */
function paintPad(canvas: HTMLCanvasElement, pad: SetPad, drawn: { at: number | null }, round: boolean): void {
  const at = padStillAt(pad.id);
  if (drawn.at !== null && at === drawn.at) return;
  drawn.at = at;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  if (round) {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  const still = padStill(pad.id);
  if (still) {
    const s = Math.max(w / still.width, h / still.height);
    const sw = still.width * s;
    const sh = still.height * s;
    ctx.drawImage(still, (w - sw) / 2, (h - sh) / 2, sw, sh);
  } else {
    ctx.fillStyle = getPalette(pad.paletteId).roles.accent;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function elm<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, text: string): HTMLButtonElement {
  const b = elm("button", cls, text);
  b.type = "button";
  return b;
}

function barWord(bars: number): string {
  return `in ${bars} ${bars === 1 ? "bar" : "bars"}`;
}

/** "Next change: <name> at bar N, in M bars" for the earlier of the queue's first entry and Autopilot's pick; "Nothing coming" with neither. */
function nextChangeText(deps: OrchestrateDeps): string {
  const now = deps.nowBeats();
  const names = new Map(deps.list().map((p) => [p.id, p.name] as const));
  const candidates: { beat: number; name: string }[] = [];
  const q = deps.queue().find((x) => names.has(x.padId));
  if (q) candidates.push({ beat: q.atBeats, name: names.get(q.padId) ?? "" });
  const pick = deps.pick();
  if (pick && names.has(pick.padId)) {
    candidates.push({ beat: (Math.floor(now / BPB) + pick.inBars) * BPB, name: names.get(pick.padId) ?? "" });
  }
  let next: { beat: number; name: string } | null = null;
  for (const c of candidates) if (next === null || c.beat < next.beat) next = c;
  if (next === null) return "Nothing coming";
  const bars = Math.max(0, Math.ceil((next.beat - now) / BPB));
  const when = bars < 1 ? "now" : barWord(bars);
  return `Next change: ${next.name} at bar ${1 + Math.floor(next.beat / BPB)}, ${when}`;
}

// ---- lanes -----------------------------------------------------------------

interface LanesOpts {
  lanes: readonly Lane[];
  pastBars: number;
  futureBars: number;
  labels: boolean;
  interactive: boolean;
}

interface LanesView {
  el: HTMLElement;
  tick(): void;
  setGuide(beat: number | null): void;
  /** The LOOK lane in client coordinates, or null before layout. */
  band(): { left: number; right: number; top: number; bottom: number } | null;
  beatAtClientX(clientX: number): number;
}

function createLanes(deps: OrchestrateDeps, opts: LanesOpts): LanesView {
  const total = laneTotal(opts.lanes);
  const gutter = opts.labels ? GUTTER_PX : 0;
  const root = elm("div", "desk-orch-lanes");
  root.style.height = `${total}px`;
  if (opts.labels) {
    for (const lane of opts.lanes) {
      const label = elm("div", "desk-orch-lane-label", LANE_LABEL[lane.id]);
      label.style.top = `${lane.top}px`;
      label.style.height = `${lane.height}px`;
      label.style.width = `${GUTTER_PX}px`;
      root.appendChild(label);
    }
  }
  const canvas = elm("canvas", "desk-orch-canvas");
  canvas.style.left = `${gutter}px`;
  canvas.style.width = `calc(100% - ${gutter}px)`;
  canvas.style.height = `${total}px`;
  root.appendChild(canvas);

  const hits: Hit[] = [];
  let guide: number | null = null;
  let keptKey: string | null = null;
  let pickKeyNow: string | null = null;
  let pickBtns: HTMLElement | null = null;
  const keep = button("desk-orch-pick-btn", "✓");
  const skip = button("desk-orch-pick-btn", "✕");

  if (opts.interactive) {
    keep.title = "Keep Autopilot's pick: hides these marks until the pick changes";
    skip.title = "Skip: pick another pad";
    keep.addEventListener("click", () => {
      keptKey = pickKeyNow;
    });
    skip.addEventListener("click", () => deps.skipPick());
    pickBtns = elm("div", "desk-orch-pickbtns");
    pickBtns.hidden = true;
    pickBtns.append(keep, skip);
    root.appendChild(pickBtns);
    canvas.addEventListener("pointerdown", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const hit = hits.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1);
      if (hit) deps.cancelAt(hit.atBeats);
    });
  }

  function tick(): void {
    const fit = fitCanvas(canvas);
    if (!fit) return;
    const { ctx, w, h } = fit;
    const now = deps.nowBeats();
    const win = windowOf(w, h, now, opts.pastBars, opts.futureBars);
    const names = new Map(deps.list().map((p) => [p.id, p.name] as const));
    const pick = deps.pick();
    const pickBeat = pick ? (Math.floor(now / BPB) + pick.inBars) * BPB : null;
    pickKeyNow = pick && pickBeat !== null ? `${pick.padId}@${pickBeat}` : null;
    hits.length = 0;
    drawLanes(ctx, {
      win,
      lanes: opts.lanes,
      names,
      queue: deps.queue(),
      pick: pick && pickBeat !== null ? { padId: pick.padId, beat: pickBeat } : null,
      guide,
      hits,
    });
    if (pickBtns && pick && pickBeat !== null) {
      const look = laneOf(opts.lanes, "look");
      const showing = pickKeyNow !== keptKey && xOf(win, pickBeat) <= w;
      pickBtns.hidden = !showing || !look;
      if (look && showing) {
        pickBtns.style.left = `${gutter + xOf(win, pickBeat) + 3}px`;
        pickBtns.style.top = `${look.top + look.height - 21}px`;
      }
    }
  }

  return {
    el: root,
    tick,
    setGuide(beat) {
      guide = beat;
    },
    band() {
      const r = canvas.getBoundingClientRect();
      const look = laneOf(opts.lanes, "look");
      if (!look) return null;
      return { left: r.left, right: r.right, top: r.top + look.top, bottom: r.top + look.top + look.height };
    },
    beatAtClientX(clientX) {
      const r = canvas.getBoundingClientRect();
      const win = windowOf(r.width, total, deps.nowBeats(), opts.pastBars, opts.futureBars);
      return beatAt(win, clientX - r.left);
    },
  };
}

/** The launch beat under a pointer over the LOOK lane, snapped to the launch line; null off the lane or not after NOW. */
function dropBeat(deps: OrchestrateDeps, lanes: LanesView, clientX: number, clientY: number): number | null {
  const band = lanes.band();
  if (!band) return null;
  if (clientX < band.left || clientX > band.right || clientY < band.top || clientY > band.bottom) return null;
  const size = lineBeats(getLaunchOn());
  const target = Math.round(lanes.beatAtClientX(clientX) / size) * size;
  return target > deps.nowBeats() ? target : null;
}

// ---- shelf (full view) -----------------------------------------------------

function createShelf(deps: OrchestrateDeps, lanes: LanesView): { el: HTMLElement; tick(): void } {
  const el = elm("div", "desk-orch-shelf");
  const ghost = elm("div", "desk-orch-ghost");
  ghost.hidden = true;
  el.appendChild(ghost);
  let key = "";
  let chips: { padId: string; pic: HTMLCanvasElement; drawn: { at: number | null } }[] = [];
  let drag: { padId: string; name: string; pointerId: number; x0: number; y0: number; active: boolean } | null = null;

  function rebuild(pads: readonly SetPad[]): void {
    chips = [];
    const nodes: HTMLElement[] = [];
    for (const pad of pads) {
      const chipEl = elm("div", "desk-orch-chip");
      chipEl.title = "Drag onto a bar line in LOOK to queue this pad there";
      const pic = elm("canvas", "desk-orch-chip-pic");
      pic.width = CHIP_W;
      pic.height = CHIP_H;
      chipEl.append(pic, elm("span", "desk-orch-chip-name", pad.name));
      chipEl.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        chipEl.setPointerCapture(e.pointerId);
        drag = { padId: pad.id, name: pad.name, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, active: false };
      });
      chipEl.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        if (!drag.active) {
          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < CHIP_DRAG_PX) return;
          drag.active = true;
          ghost.textContent = drag.name;
          ghost.hidden = false;
        }
        ghost.style.left = `${e.clientX + 12}px`;
        ghost.style.top = `${e.clientY + 12}px`;
        lanes.setGuide(dropBeat(deps, lanes, e.clientX, e.clientY));
      });
      const end = (e: PointerEvent, drop: boolean): void => {
        if (!drag || e.pointerId !== drag.pointerId) return;
        const d = drag;
        drag = null;
        ghost.hidden = true;
        const target = d.active && drop ? dropBeat(deps, lanes, e.clientX, e.clientY) : null;
        lanes.setGuide(null);
        if (target !== null) deps.queueAt(d.padId, target);
      };
      chipEl.addEventListener("pointerup", (e) => end(e, true));
      chipEl.addEventListener("pointercancel", (e) => end(e, false));
      chips.push({ padId: pad.id, pic, drawn: { at: null } });
      nodes.push(chipEl);
    }
    el.append(...nodes);
  }

  function tick(): void {
    const pads = deps.list();
    const k = pads.map((p) => `${p.id}\n${p.name}`).join("\n");
    if (k !== key) {
      key = k;
      for (const n of Array.from(el.querySelectorAll(".desk-orch-chip"))) n.remove();
      rebuild(pads);
    }
    for (const c of chips) {
      const pad = pads.find((p) => p.id === c.padId);
      if (pad) paintPad(c.pic, pad, c.drawn, false);
    }
  }

  return { el, tick };
}

// ---- map -------------------------------------------------------------------

interface Placement {
  points: MapPoint[];
  sceneOf: Map<string, string>;
}

let placementKey = "";
let placed: Placement = { points: [], sceneOf: new Map() };

/** The pads' places, re-placed only when a pad or a reading changed (placeLooks is the expensive step). */
function placement(deps: OrchestrateDeps): Placement {
  const items: MapItem[] = deps.list().map((p) => {
    const r = deps.reading(p.id);
    return { id: p.id, sceneId: p.look.sceneId, busy: r ? r.busy : null, bright: r ? r.bright : null };
  });
  const key = items.map((i) => `${i.id}|${i.sceneId}|${i.busy}|${i.bright}`).join("\n");
  if (key !== placementKey) {
    placementKey = key;
    placed = { points: placeLooks(items), sceneOf: new Map(items.map((i) => [i.id, i.sceneId] as const)) };
  }
  return placed;
}

/** The puck is one place shared by the full view's Map and the small one, so a drag in either moves both. */
const puck = {
  x: 0.5,
  y: 0.5,
  dragging: false,
  lastDragMs: -Infinity,
  lastFollowMs: -Infinity,
  lastStepMs: null as number | null,
  lastNearest: null as string | null,
};

/** Between the two places nearest the puck: blend when they share a scene, else launch the nearest pad (on a follow step only when it changed). */
function applyPuck(deps: OrchestrateDeps, pl: Placement, mode: "drag" | "follow"): void {
  const near = nearestTwo(pl.points, puck);
  if (!near) return;
  const sceneA = pl.sceneOf.get(near.a);
  if (near.b !== null && sceneA !== undefined && sceneA === pl.sceneOf.get(near.b)) {
    deps.blend(near.a, near.b, near.share);
    return;
  }
  const fresh = near.a !== puck.lastNearest;
  puck.lastNearest = near.a;
  if (near.a === deps.livePadId()) return;
  if (mode === "follow" && !fresh) return;
  deps.launchNow(near.a);
}

/** Follow the music: while on, the puck glides toward the energy's place on the diagonal and the pick is re-applied on a fixed cadence. */
function stepPuck(deps: OrchestrateDeps, pl: Placement, nowMs: number): void {
  const dt = puck.lastStepMs === null ? 0 : Math.min(1, Math.max(0, (nowMs - puck.lastStepMs) / 1000));
  puck.lastStepMs = nowMs;
  if (puck.dragging || !deps.follow()) {
    puck.lastFollowMs = -Infinity;
    return;
  }
  const target = FOLLOW_LOW + FOLLOW_SPAN * clamp01(deps.energy());
  const k = 1 - Math.exp(-dt / FOLLOW_EASE_S);
  puck.x += (target - puck.x) * k;
  puck.y += (target - puck.y) * k;
  if (nowMs - puck.lastFollowMs >= PUCK_FOLLOW_MS) {
    puck.lastFollowMs = nowMs;
    applyPuck(deps, pl, "follow");
  }
}

function makeDot(): { el: HTMLElement; pic: HTMLCanvasElement; name: HTMLElement; share: HTMLElement; drawn: { at: number | null } } {
  const el = elm("div", "desk-orch-dot");
  const pic = elm("canvas", "desk-orch-dot-pic");
  pic.width = DOT_CANVAS_PX;
  pic.height = DOT_CANVAS_PX;
  pic.style.width = `${DOT_PX}px`;
  pic.style.height = `${DOT_PX}px`;
  const name = elm("span", "desk-orch-dot-name");
  const share = elm("span", "desk-orch-dot-share");
  el.append(pic, name, share);
  return { el, pic, name, share, drawn: { at: null } };
}

function createMapBlock(deps: OrchestrateDeps, size: "full" | "mini"): { el: HTMLElement; tick(nowMs: number): void } {
  const root = elm("div", `desk-orch-map ${size}`);
  const field = elm("div", "desk-orch-field");
  const puckEl = elm("div", "desk-orch-puck");
  field.append(puckEl, elm("span", "desk-orch-axis desk-orch-axis-tl", "BRIGHT"), elm("span", "desk-orch-axis desk-orch-axis-bl", "DARK"));
  const caption = elm("div", "desk-orch-caption");
  caption.append(elm("span", undefined, "CALM"), elm("span", undefined, "BUSY"));
  root.append(field, caption);
  const dots = new Map<string, ReturnType<typeof makeDot>>();

  const placeFrom = (e: PointerEvent): void => {
    const r = field.getBoundingClientRect();
    puck.x = clamp01((e.clientX - r.left) / r.width);
    puck.y = clamp01(1 - (e.clientY - r.top) / r.height);
  };
  field.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    field.setPointerCapture(e.pointerId);
    if (deps.follow()) deps.setFollow(false);
    puck.dragging = true;
    placeFrom(e);
    puck.lastDragMs = performance.now();
    applyPuck(deps, placement(deps), "drag");
  });
  field.addEventListener("pointermove", (e) => {
    if (!puck.dragging) return;
    placeFrom(e);
    const t = performance.now();
    if (t - puck.lastDragMs >= PUCK_DRAG_MS) {
      puck.lastDragMs = t;
      applyPuck(deps, placement(deps), "drag");
    }
  });
  const release = (e: PointerEvent): void => {
    if (!puck.dragging) return;
    puck.dragging = false;
    placeFrom(e);
    applyPuck(deps, placement(deps), "drag");
  };
  field.addEventListener("pointerup", release);
  field.addEventListener("pointercancel", release);

  function tick(nowMs: number): void {
    const pl = placement(deps);
    const pads = new Map(deps.list().map((p) => [p.id, p] as const));
    stepPuck(deps, pl, nowMs);
    const near = nearestTwo(pl.points, puck);
    const sceneA = near ? pl.sceneOf.get(near.a) : undefined;
    const blends = near !== null && near.b !== null && sceneA !== undefined && sceneA === pl.sceneOf.get(near.b);
    const alive = new Set<string>();
    for (const pt of pl.points) {
      alive.add(pt.id);
      let dot = dots.get(pt.id);
      if (!dot) {
        dot = makeDot();
        dots.set(pt.id, dot);
        field.appendChild(dot.el);
      }
      const pad = pads.get(pt.id);
      if (pad) {
        if (dot.name.textContent !== pad.name) dot.name.textContent = pad.name;
        paintPad(dot.pic, pad, dot.drawn, true);
      }
      dot.el.style.left = `${pt.x * 100}%`;
      dot.el.style.top = `${(1 - pt.y) * 100}%`;
      const ringed = near !== null && (near.a === pt.id || near.b === pt.id);
      dot.el.classList.toggle("near", ringed);
      let share = "";
      if (ringed && blends && near) share = `${Math.round((near.a === pt.id ? 1 - near.share : near.share) * 100)}%`;
      if (dot.share.textContent !== share) dot.share.textContent = share;
    }
    for (const [id, dot] of dots) {
      if (alive.has(id)) continue;
      dot.el.remove();
      dots.delete(id);
    }
    puckEl.style.left = `${puck.x * 100}%`;
    puckEl.style.top = `${(1 - puck.y) * 100}%`;
  }

  return { el: root, tick };
}

// ---- pills and legend -------------------------------------------------------

/** AUTOPILOT and FOLLOW THE MUSIC; turning one on turns the other off. */
function createPills(deps: OrchestrateDeps): { el: HTMLElement; tick(): void } {
  const el = elm("div", "desk-orch-pills");
  const auto = button("desk-orch-pill", "AUTOPILOT");
  const follow = button("desk-orch-pill", "FOLLOW THE MUSIC");
  auto.addEventListener("click", () => {
    const on = !deps.autopilot().on;
    deps.setAutopilot({ on });
    if (on && deps.follow()) deps.setFollow(false);
  });
  follow.addEventListener("click", () => {
    const on = !deps.follow();
    deps.setFollow(on);
    if (on && deps.autopilot().on) deps.setAutopilot({ on: false });
  });
  el.append(auto, follow);
  function tick(): void {
    auto.classList.toggle("on", deps.autopilot().on);
    follow.classList.toggle("on", deps.follow());
  }
  return { el, tick };
}

function createLegend(): HTMLElement {
  const el = elm("div", "desk-orch-legend");
  const items: [string, string][] = [
    ["live", "LIVE"],
    ["queued", "queued"],
    ["pick", "Autopilot's next"],
    ["phrase", "phrase line"],
  ];
  for (const [cls, label] of items) {
    const item = elm("span", "desk-orch-key");
    item.append(elm("i", `desk-orch-sw ${cls}`), label);
    el.appendChild(item);
  }
  return el;
}

// ---- views -----------------------------------------------------------------

/** The full Orchestrate view: TIMELINE (shelf, lanes, next change) or MAP, with the pills under both. */
export function createOrchestrateView(deps: OrchestrateDeps): { el: HTMLElement; tick(nowMs: number): void } {
  const root = elm("div", "desk-orch-view");
  const tabBar = elm("div", "desk-orch-tabs");
  const tlTab = button("desk-orch-tab", "TIMELINE");
  const mapTab = button("desk-orch-tab", "MAP");
  tabBar.append(tlTab, mapTab);

  const tlPane = elm("section", "desk-orch-pane");
  const lanes = createLanes(deps, {
    lanes: FULL_LANES,
    pastBars: TIMELINE_PAST_BARS,
    futureBars: TIMELINE_FUTURE_BARS,
    labels: true,
    interactive: true,
  });
  const shelf = createShelf(deps, lanes);
  const nextLine = elm("div", "desk-orch-next", "Nothing coming");
  const tlPills = createPills(deps);
  tlPane.append(shelf.el, lanes.el, nextLine, createLegend(), tlPills.el);

  const mapPane = elm("section", "desk-orch-pane desk-orch-mappane");
  const map = createMapBlock(deps, "full");
  const mapPills = createPills(deps);
  const mapSide = elm("div", "desk-orch-mapside");
  mapSide.appendChild(mapPills.el);
  mapPane.append(map.el, mapSide);

  root.append(tabBar, tlPane, mapPane);

  let tab: "timeline" | "map" = "timeline";
  function show(next: "timeline" | "map"): void {
    tab = next;
    tlTab.classList.toggle("on", next === "timeline");
    mapTab.classList.toggle("on", next === "map");
    tlPane.hidden = next !== "timeline";
    mapPane.hidden = next !== "map";
  }
  tlTab.addEventListener("click", () => show("timeline"));
  mapTab.addEventListener("click", () => show("map"));
  show("timeline");

  return {
    el: root,
    tick(nowMs) {
      recordHistory(deps);
      if (tab === "timeline") {
        lanes.tick();
        shelf.tick();
        nextLine.textContent = nextChangeText(deps);
      } else {
        map.tick(nowMs);
      }
      tlPills.tick();
      mapPills.tick();
    },
  };
}

/** The small form on the main page: the coming bars, the next change, the pills, ⤢ Open (`open`), and a small Map. */
export function createOrchestrateMini(deps: OrchestrateDeps, open: () => void): { el: HTMLElement; tick(nowMs: number): void } {
  const root = elm("div", "desk-orch-mini");
  const left = elm("div", "desk-orch-mini-left");
  const lanes = createLanes(deps, {
    lanes: MINI_LANES,
    pastBars: MINI_PAST_BARS,
    futureBars: MINI_FUTURE_BARS,
    labels: false,
    interactive: false,
  });
  const nextLine = elm("div", "desk-orch-next", "Nothing coming");
  const pills = createPills(deps);
  const openBtn = button("desk-orch-open", "⤢ Open");
  openBtn.addEventListener("click", () => open());
  const row = elm("div", "desk-orch-mini-row");
  row.append(pills.el, openBtn);
  left.append(lanes.el, nextLine, row);
  const map = createMapBlock(deps, "mini");
  root.append(left, map.el);

  return {
    el: root,
    tick(nowMs) {
      recordHistory(deps);
      lanes.tick();
      nextLine.textContent = nextChangeText(deps);
      pills.tick();
      map.tick(nowMs);
    },
  };
}
