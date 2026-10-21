/**
 * The mixer half of the desk (issue #622, plans/controls-first.md "#622
 * Strips"). One channel strip per reactive setting of the scene: its number and
 * name, the input it is wired to, a vertical fader for its value on NEXT, a red
 * mark where LIVE's value is, a thin meter of its live reading, and four
 * buttons. M mutes its reaction on NEXT (driveMute.ts), S solos it on NEXT
 * (driveSolo.ts), ▸ sends only this setting to the output, and LIVE rides: the
 * fader moves the output directly. Every control edits NEXT except LIVE (ride)
 * and ▸, which write to the output. Master Scale and Expansion sit beside the
 * strips as two more faders; the Play list sends those.
 *
 * The strips are rebuilt only when the scene or its list of settings changes.
 * In between, tick() updates values, marks and classes in place, so a control
 * under the pointer is never replaced mid-drag.
 */
import { clearDriveSolo, getDriveSolo, setDriveSolo } from "../../render/driveSolo.ts";
import { isDriveMuted, toggleDriveMute } from "../../render/driveMute.ts";
import type { SceneSetting } from "../../render/sceneSettings.ts";

/** How many channel strips the desk shows: the scene's first settings that have a drive and are not advanced. app.ts applies both filters. */
export const DESK_STRIPS_MAX = 6;

/** Fader step for Master Scale and Expansion (their dials do not name one). */
const DIAL_STEP = 0.01;

/** While a riding fader is dragged, the output is sent at most this often, plus once on release. */
const RIDE_SEND_MS = 33;

export interface StripsDeps {
  sceneId(): string;
  /** The scene's settings that get a strip: up to six with a `drive`, not `advanced`. */
  settings(): readonly SceneSetting[];
  value(spec: SceneSetting): number;
  setValue(spec: SceneSetting, v: number): void;
  /** LIVE's stored value for this setting, null while no output is open. */
  liveValue(spec: SceneSetting): number | null;
  /** The setting's live reading this tick, 0..1-ish; null when unknown. */
  reading(spec: SceneSetting): number | null;
  inputName(spec: SceneSetting): string;
  inputColor(spec: SceneSetting): string;
  /** Sends only this setting to the output, landing over glideMs. */
  sendOne(spec: SceneSetting, glideMs: number): void;
  landMs(): number;
  master: { get(): number; set(v: number): void; live(): number | null; min: number; max: number };
  expansion: { get(): number; set(v: number): void; live(): number | null; min: number; max: number };
  /** Called once a drag ends (the panel's own rows then refresh). */
  committed(): void;
}

interface Range {
  min: number;
  max: number;
  step: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function clampTo(v: number, r: Range): number {
  return Math.min(r.max, Math.max(r.min, v));
}

/** `v` snapped to the range's step, so a drag lands on the same values the panel's slider does. */
function snapTo(v: number, r: Range): number {
  if (!(r.step > 0)) return clampTo(v, r);
  const n = r.min + Math.round((v - r.min) / r.step) * r.step;
  return clampTo(Number(n.toFixed(6)), r);
}

/** Where `v` sits on the track, 0 at the bottom. */
function fraction(v: number, r: Range): number {
  return r.max === r.min ? 0 : clamp01((v - r.min) / (r.max - r.min));
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

interface Fader {
  el: HTMLElement;
  /** Puts the thumb at `v` (and remembers it for the arrow keys). */
  show(v: number): void;
  /** LIVE's value as the red mark; null hides it. */
  mark(v: number | null): void;
}

/** A vertical fader. `onMove` runs on every pointer move and arrow key with the snapped value; `onRelease` once the drag ends. */
function fader(r: Range, label: string, onMove: (v: number) => void, onRelease: () => void): Fader {
  const track = el("div", "desk-track");
  track.tabIndex = 0;
  track.setAttribute("role", "slider");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", String(r.min));
  track.setAttribute("aria-valuemax", String(r.max));
  const mark = el("div", "desk-live-mark");
  const thumb = el("div", "desk-thumb");
  track.append(mark, thumb);

  let shown = r.min;
  let pointer = -1;

  const at = (v: number): string => `${(fraction(v, r) * 100).toFixed(2)}%`;

  function show(v: number): void {
    shown = v;
    thumb.style.bottom = at(v);
    track.setAttribute("aria-valuenow", String(v));
  }

  function move(v: number): void {
    show(v);
    onMove(v);
  }

  function valueAt(clientY: number): number {
    const rect = track.getBoundingClientRect();
    const f = rect.height > 0 ? clamp01(1 - (clientY - rect.top) / rect.height) : 0;
    return snapTo(r.min + f * (r.max - r.min), r);
  }

  track.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pointer = e.pointerId;
    track.setPointerCapture(e.pointerId);
    move(valueAt(e.clientY));
  });
  track.addEventListener("pointermove", (e) => {
    if (e.pointerId === pointer) move(valueAt(e.clientY));
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== pointer) return;
    pointer = -1;
    onRelease();
  };
  track.addEventListener("pointerup", release);
  track.addEventListener("pointercancel", release);
  track.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    move(snapTo(shown + (e.key === "ArrowUp" ? r.step : -r.step), r));
    onRelease();
  });

  return {
    el: track,
    show,
    mark(v) {
      mark.style.display = v === null ? "none" : "";
      if (v !== null) mark.style.bottom = at(clampTo(v, r));
    },
  };
}

