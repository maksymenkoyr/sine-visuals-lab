/**
 * The middle column of the panel (Sound → Shaping → Scene): one card per
 * shaping node (src/render/shapingNodes.ts). A node takes one input node and
 * sends a changed copy of it out of its own jack, with the same controls a
 * setting's own wire panel has: Window (Min and Max from 0 up to the input's
 * own learned peak, reusing the generic gate in src/render/gateWindow.ts),
 * Smoothness (how far the window softens), Length (a straight fall after each rise) and,
 * for a hit-kind input, Height. The node's monitor row carries its output
 * jack, so any setting plugs into a node exactly as it plugs into an input
 * node. The row's input port is where the cable from the input node's own
 * jack ends (feedGroups). Graphs never rescale: input and output are drawn on
 * the fixed 0..1 scale every monitor uses, and the window's Min and Max lines
 * are drawn dashed on that same scale. Each card has a heat strip, as every
 * input node's monitor does.
 *
 * Each node keeps its rings and heat track by id, so a rebuild (a node added,
 * removed, or changed elsewhere) keeps every card's history. A slider writes
 * its value straight to the store without a rebuild, since a rebuild would
 * tear out the slider being dragged.
 */
import type { AudioMetersDeps } from "./audioMeters.ts";
import { createMeterRow, meterGroupHeading } from "./audioMeters.ts";
import type { CableGroupSpec } from "./cableLayer.ts";
import { createCanvasSizer, type CanvasSizer } from "./canvasSizer.ts";
import { createCard, paletteChipStyle, type CardFold } from "./controlsKit.ts";
import { createHeatTrack, heatHistory, heatStripBackground, heatText, HEAT_HISTORY_CELLS, HEAT_REFRESH_MS, type HeatTrack } from "./heat.ts";
import { createJack, setRowFed, type JackHandle } from "./jack.ts";
import { getHistorySpan } from "./historySpan.ts";
import { driveSourceColor, driveSourceLabel, HEIGHT_OPTIONS, jackKey, shapingInputGroups, shapingNodeLabel } from "./driveSources.ts";
import { FONT_LABEL, FONT_MONO } from "./controlsTheme.ts";
import { isShapedChoice, type DriveSourceChoice } from "../render/drives.ts";
import { removeShapedSource } from "../render/driveStore.ts";
import { getNodeGateFormula, setNodeGateFormula } from "../render/gateFormulas.ts";
import { buildGateFormulaPicker } from "./gateFormulaPicker.ts";
import { SIGNALS, type SignalId } from "../render/signals.ts";
import {
  addShapingNode,
  getShapingNode,
  listShapingNodes,
  removeShapingNode,
  SHAPING_LENGTH_MAX_SEC,
  SHAPING_NODES_MAX,
  subscribeShapingNodes,
  type ShapingNode,
  updateShapingNode,
} from "../render/shapingNodes.ts";

export interface ShapingColumnDeps {
  /** The same jack logic every meter jack uses (deviceMenu.ts passes the bundle it gives audioMeters). */
  patch: AudioMetersDeps["patch"];
  /** A node's live reading (DriveEngine.shaped) — works with the panel closed. */
  getReading(id: string): { input: number; output: number; line: number; top: number } | null;
  /** A node was added or removed: wire panels, row summaries, jacks and cables must refresh. */
  onStructureChanged(): void;
  /** The column's layout moved (cards rebuilt, a fold): recompute cables. */
  onLayout(): void;
  /** A node's monitor row or input port was clicked (the pin toggle, deviceMenu.ts toggleNodePin). */
  onNodePress(id: string): void;
  /** Whether this node is the pinned one (deviceMenu.ts), read on every patch view refresh. */
  isNodePinned(id: string): boolean;
}

