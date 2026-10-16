import { INPUT_GREEN, FONT_LABEL, FONT_MONO } from "./controlsTheme.ts";
import { chipBtnLitStyle, chipBtnStyle, createCard, createChipButton } from "./controlsKit.ts";
import type { MidiController } from "./midiInput.ts";
import { ccToValue, learnPrompt, mappingText, targetScene } from "./midiMap.ts";

/**
 * The MIDI card: connect a controller, see what is plugged in, learn knobs
 * onto sliders and pads onto keys, and the list of what is mapped. The
 * session itself (Web MIDI, the learn steps, the store) is midiInput.ts's
 * MidiController, handed in; the rules are midiMap.ts's. This file is only
 * the panel half:
 *
 *  - The card is hidden where the browser has no Web MIDI (Safari). It never
 *    asks for MIDI on load: "Connect MIDI" is the press that makes Chrome
 *    prompt.
 *  - A slider can be mapped when its row carries the `midi` field of
 *    deviceMenu.ts's ControlRowSpec, which stamps data attributes on the row
 *    and slider (data-midi-row, data-midi-id, data-midi-label, data-midi-step).
 *    While learning, a press on such a row (a press on one of its buttons
 *    still works) picks it instead of dragging it.
 *  - `applyCc` is how a mapped knob moves a slider: it sets the slider's
 *    value across its own range and fires the slider's own "input" event,
 *    which is what a hand drag does, so the setting changes through the same
 *    code. The Scene card is only rebuilt when the panel is opened, so a
 *    knob turned with the panel shut after a scene change asks for the rows
 *    of the scene now on screen first (`ensureSceneRows`).
 */

export interface MidiCardDeps {
  midi: MidiController;
  currentSceneId: () => string;
  /** Rebuild the Scene card's rows if they belong to another scene. */
  ensureSceneRows: () => void;
}

export interface MidiCard {
  el: HTMLElement;
  /** Move the slider a mapping aims at to controller value `cc` (0..127). */
  applyCc(target: string, cc: number): void;
}

const bodyStyle = `display: flex; flex-direction: column; gap: 6px;`;
const textStyle = `font: 300 13px/1.35 ${FONT_LABEL}; color: rgba(255,255,255,0.8);`;
const dimStyle = `font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.45);`;
const deviceStyle = `font: 300 13.5px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,0.85); display: flex; align-items: center; gap: 7px;`;
const mapRowStyle = `display: flex; align-items: center; gap: 4px;`;
const mapTextStyle = `flex: 1; min-width: 0; font: 400 11px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.75); overflow-wrap: anywhere;`;
const delBtnStyle = `font: 400 11px/1 ${FONT_MONO}; color: rgba(255,255,255,0.5); background: none; border: none; padding: 3px 5px; cursor: pointer; flex-shrink: 0;`;
const promptStyle = `font: 300 13px/1.35 ${FONT_LABEL}; color: ${INPUT_GREEN};`;
const lightStyle = `width: 7px; height: 7px; border-radius: 50%; background: ${INPUT_GREEN}; opacity: 0.18; flex: none; transition: opacity 0.25s ease-out;`;

