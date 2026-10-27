/**
 * A wire's modifier controls, in the wire panel (deviceMenu.ts's
 * buildSourceLine) or in the open knot on its cable (buildKnotBody, in
 * cableKnots.ts's layer): a small graph of the wire's input and output, then
 * Window (On/Off, Min and Max), Smoothness (On/Off, works with Window off too)
 * Length and Invert, the fields of src/render/wireMod.ts. The wire's Height is built beside them by the caller, not here.
 *
 * Every edit hands the whole modifier to `onChange` without a rebuild, since
 * a rebuild would tear out the slider being dragged. The graph keeps one
 * fixed 0..1 scale (graphs never rescale): input faint, output white, the
 * window's Min and Max lines dashed while the window is on.
 */
import { createCanvasSizer } from "./canvasSizer.ts";
import { FONT_LABEL, FONT_MONO } from "./controlsTheme.ts";
import { buildGateFormulaPicker } from "./gateFormulaPicker.ts";
import type { GateFormula } from "../render/gateWindow.ts";
import { WIRE_LENGTH_MAX_SEC, wireModIsIdle, type WireMod, type WireModState } from "../render/wireMod.ts";

export interface WireModControlsOpts {
  /** The wire's label, for the controls' aria labels. */
  label: string;
  accent: string;
  mod: WireMod;
  onChange(mod: WireMod): void;
  /** A dev build's Smoothness formula picker (render/gateFormulas.ts); absent in production. */
  formula?: { current: GateFormula; onPick(f: GateFormula): void };
}

export interface WireModControls {
  el: HTMLElement;
  /** Once per panel frame with the wire's live state (DriveEngine.wire); draws only while on screen. */
  update(reading: Readonly<WireModState> | null, onScreen: boolean): void;
}

const GRAPH_CSS_PX = 40;
/** Samples kept per trace: the graph's time span. */
const RING_LEN = 240;
const THRESHOLD_LINE = "rgba(195,165,249,0.75)";
const INPUT_TRACE = "rgba(255,255,255,0.28)";
const OUTPUT_TRACE = "#fff";
const THRESHOLD_DASH: number[] = [3, 3];
const NO_DASH: number[] = [];
const DIMMED_OPACITY = "0.38";

const wrapStyle = `flex-basis: 100%; display: flex; flex-direction: column; gap: 6px; margin: 2px 0 4px; padding-left: 10px; border-left: 1px solid rgba(255,255,255,0.12);`;
const canvasStyle = `display: block; width: 100%; height: ${GRAPH_CSS_PX}px; border-top: 1px solid rgba(255,255,255,0.1); border-bottom: 1px solid rgba(255,255,255,0.1);`;
const controlStyle = `display: flex; flex-direction: column; gap: 3px;`;
const headStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
const nameStyle = `display: flex; align-items: center; gap: 7px; font: 500 12.5px ${FONT_LABEL}; color: rgba(255,255,255,0.85);`;
const valueStyle = `font: 400 11.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.6);`;
const sliderStyle = `width: 100%; margin: 0;`;
const endsStyle = `display: flex; justify-content: space-between; font: 400 10.5px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.5);`;
const pairStyle = `display: flex; align-items: center; gap: 8px;`;
const pairNameStyle = `font: 400 10.5px/1 ${FONT_MONO}; width: 26px; flex: none; color: rgba(255,255,255,0.55);`;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

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

function slider(aria: string, accent: string, hint: string, min: number, max: number, value: number): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "range";
  input.className = "vc-slider";
  input.min = String(min);
  input.max = String(max);
  input.step = "0.01";
  input.value = String(value);
  input.style.cssText = sliderStyle;
  input.style.setProperty("--vc-accent", accent);
  input.title = hint;
  input.setAttribute("aria-label", aria);
  setFill(input, value, min, max);
  return input;
}

function onOffSwitch(aria: string, accent: string, hint: string, on: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "vc-mute-switch";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(on));
  sw.setAttribute("aria-label", aria);
  sw.style.setProperty("--c", accent);
  sw.title = hint;
  sw.addEventListener("click", () => {
    const next = sw.getAttribute("aria-checked") !== "true";
    sw.setAttribute("aria-checked", String(next));
    onToggle(next);
  });
  return sw;
}