export interface ShapingColumn {
  el: HTMLElement;
  jackElements(): ReadonlyMap<string, HTMLElement>;
  /** One cable group per node: from its input node's jack (looked up in jackEls by jackKey(node.src)) to the node's input port. Skips a node whose input has no jack on screen. */
  feedGroups(jackEls: ReadonlyMap<string, HTMLElement>): CableGroupSpec[];
  /** Jack fill / pressed / usage dots / labels and the row's fed glow — like audioMeters' refreshPatchView. */
  refreshPatchView(): void;
  /** The jack tooltip's heat line for a shaped choice, else null. */
  jackHeatText(choice: DriveSourceChoice): string | null;
  /** Every tick, panel open or closed: records each node's history and heat; draws only when onScreen. */
  update(level: number | null, onScreen: boolean): void;
  /** Glows every card on the chain (null: no chain lit) and marks the focused node's card. Kept across rebuilds. */
  setChain(nodes: ReadonlySet<string> | null, focusId: string | null): void;
}

/** Height of a node's graph, in CSS px. */
const GRAPH_CSS_PX = 58;
/** Samples kept per trace: the graph's time span. */
const RING_LEN = 240;
const DT_MIN_SEC = 1e-4;
const DT_MAX_SEC = 1 / 15;
const THRESHOLD_LINE = "rgba(195,165,249,0.75)";
const INPUT_TRACE = "rgba(255,255,255,0.28)";
const OUTPUT_TRACE = "#fff";
const THRESHOLD_DASH: number[] = [3, 3];
const NO_DASH: number[] = [];
const DIMMED_OPACITY = "0.38";
const zeroReading = (): number => 0;

const blurbStyle = `font: 400 12px/1.35 ${FONT_LABEL}; color: rgba(255,255,255,0.6); padding: 0 4px;`;
const addWrapStyle = `display: flex; flex-direction: column; gap: 6px;`;
const addBtnStyle = `font: 500 14px ${FONT_LABEL}; color: #f9b96c; background: none; border: 0; border-bottom: 1px solid rgba(249,185,108,0.5); padding: 0; align-self: flex-start; cursor: pointer;`;
const chipsWrapStyle = `display: flex; flex-direction: column; gap: 6px;`;
const captionStyle = `font: 400 10px/1.2 ${FONT_MONO}; letter-spacing: 0.06em; color: rgba(255,255,255,0.5); text-transform: uppercase;`;
const chipRowStyle = `display: flex; flex-wrap: wrap; gap: 4px;`;
const chipStyle = `${paletteChipStyle} display: inline-flex; align-items: center; gap: 6px;`;
const dotStyle = `width: 7px; height: 7px; border-radius: 50%; flex: none;`;
const removeBtnStyle = `background: none; border: none; color: rgba(255,255,255,0.4); font: 15px/1 ${FONT_MONO}; padding: 2px 5px; border-radius: 3px; cursor: pointer;`;
const canvasStyle = `display: block; width: 100%; height: ${GRAPH_CSS_PX}px; border-top: 1px solid rgba(255,255,255,0.12); border-bottom: 1px solid rgba(255,255,255,0.12);`;
const legendStyle = `font: 400 10.5px/1.2 ${FONT_MONO}; letter-spacing: 0.06em; text-transform: uppercase; color: rgba(255,255,255,0.5);`;
const controlStyle = `display: flex; flex-direction: column; gap: 4px;`;
const controlHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const controlNameStyle = `display: flex; align-items: center; gap: 7px; font: 500 14px ${FONT_LABEL}; color: #fff;`;
const controlValueStyle = `font: 400 12px/1 ${FONT_MONO}; color: rgba(255,255,255,0.6);`;
const sliderStyle = `width: 100%; margin: 0;`;
const endsStyle = `display: flex; justify-content: space-between; font: 400 11px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.55);`;
const windowRowStyle = `display: flex; align-items: center; gap: 8px;`;
const windowRowNameStyle = `font: 400 11px/1 ${FONT_MONO}; width: 28px; flex: none; color: rgba(255,255,255,0.6);`;
const segStyle = `display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px; background: rgba(255,255,255,0.06);`;
const segBtnStyle = `font: 500 12px/1 ${FONT_LABEL}; color: rgba(255,255,255,0.6); background: transparent; border: 0; border-radius: 999px; padding: 5px 10px; cursor: pointer;`;
const segBtnLitStyle = `font: 500 12px/1 ${FONT_LABEL}; color: #fff; background: rgba(255,255,255,0.14); border: 0; border-radius: 999px; padding: 5px 10px; cursor: pointer;`;

