/**
 * The Sidecar (issue #626, plans/controls-first.md): a small window of the
 * desk's controls for when the DJ's own software is in front. It shows LIVE,
 * PREV and NEXT through the Set, the held effects as pads, Autopilot,
 * Expansion and a health line, and it has a tall STRIP and a short MINI size.
 *
 * Document Picture-in-Picture is used where the browser has it, because only
 * that window floats above other apps. The browser opens it only from a click,
 * allows one per tab, and lets the person place it; it closes when this tab
 * navigates away. Where it is missing, a narrow popup stands in: a normal
 * window that does not float.
 *
 * LIVE is a drawImage copy of the desk's own LIVE canvas (liveMonitor.ts): no
 * second render of the scene and no GPU readback. The pads and keys call the
 * main window's effect controls through `hold` (effectControls.ts), so an
 * effect held here is the same effect as one held there. The window's keys work
 * only while it has focus, because they are its own document's events.
 */
import { EFFECTS, effectForCode, type EffectId, type HeldEffects } from "../../render/heldEffects.ts";
import type { AutopilotConfig } from "../../render/sceneSet.ts";
import { FONT_LABEL, FONT_MONO } from "../controlsTheme.ts";

export interface SidecarDeps {
  /** The desk's LIVE canvas (liveMonitor.ts). */
  liveCanvas(): HTMLCanvasElement | null;
  liveName(): string;
  prev(): void;
  next(): void;
  holdEffect(id: EffectId, on: boolean): void;
  effectsOn(): HeldEffects;
  autopilot(): AutopilotConfig;
  setAutopilot(change: Partial<AutopilotConfig>): void;
  expansion: { get(): number; set(v: number): void; live(): number | null; min: number; max: number };
  health(): { inputOk: boolean; bpm: string; fps: string };
}

export interface Sidecar {
  open(): Promise<void>;
  close(): void;
  isOpen(): boolean;
  tick(nowMs: number): void;
}

/** Document Picture-in-Picture's entry point; the DOM typings do not declare it. */
interface DocumentPip {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}

const STRIP_W = 300;
const STRIP_H = 640;
const MINI_W = 300;
const MINI_H = 340;
/** LIVE's backing store; the CSS scales it to the window's width. */
const LIVE_PX_W = 600;
const LIVE_PX_H = Math.round((LIVE_PX_W * 9) / 16);
const LIVE_COPY_MS = 1000 / 30;
const TEXT_MS = 250;
const HEALTH_MS = 500;
/** Matches the step of the desk's dial faders (strips.ts). */
const EXPANSION_STEP = 0.01;
/** The slider thumb's width in CSS; the red mark is inset by half of it so it sits on the thumb's centre. */
const THUMB_PX = 12;

const CSS = `
html, body { margin: 0; height: 100%; background: #070908; color: #e9eee9; overflow: hidden; }
body { box-sizing: border-box; padding: 8px; display: flex; flex-direction: column; gap: 8px; font: 11px ${FONT_MONO}; letter-spacing: 0.06em; }
button { font: inherit; color: #a7b0aa; background: transparent; border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 3px; padding: 4px 6px; cursor: pointer; }
button.on { color: #070908; background: #e9eee9; border-color: #e9eee9; }
.sc-live { position: relative; aspect-ratio: 16 / 9; background: #000; border: 1px solid rgba(232, 238, 234, 0.14); border-radius: 4px; overflow: hidden; }
.sc-live canvas { display: block; width: 100%; height: 100%; }
.sc-tag { position: absolute; left: 6px; top: 6px; padding: 1px 6px; border-radius: 3px; background: #ef4444; color: #fff; font: 11px ${FONT_LABEL}; letter-spacing: 0.14em; }
.sc-name { font: 12px ${FONT_LABEL}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sc-row { display: flex; gap: 6px; }
.sc-row button { flex: 1; }
.sc-pads { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.sc-pad { display: flex; flex-direction: column; align-items: flex-start; min-height: 38px; touch-action: none; user-select: none; }
.sc-pad b { font: 12px ${FONT_LABEL}; font-weight: 400; }
.sc-pad small { color: #8a958e; }
.sc-pill { width: 100%; text-align: left; }
.sc-exp-head { display: flex; justify-content: space-between; color: #a7b0aa; }
.sc-slider { position: relative; height: 22px; }
.sc-slider input { width: 100%; height: 22px; margin: 0; appearance: none; background: transparent; }
.sc-slider input::-webkit-slider-runnable-track { height: 4px; background: rgba(232, 238, 234, 0.2); border-radius: 2px; }
.sc-slider input::-webkit-slider-thumb { appearance: none; width: ${THUMB_PX}px; height: ${THUMB_PX}px; margin-top: -4px; border-radius: 50%; background: #e9eee9; }
.sc-mark { position: absolute; top: 0; bottom: 0; width: 2px; background: #ef4444; transform: translateX(-1px); pointer-events: none; }
.sc-health { display: flex; align-items: center; gap: 8px; color: #a7b0aa; }
.sc-dot { width: 8px; height: 8px; border-radius: 50%; background: #5b6660; }
.sc-dot.ok { background: #22c55e; }
body.sc-mini .sc-full { display: none; }
`;