function ends(left: string, right: string): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = endsStyle;
  const l = document.createElement("span");
  l.textContent = left;
  const r = document.createElement("span");
  r.textContent = right;
  el.append(l, r);
  return el;
}

function head(nameParts: Node[], value: HTMLElement): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = headStyle;
  const name = document.createElement("div");
  name.style.cssText = nameStyle;
  name.append(...nameParts);
  el.append(name, value);
  return el;
}

function text(t: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.textContent = t;
  return s;
}

const WINDOW_HINT =
  "Which stretch of this input, from nothing up to its own peak, moves the setting: under Min it reads 0, over Max it reads full, so Min 0 and Max 1 pass it through as it is. The peak is learned from the music, so the window holds from one song to the next.";
const SMOOTHNESS_HINT =
  "How gently this wire moves. With Window on, left is exactly at Min and Max and right is a softer rise toward nothing and toward the peak, while silence still gives nothing and the peak still gives full. With Window off, right makes the wire slow to follow its input, up and down alike.";
const LENGTH_HINT = "How long this wire takes to fall after each rise. Off: it falls as fast as the input does.";
const INVERT_HINT = "Turns this wire upside down: the setting is full when the input is quiet and falls as it rises, so a hit dips instead of flashing.";

export function createWireModControls(opts: WireModControlsOpts): WireModControls {
  const { label, accent } = opts;
  const mod: WireMod = { ...opts.mod };
  const changed = (): void => opts.onChange({ ...mod });

  const el = document.createElement("div");
  el.style.cssText = wrapStyle;

  const canvas = document.createElement("canvas");
  canvas.style.cssText = canvasStyle;
  canvas.title = "Faint: what comes in. White: what this wire sends on. Dashed: the window.";
  const ctx = canvas.getContext("2d")!;
  const sizer = createCanvasSizer(canvas, ctx, { heightCssPx: GRAPH_CSS_PX });
  const inRing = new Float32Array(RING_LEN);
  const outRing = new Float32Array(RING_LEN);
  const lineRing = new Float32Array(RING_LEN);
  const topRing = new Float32Array(RING_LEN);
  let ringHead = 0;

  // Window: a switch, the "Min – Max" value, then a Min and a Max slider that
  // keep Min ≤ Max by dragging the other one along.
  const windowValue = document.createElement("output");
  windowValue.style.cssText = valueStyle;
  const showWindow = (): void => {
    windowValue.textContent = `${mod.min.toFixed(2)} – ${mod.max.toFixed(2)}`;
  };
  showWindow();
  const minInput = slider(`${label} window min`, accent, WINDOW_HINT, 0, 1, mod.min);
  const maxInput = slider(`${label} window max`, accent, WINDOW_HINT, 0, 1, mod.max);
  const windowDimmed: HTMLElement[] = [minInput, maxInput, windowValue];
  const dim = (els: HTMLElement[], on: boolean): void => {
    for (const d of els) d.style.opacity = on ? "" : DIMMED_OPACITY;
  };
  const windowSwitch = onOffSwitch(`${label} window on/off`, accent, WINDOW_HINT, mod.windowOn, (on) => {
    mod.windowOn = on;
    dim(windowDimmed, on);
    changed();
  });
  dim(windowDimmed, mod.windowOn);
  const pair = (name: string, input: HTMLInputElement): HTMLElement => {
    const row = document.createElement("div");
    row.style.cssText = pairStyle;
    const n = document.createElement("span");
    n.style.cssText = pairNameStyle;
    n.textContent = name;
    row.append(n, input);
    return row;
  };
  minInput.addEventListener("input", () => {
    mod.min = Number(minInput.value);
    setFill(minInput, mod.min, 0, 1);
    if (mod.min > mod.max) {
      mod.max = mod.min;
      maxInput.value = String(mod.max);
      setFill(maxInput, mod.max, 0, 1);
    }
    showWindow();
    changed();
  });
  maxInput.addEventListener("input", () => {
    mod.max = Number(maxInput.value);
    setFill(maxInput, mod.max, 0, 1);
    if (mod.max < mod.min) {
      mod.min = mod.max;
      minInput.value = String(mod.min);
      setFill(minInput, mod.min, 0, 1);
    }
    showWindow();
    changed();
  });
  const windowEl = document.createElement("div");
  windowEl.style.cssText = controlStyle;
  windowEl.append(head([windowSwitch, text("Window")], windowValue), pair("Min", minInput), pair("Max", maxInput), ends("Nothing", "Its peak"));

  const smoothValue = document.createElement("output");
  smoothValue.style.cssText = valueStyle;
  smoothValue.textContent = mod.smoothness.toFixed(2);
  const smoothInput = slider(`${label} smoothness`, accent, SMOOTHNESS_HINT, 0, 1, mod.smoothness);
  const smoothDimmed: HTMLElement[] = [smoothInput, smoothValue];
  const smoothSwitch = onOffSwitch(`${label} smoothness on/off`, accent, SMOOTHNESS_HINT, mod.smoothOn, (on) => {
    mod.smoothOn = on;
    dim(smoothDimmed, on);
    changed();
  });
  dim(smoothDimmed, mod.smoothOn);
  smoothInput.addEventListener("input", () => {
    mod.smoothness = Number(smoothInput.value);
    setFill(smoothInput, mod.smoothness, 0, 1);
    smoothValue.textContent = mod.smoothness.toFixed(2);
    changed();
  });
  const smoothEl = document.createElement("div");
  smoothEl.style.cssText = controlStyle;
  smoothEl.append(head([smoothSwitch, text("Smoothness")], smoothValue), smoothInput, ends("Exact", "Soft"));

  const lengthText = (v: number): string => (v === 0 ? "Off" : `${v.toFixed(2)} s`);
  const lengthValue = document.createElement("output");
  lengthValue.style.cssText = valueStyle;
  lengthValue.textContent = lengthText(mod.length);
  const lengthInput = slider(`${label} length`, accent, LENGTH_HINT, 0, WIRE_LENGTH_MAX_SEC, mod.length);
  lengthInput.addEventListener("input", () => {
    mod.length = Number(lengthInput.value);
    setFill(lengthInput, mod.length, 0, WIRE_LENGTH_MAX_SEC);
    lengthValue.textContent = lengthText(mod.length);
    changed();
  });
  const lengthEl = document.createElement("div");
  lengthEl.style.cssText = controlStyle;
  lengthEl.append(head([text("Length")], lengthValue), lengthInput, ends("Off", "Long tail"));

  const invertSwitch = onOffSwitch(`${label} invert on/off`, accent, INVERT_HINT, mod.invert, (on) => {
    mod.invert = on;
    changed();
  });
  const invertEl = document.createElement("div");
  invertEl.style.cssText = controlStyle;
  invertEl.append(head([invertSwitch, text("Invert")], document.createElement("span")));

  el.append(canvas, windowEl, smoothEl);
  if (opts.formula) el.append(buildGateFormulaPicker(opts.formula.current, opts.formula.onPick));
  el.append(lengthEl, invertEl);

  function draw(): void {
    if (!sizer.ensure()) return;
    const w = sizer.width;
    ctx.clearRect(0, 0, w, GRAPH_CSS_PX);
    if (mod.windowOn) {
      ctx.strokeStyle = THRESHOLD_LINE;
      ctx.lineWidth = 1;
      ctx.setLineDash(THRESHOLD_DASH);
      tracePath(ctx, lineRing, ringHead, w);
      tracePath(ctx, topRing, ringHead, w);
      ctx.setLineDash(NO_DASH);
    }
    ctx.strokeStyle = INPUT_TRACE;
    ctx.lineWidth = 1.4;
    tracePath(ctx, inRing, ringHead, w);
    ctx.strokeStyle = OUTPUT_TRACE;
    ctx.lineWidth = 2;
    tracePath(ctx, outRing, ringHead, w);
  }

  return {
    el,
    update(reading, onScreen) {
      inRing[ringHead] = reading?.input ?? 0;
      // The plain wire passes its input on until a modifier acts.
      outRing[ringHead] = reading ? (wireModIsIdle(mod) ? reading.input : reading.output) : 0;
      lineRing[ringHead] = reading?.line ?? 0;
      topRing[ringHead] = reading?.top ?? 0;
      ringHead = (ringHead + 1) % RING_LEN;
      if (onScreen) draw();
    },
  };
}