interface Chips {
  el: HTMLElement;
  show(index: number): void;
  mark(index: number | null): void;
}

/** One chip per option, stacked: a boolean's Off/On, an enum's names. */
function chips(options: readonly string[], onPick: (index: number) => void): Chips {
  const box = el("div", "desk-chips");
  const buttons = options.map((name, i) => {
    const b = el("button", "desk-opt", name);
    b.type = "button";
    b.addEventListener("click", () => onPick(i));
    box.appendChild(b);
    return b;
  });
  return {
    el: box,
    show(index) {
      buttons.forEach((b, i) => b.classList.toggle("on", i === index));
    },
    mark(index) {
      buttons.forEach((b, i) => b.classList.toggle("live", i === index));
    },
  };
}

interface Strip {
  key: string;
  /** The latest spec object for this key (refreshed each tick). */
  spec: SceneSetting;
  el: HTMLElement;
  tag: HTMLElement;
  input: HTMLElement;
  dot: HTMLElement;
  valueText: HTMLElement;
  meter: HTMLElement;
  fader: Fader | null;
  chips: Chips | null;
  btnM: HTMLButtonElement;
  btnS: HTMLButtonElement;
  btnSend: HTMLButtonElement;
  btnRide: HTMLButtonElement;
  riding: boolean;
  lastSendMs: number;
}

function valueWords(spec: SceneSetting, v: number): string {
  if (spec.type === "boolean") return v >= 0.5 ? "On" : "Off";
  if (spec.type === "enum") return spec.options?.[Math.round(v)] ?? String(Math.round(v));
  return v.toFixed(2);
}

function btn(text: string, title: string): HTMLButtonElement {
  const b = el("button", "desk-strip-btn", text);
  b.type = "button";
  b.title = title;
  return b;
}