/** Per node, kept across rebuilds: its rings, heat track and canvas. */
interface NodeState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  sizer: CanvasSizer;
  inRing: Float32Array;
  outRing: Float32Array;
  /** The window's Min and Max lines on the input's scale, one sample per tick. */
  lineRing: Float32Array;
  topRing: Float32Array;
  head: number;
  input: number;
  output: number;
  heat: HeatTrack;
}

/** One node's card as the current render built it. */
interface NodeView {
  id: string;
  src: SignalId;
  srcColor: string;
  choice: DriveSourceChoice;
  color: string;
  row: ReturnType<typeof createMeterRow>;
  jack: JackHandle;
  inportEl: HTMLElement;
  fold: CardFold | undefined;
  strip: HTMLElement;
  heatBg: string;
  el: HTMLDivElement;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** The graph's y for a 0..1 value: fixed scale, a 2px margin top and bottom. */
function yOf(v: number): number {
  return GRAPH_CSS_PX - 2 - clamp01(v) * (GRAPH_CSS_PX - 4);
}

function tracePath(ctx: CanvasRenderingContext2D, ring: Float32Array, head: number, w: number): void {
  ctx.beginPath();
  for (let i = 0; i < RING_LEN; i++) {
    const v = ring[(head + i) % RING_LEN]!;
    const x = (i / (RING_LEN - 1)) * w;
    if (i === 0) ctx.moveTo(x, yOf(v));
    else ctx.lineTo(x, yOf(v));
  }
  ctx.stroke();
}

function setFill(input: HTMLInputElement, v: number, min: number, max: number): void {
  input.style.setProperty("--vc-fill", `${((v - min) / (max - min)) * 100}%`);
}

interface ControlOpts {
  name: string;
  /** The slider's aria-label, e.g. "<node label> smoothness". */
  aria: string;
  accent: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format(v: number): string;
  onInput(v: number): void;
  switchOn?: boolean;
  onSwitch?: (on: boolean) => void;
  ends?: [string, string];
}

/** One control: a head line (optional switch, name, value), its slider, and
 *  optional ends labels under it. A switch that is off dims the slider and
 *  its value, in place. */
function buildControl(opts: ControlOpts): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = controlStyle;
  const head = document.createElement("div");
  head.style.cssText = controlHeadStyle;
  const name = document.createElement("div");
  name.style.cssText = controlNameStyle;
  const dimmed: HTMLElement[] = [];

  const setDim = (on: boolean): void => {
    for (const d of dimmed) d.style.opacity = on ? "" : DIMMED_OPACITY;
  };
  if (opts.onSwitch) {
    const onSwitch = opts.onSwitch;
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "vc-mute-switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("aria-checked", String(opts.switchOn ?? false));
    sw.setAttribute("aria-label", `${opts.aria} on/off`);
    sw.style.setProperty("--c", opts.accent);
    sw.title = opts.hint;
    sw.addEventListener("click", () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", String(next));
      setDim(next);
      onSwitch(next);
    });
    name.append(sw);
  }
  const nameText = document.createElement("span");
  nameText.textContent = opts.name;
  name.append(nameText);

  const value = document.createElement("output");
  value.style.cssText = controlValueStyle;
  value.textContent = opts.format(opts.value);

  head.append(name, value);

  const input = document.createElement("input");
  input.type = "range";
  input.className = "vc-slider";
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.value = String(opts.value);
  input.style.cssText = sliderStyle;
  input.style.setProperty("--vc-accent", opts.accent);
  input.title = opts.hint;
  input.setAttribute("aria-label", opts.aria);
  setFill(input, opts.value, opts.min, opts.max);
  input.addEventListener("input", () => {
    const v = Number(input.value);
    setFill(input, v, opts.min, opts.max);
    value.textContent = opts.format(v);
    opts.onInput(v);
  });

  el.append(head, input);
  if (opts.ends) {
    const ends = document.createElement("div");
    ends.style.cssText = endsStyle;
    const [left, right] = opts.ends;
    const l = document.createElement("span");
    l.textContent = left;
    const r = document.createElement("span");
    r.textContent = right;
    ends.append(l, r);
    el.append(ends);
  }

  if (opts.onSwitch) {
    dimmed.push(input, value);
    setDim(opts.switchOn ?? false);
  }
  return el;
}