export function createMidiCard(deps: MidiCardDeps): MidiCard {
  const { midi } = deps;
  const supported = midi.snapshot().supported;

  const light = document.createElement("span");
  light.style.cssText = lightStyle;
  light.title = "Blinks when the controller sends something";
  const card = createCard({ title: "MIDI", accent: INPUT_GREEN, right: light });
  card.el.dataset.midiCard = "";
  card.body.style.cssText = bodyStyle;
  if (!supported) card.el.style.display = "none";

  let lightTimer = 0;
  midi.onActivity(() => {
    light.style.transition = "none";
    light.style.opacity = "1";
    window.clearTimeout(lightTimer);
    lightTimer = window.setTimeout(() => {
      light.style.transition = "opacity 0.25s ease-out";
      light.style.opacity = "0.18";
    }, 60);
  });

  function line(text: string, style: string): HTMLElement {
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = style;
    return el;
  }

  function render(): void {
    const s = midi.snapshot();
    const learning = s.learn.step !== "idle";
    document.documentElement.classList.toggle("vc-midi-learning", learning);
    for (const row of document.querySelectorAll<HTMLElement>(".vc-midi-picked")) row.classList.remove("vc-midi-picked");
    if (s.learn.step === "cc") {
      const slider = findSlider(s.learn.target.id);
      slider?.closest<HTMLElement>("[data-midi-row]")?.classList.add("vc-midi-picked");
    }

    const parts: HTMLElement[] = [];
    if (!s.connected) {
      const btn = createChipButton(
        s.connecting ? "Connecting…" : "Connect MIDI",
        "Ask the browser for access to your MIDI controllers",
        () => void midi.connect(),
      );
      btn.style.cssText = `${chipBtnStyle} align-self: flex-start;`;
      parts.push(btn);
      parts.push(line("Map a knob or fader to a slider, or a pad to a key. The browser asks once.", dimStyle));
    } else {
      if (s.devices.length === 0) parts.push(line("No controller found. Plug one in.", textStyle));
      for (const name of s.devices) {
        const row = document.createElement("div");
        row.style.cssText = deviceStyle;
        row.textContent = name;
        parts.push(row);
      }
      const learn = createChipButton(
        learning ? "Stop learning" : "Learn",
        learning ? "Stop mapping (Escape)" : "Map a knob to a slider, or a pad to a key",
        () => midi.toggleLearn(),
      );
      learn.style.cssText = `${learning ? chipBtnLitStyle : chipBtnStyle} align-self: flex-start;`;
      parts.push(learn);
      if (learning) parts.push(line(learnPrompt(s.learn), promptStyle));
      if (s.mappings.length === 0) {
        parts.push(line("Nothing mapped yet.", dimStyle));
      } else {
        s.mappings.forEach((m, i) => {
          const row = document.createElement("div");
          row.style.cssText = mapRowStyle;
          const text = line(mappingText(m), mapTextStyle);
          const del = document.createElement("button");
          del.textContent = "✕";
          del.title = "Remove this mapping";
          del.style.cssText = delBtnStyle;
          del.addEventListener("click", () => midi.removeAt(i));
          row.append(text, del);
          parts.push(row);
        });
      }
    }
    if (s.notice) parts.push(line(s.notice, dimStyle));
    card.body.replaceChildren(...parts);
  }
  midi.subscribe(render);
  render();

  // ---- learn: touching a slider ----

  /** The mappable row under a press, unless the press landed on a button
   *  (the chips, reset and Auto keep working while learning). */
  function learnRow(e: Event): { row: HTMLElement; slider: HTMLInputElement } | null {
    if (midi.snapshot().learn.step === "idle") return null;
    const t = e.target;
    if (!(t instanceof Element) || t.closest("button")) return null;
    const row = t.closest<HTMLElement>("[data-midi-row]");
    const slider = row?.querySelector<HTMLInputElement>("[data-midi-id]");
    return row && slider ? { row, slider } : null;
  }
  document.addEventListener(
    "pointerdown",
    (e) => {
      const hit = learnRow(e);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      midi.pickTarget({ id: hit.slider.dataset.midiId ?? "", label: hit.slider.dataset.midiLabel ?? "" });
    },
    true,
  );
  // The rest of the press (the slider's own drag, the row's click-to-focus)
  // must not move or select the very thing being picked.
  for (const type of ["mousedown", "touchstart", "click"]) {
    document.addEventListener(
      type,
      (e) => {
        if (!learnRow(e)) return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
  }

  // ---- applying a knob ----

  function findSlider(id: string): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(`[data-midi-id="${CSS.escape(id)}"]`);
  }

  function applyCc(target: string, cc: number): void {
    const scene = targetScene(target);
    if (scene !== null) {
      if (scene !== deps.currentSceneId()) return;
      deps.ensureSceneRows();
    }
    const slider = findSlider(target);
    if (!slider) return;
    const step = Number(slider.dataset.midiStep);
    const value = ccToValue(cc, Number(slider.min), Number(slider.max), step > 0 ? step : undefined);
    slider.value = String(value);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  return { el: card.el, applyCc };
}