interface Ui {
  root: HTMLElement;
  liveCanvas: HTMLCanvasElement;
  liveCtx: CanvasRenderingContext2D;
  liveName: HTMLElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  pads: { id: EffectId; el: HTMLButtonElement }[];
  pill: HTMLButtonElement;
  slider: HTMLInputElement;
  sliderValue: HTMLElement;
  mark: HTMLElement;
  dot: HTMLElement;
  bpm: HTMLElement;
  fps: HTMLElement;
  stripBtn: HTMLButtonElement;
  miniBtn: HTMLButtonElement;
}

function documentPip(): DocumentPip | null {
  return "documentPictureInPicture" in window ? (window as unknown as { documentPictureInPicture: DocumentPip }).documentPictureInPicture : null;
}

function fraction(v: number, min: number, max: number): number {
  return max === min ? 0 : Math.min(1, Math.max(0, (v - min) / (max - min)));
}

export function createSidecar(deps: SidecarDeps): Sidecar {
  let win: Window | null = null;
  let ui: Ui | null = null;
  let opening = false;
  let nextLiveMs = -Infinity;
  let nextTextMs = -Infinity;
  let nextHealthMs = -Infinity;
  let sliding = false;
  /** Effects this window holds by key and by pointer; the effect is on while either holds it. */
  const keyHeld = new Set<EffectId>();
  const pointerHeld = new Set<EffectId>();

  function holdFromSidecar(id: EffectId): void {
    deps.holdEffect(id, keyHeld.has(id) || pointerHeld.has(id));
  }

  function releaseKeys(): void {
    keyHeld.clear();
    for (const d of EFFECTS) holdFromSidecar(d.id);
  }

  function releaseHeld(): void {
    keyHeld.clear();
    pointerHeld.clear();
    for (const d of EFFECTS) deps.holdEffect(d.id, false);
  }

  function gone(): void {
    if (!win) return;
    win = null;
    ui = null;
    releaseHeld();
  }

  function setMini(on: boolean): void {
    if (!win || !ui) return;
    ui.root.classList.toggle("sc-mini", on);
    ui.stripBtn.classList.toggle("on", !on);
    ui.miniBtn.classList.toggle("on", on);
    try {
      win.resizeTo(on ? MINI_W : STRIP_W, on ? MINI_H : STRIP_H);
    } catch {
      // The browser may refuse a resize; the window keeps its size.
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      if (e.repeat) return;
      if (e.key === "ArrowLeft") deps.prev();
      else deps.next();
      return;
    }
    const d = effectForCode(e.code);
    if (!d) return;
    e.preventDefault();
    if (e.repeat) return;
    keyHeld.add(d.id);
    holdFromSidecar(d.id);
  }

  function onKeyUp(e: KeyboardEvent): void {
    // macOS sends no key-up for a key let go while Command is down, so Command's own key-up ends every key hold (effectControls.ts).
    if (e.key === "Meta") {
      releaseKeys();
      return;
    }
    const d = effectForCode(e.code);
    if (!d) return;
    keyHeld.delete(d.id);
    holdFromSidecar(d.id);
  }

  function build(doc: Document): Ui {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const style = make("style");
    style.textContent = CSS;
    doc.head.appendChild(style);
    doc.title = "Sidecar";

    const live = make("div", "sc-live");
    const liveCanvas = make("canvas");
    liveCanvas.width = LIVE_PX_W;
    liveCanvas.height = LIVE_PX_H;
    live.append(liveCanvas, make("span", "sc-tag", "LIVE"));
    const liveName = make("div", "sc-name");

    const prev = make("button", undefined, "◀ PREV");
    prev.type = "button";
    prev.addEventListener("click", () => deps.prev());
    const next = make("button", undefined, "NEXT ▶");
    next.type = "button";
    next.addEventListener("click", () => deps.next());
    const nav = make("div", "sc-row");
    nav.append(prev, next);

    const padBox = make("div", "sc-pads");
    const pads: Ui["pads"] = [];
    for (const d of EFFECTS) {
      const b = make("button", "sc-pad");
      b.type = "button";
      b.append(make("b", undefined, d.label), make("small", undefined, d.key));
      b.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        b.setPointerCapture(e.pointerId);
        pointerHeld.add(d.id);
        holdFromSidecar(d.id);
      });
      const up = (): void => {
        pointerHeld.delete(d.id);
        holdFromSidecar(d.id);
      };
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      padBox.appendChild(b);
      pads.push({ id: d.id, el: b });
    }

    const pill = make("button", "sc-pill sc-full");
    pill.type = "button";
    pill.addEventListener("click", () => deps.setAutopilot({ on: !deps.autopilot().on }));

    const ex = deps.expansion;
    const expRow = make("div", "sc-full");
    const expHead = make("div", "sc-exp-head");
    const expLabel = make("span", undefined, "EXPANSION");
    const sliderValue = make("span");
    expHead.append(expLabel, sliderValue);
    const slider = make("input");
    slider.type = "range";
    slider.min = String(ex.min);
    slider.max = String(ex.max);
    slider.step = String(EXPANSION_STEP);
    slider.addEventListener("input", () => deps.expansion.set(Number(slider.value)));
    slider.addEventListener("pointerdown", () => {
      sliding = true;
    });
    const endSlide = (): void => {
      sliding = false;
    };
    slider.addEventListener("pointerup", endSlide);
    slider.addEventListener("pointercancel", endSlide);
    slider.addEventListener("change", endSlide);
    const mark = make("div", "sc-mark");
    const track = make("div", "sc-slider");
    track.append(slider, mark);
    expRow.append(expHead, track);

    const health = make("div", "sc-health sc-full");
    const dot = make("span", "sc-dot");
    const bpm = make("span");
    const fps = make("span");
    health.append(dot, bpm, fps);

    const stripBtn = make("button", undefined, "STRIP");
    stripBtn.type = "button";
    stripBtn.addEventListener("click", () => setMini(false));
    const miniBtn = make("button", undefined, "MINI");
    miniBtn.type = "button";
    miniBtn.addEventListener("click", () => setMini(true));
    const sizes = make("div", "sc-row");
    sizes.append(stripBtn, miniBtn);

    doc.body.append(live, liveName, nav, padBox, pill, expRow, health, sizes);
    return {
      root: doc.body,
      liveCanvas,
      liveCtx: liveCanvas.getContext("2d") as CanvasRenderingContext2D,
      liveName,
      prev,
      next,
      pads,
      pill,
      slider,
      sliderValue,
      mark,
      dot,
      bpm,
      fps,
      stripBtn,
      miniBtn,
    };
  }

  function copyLive(): void {
    const src = deps.liveCanvas();
    if (!ui || !src) return;
    ui.liveCtx.drawImage(src, 0, 0, ui.liveCanvas.width, ui.liveCanvas.height);
  }

  function refreshText(): void {
    if (!ui) return;
    const name = deps.liveName();
    if (ui.liveName.textContent !== name) ui.liveName.textContent = name;
    const cfg = deps.autopilot();
    ui.pill.textContent = `AUTOPILOT · every ${cfg.everyBars} bars`;
    ui.pill.classList.toggle("on", cfg.on);
    const ex = deps.expansion;
    const v = ex.get();
    if (!sliding) ui.slider.value = String(v);
    ui.sliderValue.textContent = v.toFixed(2);
    const live = ex.live();
    ui.mark.style.display = live === null ? "none" : "block";
    if (live !== null) ui.mark.style.left = `calc(${fraction(live, ex.min, ex.max)} * (100% - ${THUMB_PX}px) + ${THUMB_PX / 2}px)`;
  }

  function refreshHealth(): void {
    if (!ui) return;
    const h = deps.health();
    ui.dot.classList.toggle("ok", h.inputOk);
    ui.bpm.textContent = h.bpm;
    ui.fps.textContent = `OUT ${h.fps} fps`;
  }

  async function open(): Promise<void> {
    if (win && !win.closed) {
      win.focus();
      return;
    }
    if (opening) return;
    gone();
    opening = true;
    let w: Window | null = null;
    try {
      // Called synchronously from the click, which the browser requires for Picture-in-Picture.
      const dpip = documentPip();
      if (dpip) {
        try {
          w = await dpip.requestWindow({ width: STRIP_W, height: STRIP_H });
        } catch {
          w = null;
        }
      }
      if (!w) w = window.open("", "svl-sidecar", `popup=yes,width=${STRIP_W},height=${STRIP_H}`);
    } finally {
      opening = false;
    }
    if (!w) return;
    win = w;
    ui = build(w.document);
    w.addEventListener("pagehide", gone);
    w.addEventListener("blur", releaseHeld);
    w.document.addEventListener("keydown", onKeyDown);
    w.document.addEventListener("keyup", onKeyUp);
    refreshText();
    refreshHealth();
  }

  function close(): void {
    const w = win;
    if (!w) return;
    gone();
    w.close();
  }

  function tick(nowMs: number): void {
    if (!win || !ui) return;
    if (win.closed) {
      gone();
      return;
    }
    if (nowMs >= nextLiveMs) {
      nextLiveMs = nowMs + LIVE_COPY_MS;
      copyLive();
    }
    const on = deps.effectsOn();
    for (const p of ui.pads) p.el.classList.toggle("on", on[p.id]);
    if (nowMs >= nextTextMs) {
      nextTextMs = nowMs + TEXT_MS;
      refreshText();
    }
    if (nowMs >= nextHealthMs) {
      nextHealthMs = nowMs + HEALTH_MS;
      refreshHealth();
    }
  }

  return {
    open,
    close,
    isOpen: () => win !== null && !win.closed,
    tick,
  };
}