export function createStrips(deps: StripsDeps): { el: HTMLElement; tick(nowMs: number): void; highlight(key: string | null): void } {
  const row = el("div", "desk-mixer-row");
  const stripsRow = el("div", "desk-strips");
  const masterRow = el("div", "desk-master");
  row.append(stripsRow, masterRow);

  let strips: Strip[] = [];
  let builtScene: string | null = null;
  let builtKeys = "";

  function makeStrip(index: number, spec: SceneSetting): Strip {
    const node = el("div", "desk-strip");
    const head = el("div", "desk-strip-head");
    head.append(el("span", "desk-strip-num", String(index + 1)), el("span", "desk-strip-name", spec.label));
    const tag = el("span", "desk-strip-tag");
    const input = el("span", "desk-strip-input");
    const dot = el("i", "desk-dot");
    input.append(dot, document.createTextNode(""));
    const valueText = el("div", "desk-strip-val");
    const meter = el("div", "desk-meter-fill");
    const meterBox = el("div", "desk-meter");
    meterBox.appendChild(meter);
    const body = el("div", "desk-strip-body");

    const strip: Strip = {
      key: spec.key,
      spec,
      el: node,
      tag,
      input,
      dot,
      valueText,
      meter,
      fader: null,
      chips: null,
      btnM: btn("M", "Mute: this setting's reaction stops on NEXT only"),
      btnS: btn("S", "Solo: only this setting reacts on NEXT"),
      btnSend: btn("▸", "Send only this setting to the output"),
      btnRide: btn("LIVE", "Ride: the fader moves the output directly"),
      riding: false,
      lastSendMs: -Infinity,
    };

    const onMove = (v: number): void => {
      deps.setValue(strip.spec, v);
      if (!strip.riding) return;
      const now = performance.now();
      if (now - strip.lastSendMs < RIDE_SEND_MS) return;
      strip.lastSendMs = now;
      deps.sendOne(strip.spec, 0);
    };
    const onRelease = (): void => {
      if (strip.riding) deps.sendOne(strip.spec, 0);
      deps.committed();
    };

    if (spec.type === "boolean" || spec.type === "enum") {
      const options = spec.type === "boolean" ? ["Off", "On"] : (spec.options ?? []);
      const c = chips(options, (i) => {
        deps.setValue(strip.spec, i);
        if (strip.riding) deps.sendOne(strip.spec, 0);
        deps.committed();
      });
      strip.chips = c;
      body.appendChild(c.el);
    } else {
      const f = fader({ min: spec.min, max: spec.max, step: spec.step }, spec.label, onMove, onRelease);
      strip.fader = f;
      body.appendChild(f.el);
    }
    body.appendChild(meterBox);

    const buttons = el("div", "desk-strip-btns");
    buttons.append(strip.btnM, strip.btnS, strip.btnSend, strip.btnRide);
    strip.btnM.addEventListener("click", () => toggleDriveMute(deps.sceneId(), strip.key));
    strip.btnS.addEventListener("click", () => {
      const id = deps.sceneId();
      const solo = getDriveSolo();
      if (solo && solo.sceneId === id && solo.key === strip.key) clearDriveSolo();
      else setDriveSolo(id, strip.key);
    });
    strip.btnSend.addEventListener("click", () => deps.sendOne(strip.spec, deps.landMs()));
    strip.btnRide.addEventListener("click", () => {
      if (strip.riding) {
        strip.riding = false;
      } else {
        const live = deps.liveValue(strip.spec);
        if (live === null) return;
        deps.setValue(strip.spec, live);
        strip.riding = true;
        deps.committed();
      }
      update(strip);
    });

    node.append(head, tag, input, body, valueText, buttons);
    return strip;
  }

  /** Writes one strip's values, marks and classes from the current state. The fader shows NEXT, which a drag has just set, so it stays under the pointer. */
  function update(s: Strip): void {
    const spec = s.spec;
    const v = deps.value(spec);
    const live = deps.liveValue(spec);
    if (live === null) s.riding = false;
    const riding = s.riding;
    if (s.fader) {
      s.fader.show(v);
      s.fader.mark(live);
    } else if (s.chips) {
      s.chips.show(Math.round(v));
      s.chips.mark(live === null ? null : Math.round(live));
    }
    const differs = !riding && live !== null && Math.abs(live - v) > 1e-6;
    s.el.classList.toggle("differs", differs);
    s.el.classList.toggle("is-live", riding);
    setText(s.tag, riding ? "LIVE" : differs ? "NOT SENT" : "");
    setText(s.valueText, valueWords(spec, v));
    const reading = deps.reading(spec);
    s.meter.style.height = `${(reading === null ? 0 : clamp01(reading)) * 100}%`;
    const name = deps.inputName(spec);
    const textNode = s.input.lastChild;
    if (textNode && textNode.textContent !== name) textNode.textContent = name;
    s.dot.style.background = deps.inputColor(spec);
    const id = deps.sceneId();
    s.btnM.classList.toggle("on", isDriveMuted(id, s.key));
    const solo = getDriveSolo();
    s.btnS.classList.toggle("on", !!solo && solo.sceneId === id && solo.key === s.key);
    s.btnRide.classList.toggle("on", riding);
    s.btnRide.disabled = live === null;
    s.btnSend.disabled = live === null;
  }

  function rebuild(sceneId: string, specs: readonly SceneSetting[]): void {
    strips = specs.map((spec, i) => makeStrip(i, spec));
    stripsRow.replaceChildren(...strips.map((s) => s.el));
    builtScene = sceneId;
    builtKeys = specs.map((s) => s.key).join("|");
  }

  // Master Scale and Expansion: two dials with no M/S/▸ (the Play list sends them).
  function dial(label: string, d: StripsDeps["master"]): { show(): void } {
    const col = el("div", "desk-dial");
    const name = el("div", "desk-dial-name", label);
    const f = fader({ min: d.min, max: d.max, step: DIAL_STEP }, label, (v) => d.set(v), () => deps.committed());
    const val = el("div", "desk-strip-val");
    col.append(name, f.el, val);
    masterRow.appendChild(col);
    return {
      show() {
        const v = d.get();
        f.show(v);
        f.mark(d.live());
        setText(val, v.toFixed(2));
      },
    };
  }
  const scaleDial = dial("Scale", deps.master);
  const expansionDial = dial("Expansion", deps.expansion);

  return {
    el: row,
    tick(_nowMs) {
      const sceneId = deps.sceneId();
      const specs = deps.settings();
      const keys = specs.map((s) => s.key).join("|");
      if (sceneId !== builtScene || keys !== builtKeys) rebuild(sceneId, specs);
      else specs.forEach((spec, i) => (strips[i]!.spec = spec));
      for (const s of strips) update(s);
      scaleDial.show();
      expansionDial.show();
    },
    highlight(key) {
      for (const s of strips) s.el.classList.toggle("hl", key !== null && s.key === key);
    },
  };
}