/** The Window control: an On/Off switch on its head line, the window's value
 *  ("Min – Max"), then Min and Max sliders. Min and Max keep Min ≤ Max: dragging
 *  one past the other drags the other along, and both are written. */
function buildWindowControl(node: ShapingNode, label: string, accent: string): HTMLElement {
  const hint =
    "Which stretch of this input, from nothing up to its own peak, moves the output: under Min it reads 0, over Max it reads full, so Min 0 and Max 1 pass it through as it is. The peak is learned from the music, so the window holds from one song to the next.";
  const el = document.createElement("div");
  el.style.cssText = controlStyle;
  const head = document.createElement("div");
  head.style.cssText = controlHeadStyle;
  const name = document.createElement("div");
  name.style.cssText = controlNameStyle;

  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "vc-mute-switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(node.windowOn));
  sw.setAttribute("aria-label", `${label} window on/off`);
  sw.style.setProperty("--c", accent);
  sw.title = hint;
  const nameText = document.createElement("span");
  nameText.textContent = "Window";
  name.append(sw, nameText);

  const value = document.createElement("output");
  value.style.cssText = controlValueStyle;

  let min = node.min;
  let max = node.max;
  const showValue = (): void => {
    value.textContent = `${min.toFixed(2)} – ${max.toFixed(2)}`;
  };
  showValue();
  head.append(name, value);

  const range = (aria: string, v: number): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.className = "vc-slider";
    input.min = "0";
    input.max = "1";
    input.step = "0.01";
    input.value = String(v);
    input.style.cssText = sliderStyle;
    input.style.setProperty("--vc-accent", accent);
    input.title = hint;
    input.setAttribute("aria-label", aria);
    setFill(input, v, 0, 1);
    return input;
  };
  const minInput = range(`${label} window min`, min);
  const maxInput = range(`${label} window max`, max);

  const rowFor = (text: string, input: HTMLInputElement): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText = windowRowStyle;
    const n = document.createElement("span");
    n.style.cssText = windowRowNameStyle;
    n.textContent = text;
    row.append(n, input);
    return row;
  };

  minInput.addEventListener("input", () => {
    const v = Number(minInput.value);
    setFill(minInput, v, 0, 1);
    min = v;
    if (v > max) {
      max = v;
      maxInput.value = String(v);
      setFill(maxInput, v, 0, 1);
      updateShapingNode(node.id, { min: v, max: v });
    } else {
      updateShapingNode(node.id, { min: v });
    }
    showValue();
  });
  maxInput.addEventListener("input", () => {
    const v = Number(maxInput.value);
    setFill(maxInput, v, 0, 1);
    max = v;
    if (v < min) {
      min = v;
      minInput.value = String(v);
      setFill(minInput, v, 0, 1);
      updateShapingNode(node.id, { min: v, max: v });
    } else {
      updateShapingNode(node.id, { max: v });
    }
    showValue();
  });

  const dimmed: HTMLElement[] = [minInput, maxInput, value];
  const setDim = (on: boolean): void => {
    for (const d of dimmed) d.style.opacity = on ? "" : DIMMED_OPACITY;
  };
  sw.addEventListener("click", () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    setDim(next);
    updateShapingNode(node.id, { windowOn: next });
  });
  setDim(node.windowOn);

  const ends = document.createElement("div");
  ends.style.cssText = endsStyle;
  const zero = document.createElement("span");
  zero.textContent = "Nothing";
  const peak = document.createElement("span");
  peak.textContent = "Its peak";
  ends.append(zero, peak);

  el.append(head, rowFor("Min", minInput), rowFor("Max", maxInput), ends);
  return el;
}

/** The Height row for a hit-kind input: a segmented group of HEIGHT_OPTIONS.
 *  A click writes the store and restyles the three buttons in place. */
function buildHeightRow(node: ShapingNode, label: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = controlHeadStyle;
  const name = document.createElement("div");
  name.style.cssText = controlNameStyle;
  name.textContent = "Height";
  const seg = document.createElement("div");
  seg.style.cssText = segStyle;
  seg.setAttribute("role", "group");
  seg.setAttribute("aria-label", `${label} height`);
  const buttons = HEIGHT_OPTIONS.map((opt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = opt.label;
    b.title = opt.hint;
    return { opt, b };
  });
  const paint = (h: string): void => {
    for (const { opt, b } of buttons) {
      const lit = opt.h === h;
      b.setAttribute("aria-pressed", String(lit));
      b.style.cssText = lit ? segBtnLitStyle : segBtnStyle;
    }
  };
  for (const { opt, b } of buttons) {
    b.addEventListener("click", () => {
      updateShapingNode(node.id, { height: opt.h });
      paint(opt.h);
    });
  }
  paint(node.height);
  seg.append(...buttons.map((x) => x.b));
  el.append(name, seg);
  return el;
}

export function createShapingColumn(deps: ShapingColumnDeps): ShapingColumn {
  const el = document.createElement("div");
  el.className = "vc-shape-col vc-scroll";

  const heading = meterGroupHeading("Modifiers");
  const blurb = document.createElement("div");
  blurb.style.cssText = blurbStyle;
  blurb.textContent = "Changes the sound itself. Plug a modifier's jack into any setting.";

  const addWrap = document.createElement("div");
  addWrap.style.cssText = addWrapStyle;
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ New modifier";
  addBtn.style.cssText = addBtnStyle;
  const chips = document.createElement("div");
  chips.style.cssText = chipsWrapStyle;
  chips.style.display = "none";
  addWrap.append(addBtn, chips);
  el.append(heading, blurb, addWrap);

  const states = new Map<string, NodeState>();
  const views = new Map<string, NodeView>();
  /** The last setChain arguments, re-applied at the end of rebuild(). */
  let chainNodes: ReadonlySet<string> | null = null;
  let chainFocusId: string | null = null;
  const jackMap = new Map<string, HTMLElement>();
  const cardEls: HTMLElement[] = [];
  let renderedKey = "";
  /** True while this column itself edits the store, so its subscriber does not rebuild twice. */
  let suppress = false;
  let lastMs: number | null = null;
  let lastHeatMs = 0;

  function stateFor(id: string): NodeState {
    let st = states.get(id);
    if (!st) {
      const canvas = document.createElement("canvas");
      canvas.style.cssText = canvasStyle;
      const ctx = canvas.getContext("2d")!;
      st = {
        canvas,
        ctx,
        sizer: createCanvasSizer(canvas, ctx, { heightCssPx: GRAPH_CSS_PX }),
        inRing: new Float32Array(RING_LEN),
        outRing: new Float32Array(RING_LEN),
        lineRing: new Float32Array(RING_LEN),
        topRing: new Float32Array(RING_LEN),
        head: 0,
        input: 0,
        output: 0,
        heat: createHeatTrack(),
      };
      states.set(id, st);
    }
    return st;
  }

  function keyOf(list: readonly ShapingNode[]): string {
    return list.map((n) => `${n.id}:${n.src}`).join("|");
  }

  function updateAddVisibility(): void {
    const full = listShapingNodes().length >= SHAPING_NODES_MAX;
    addWrap.style.display = full ? "none" : "";
    if (full) closeChips();
  }

  function closeChips(): void {
    chips.style.display = "none";
    chips.replaceChildren();
  }

  function openChips(): void {
    const groups = shapingInputGroups();
    const wrap: HTMLElement[] = [];
    for (const g of groups) {
      const caption = document.createElement("div");
      caption.style.cssText = captionStyle;
      caption.textContent = g.label;
      const row = document.createElement("div");
      row.style.cssText = chipRowStyle;
      for (const id of g.choices) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.style.cssText = chipStyle;
        const dot = document.createElement("span");
        dot.style.cssText = `${dotStyle} background: ${driveSourceColor(id)};`;
        const text = document.createElement("span");
        text.textContent = driveSourceLabel(id);
        chip.append(dot, text);
        chip.addEventListener("click", () => {
          suppress = true;
          try {
            addShapingNode(id);
          } finally {
            suppress = false;
          }
          closeChips();
          rebuild(true);
          deps.onStructureChanged();
        });
        row.append(chip);
      }
      wrap.push(caption, row);
    }
    chips.replaceChildren(...wrap);
    chips.style.display = "";
  }

  addBtn.addEventListener("click", () => {
    if (chips.style.display === "none") openChips();
    else closeChips();
  });

  function buildCard(node: ShapingNode): NodeView {
    const st = stateFor(node.id);
    const color = driveSourceColor(node.src);
    const choice: DriveSourceChoice = { source: "shaped", id: node.id };
    const label = shapingNodeLabel(node.id);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "×";
    removeBtn.setAttribute("aria-label", `Remove ${label}`);
    removeBtn.title = "Remove this modifier — its wires are unplugged everywhere.";
    removeBtn.style.cssText = removeBtnStyle;
    removeBtn.addEventListener("click", () => {
      suppress = true;
      try {
        removeShapingNode(node.id);
        removeShapedSource(node.id);
      } finally {
        suppress = false;
      }
      rebuild(true);
      deps.onStructureChanged();
    });

    const card = createCard({ title: label, accent: color, foldId: `shape-${node.id}`, right: removeBtn });
    card.el.classList.add("vc-shape-node");
    card.el.dataset.nodeId = node.id;
    card.el.style.setProperty("--vc-node-c", color);

    const row = createMeterRow({
      label: `In: ${driveSourceLabel(node.src)}`,
      accent: color,
      description: "This modifier takes the input node named here and sends a changed copy out of its jack. Plug the jack into any setting, like an input node's.",
    });
    // A click on the row or its input port (inportEl sits inside the row)
    // pins the node; the jack's own click stops propagation before here.
    row.el.style.cursor = "pointer";
    row.el.title = "Click to pin this modifier: its chain stays lit, and a click on an input jack makes it read that input.";
    row.el.addEventListener("click", () => deps.onNodePress(node.id));
    const inportEl = document.createElement("span");
    inportEl.className = "vc-shape-inport";
    inportEl.style.setProperty("--c", color);
    row.el.querySelector(".vc-label")?.prepend(inportEl);
    const jack = createJack(
      color,
      () => deps.patch.onJackClick(choice),
      (on) => deps.patch.onJackHover(choice, on),
    );
    deps.patch.registerJack(jack.el, choice);
    row.right.append(jack.el);

    const legend = document.createElement("div");
    legend.style.cssText = legendStyle;
    legend.textContent = "Faint = in · White = out · Dashed = window";

    const monitor = document.createElement("div");
    monitor.className = "vc-heat-monitor";
    const line = document.createElement("div");
    line.className = "vc-heat-monitor-line";
    line.style.setProperty("--c", color);
    const strip = document.createElement("div");
    strip.className = "vc-heat-strip";
    line.append(strip);
    monitor.append(line);

    const windowEl = buildWindowControl(node, label, color);
    const smoothness = buildControl({
      name: "Smoothness",
      aria: `${label} smoothness`,
      accent: color,
      hint: "How gently the window starts and ends. Left: exactly at Min and Max. Right: a softer rise toward nothing and toward the peak, while silence still gives nothing and the peak still gives full.",
      min: 0,
      max: 1,
      step: 0.01,
      value: node.smoothness,
      format: (v) => v.toFixed(2),
      onInput: (v) => updateShapingNode(node.id, { smoothness: v }),
      switchOn: node.smoothOn,
      onSwitch: (on) => updateShapingNode(node.id, { smoothOn: on }),
      ends: ["Exact", "Soft edges"],
    });
    const length = buildControl({
      name: "Length",
      aria: `${label} length`,
      accent: color,
      hint: "How long the output takes to fall after each rise. Off: it falls as fast as the input does.",
      min: 0,
      max: SHAPING_LENGTH_MAX_SEC,
      step: 0.01,
      value: node.length,
      format: (v) => (v === 0 ? "Off" : `${v.toFixed(2)} s`),
      onInput: (v) => updateShapingNode(node.id, { length: v }),
      ends: ["Off", "Long tail"],
    });

    card.body.append(row.el, st.canvas, legend, monitor, windowEl, smoothness);
    // Dev only, while PR #544 picks Smoothness's formula (render/gateFormulas.ts's header).
    if (import.meta.env.DEV) card.body.append(buildGateFormulaPicker(getNodeGateFormula(node.id), (f) => setNodeGateFormula(node.id, f)));
    card.body.append(length);
    if (SIGNALS[node.src].kind === "edge") card.body.append(buildHeightRow(node, label));

    return {
      id: node.id,
      src: node.src,
      srcColor: color,
      choice,
      color,
      row,
      jack,
      inportEl,
      fold: card.fold,
      strip,
      heatBg: "",
      el: card.el,
    };
  }

  function rebuild(notifyLayout: boolean): void {
    const list = listShapingNodes();
    renderedKey = keyOf(list);
    const listed = new Set(list.map((n) => n.id));
    for (const id of [...states.keys()]) if (!listed.has(id)) states.delete(id);
    for (const c of cardEls) c.remove();
    cardEls.length = 0;
    views.clear();
    jackMap.clear();
    for (const node of list) {
      const v = buildCard(node);
      views.set(node.id, v);
      cardEls.push(v.el);
      el.insertBefore(v.el, addWrap);
      jackMap.set(jackKey(v.choice), v.jack.el);
    }
    updateAddVisibility();
    applyChain();
    if (notifyLayout) deps.onLayout();
  }

  function applyChain(): void {
    for (const v of views.values()) {
      v.el.classList.toggle("vc-chain-lit", chainNodes !== null && chainNodes.has(v.id) && v.id !== chainFocusId);
      v.el.classList.toggle("vc-chain-focus", v.id === chainFocusId);
    }
  }

  function drawGraph(st: NodeState, node: ShapingNode | undefined): void {
    if (!st.sizer.ensure()) return;
    const ctx = st.ctx;
    const w = st.sizer.width;
    ctx.clearRect(0, 0, w, GRAPH_CSS_PX);
    if (node?.windowOn) {
      ctx.strokeStyle = THRESHOLD_LINE;
      ctx.lineWidth = 1;
      ctx.setLineDash(THRESHOLD_DASH);
      tracePath(ctx, st.lineRing, st.head, w);
      tracePath(ctx, st.topRing, st.head, w);
      ctx.setLineDash(NO_DASH);
    }
    ctx.strokeStyle = INPUT_TRACE;
    ctx.lineWidth = 1.4;
    tracePath(ctx, st.inRing, st.head, w);
    ctx.strokeStyle = OUTPUT_TRACE;
    ctx.lineWidth = 2;
    tracePath(ctx, st.outRing, st.head, w);
  }

  rebuild(false);
  subscribeShapingNodes(() => {
    if (suppress) return;
    if (keyOf(listShapingNodes()) === renderedKey) return;
    rebuild(true);
    deps.onStructureChanged();
  });

  return {
    el,

    jackElements() {
      return jackMap;
    },

    feedGroups(jackEls) {
      const groups: CableGroupSpec[] = [];
      for (const v of views.values()) {
        const jackEl = jackEls.get(jackKey(v.src));
        if (!jackEl) continue;
        groups.push({
          portEl: v.inportEl,
          sources: [{ key: `feed:${v.id}`, color: v.srcColor, soft: false, jackEl, getValue: zeroReading }],
        });
      }
      return groups;
    },

    refreshPatchView() {
      const previewOn = deps.patch.previewIsActive();
      for (const v of views.values()) {
        const c = v.choice;
        v.jack.setFilled(deps.patch.isShown(c));
        v.jack.setPressed(deps.patch.isPinned(c));
        v.jack.setUses(deps.patch.usage(c));
        const { aria, title } = deps.patch.describe(c);
        v.jack.setLabel(aria, title);
        const pinnedNode = deps.isNodePinned(v.id);
        v.el.classList.toggle("vc-shape-pinned", pinnedNode);
        v.inportEl.classList.toggle("vc-shape-inport-on", pinnedNode);
        if (previewOn && deps.patch.isPreviewActive(c)) setRowFed(v.row.el, "soft", v.color);
        else if (deps.patch.isPinnedActive(c)) setRowFed(v.row.el, previewOn ? "faint" : "full", v.color);
        else setRowFed(v.row.el, "none", "");
      }
    },

    setChain(nodes, focusId) {
      chainNodes = nodes;
      chainFocusId = focusId;
      applyChain();
    },

    jackHeatText(choice) {
      if (!isShapedChoice(choice)) return null;
      const st = states.get(choice.id);
      if (!st) return null;
      const span = getHistorySpan("signal");
      return heatText(st.heat.read(span, performance.now() / 1000), span);
    },

    update(level, onScreen) {
      const nowMs = performance.now();
      const dtSec = lastMs === null ? DT_MAX_SEC : Math.min(DT_MAX_SEC, Math.max(DT_MIN_SEC, (nowMs - lastMs) / 1000));
      lastMs = nowMs;
      const nowSec = nowMs / 1000;
      for (const node of listShapingNodes()) {
        const st = stateFor(node.id);
        const r = deps.getReading(node.id);
        const input = r ? r.input : 0;
        const output = r ? r.output : 0;
        st.input = input;
        st.output = output;
        st.inRing[st.head] = input;
        st.outRing[st.head] = output;
        st.lineRing[st.head] = r ? r.line : 0;
        st.topRing[st.head] = r ? r.top : 0;
        st.head = (st.head + 1) % RING_LEN;
        if (level !== null && r) st.heat.push(output, level, nowSec);
      }
      if (!onScreen) return;

      const heatDue = nowMs - lastHeatMs >= HEAT_REFRESH_MS;
      if (heatDue) lastHeatMs = nowMs;
      const span = getHistorySpan("signal");
      for (const v of views.values()) {
        const folded = v.fold ? v.fold.isFolded() : false;
        if (folded) continue;
        const st = states.get(v.id);
        if (!st) continue;
        drawGraph(st, getShapingNode(v.id));
        v.row.setValue(st.output, dtSec);
        v.row.setReadout(st.output.toFixed(2));
        if (heatDue) {
          const bg = heatStripBackground(heatHistory(st.heat, span, nowSec, HEAT_HISTORY_CELLS));
          if (bg !== v.heatBg) {
            v.heatBg = bg;
            v.strip.style.background = bg;
          }
        }
      }
    },
  };
}
