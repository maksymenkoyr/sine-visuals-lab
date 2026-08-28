import {
  BAND_FADER_COUNT,
  BAND_GAIN_DEFAULT,
  BAND_GAIN_MAX,
  BAND_GAIN_MIN,
  FADER_DETENT,
  faderCenterHz,
  faderPosToGain,
  gainToFaderPos,
  isDefaultGains,
} from "../audio/bandGains.ts";
import { formatHz } from "../audio/bandScale.ts";
import { createSpectrumStrip, STRIP_PLOT_HEIGHT_PX, type SpectrumStrip } from "./spectrumStrip.ts";
import { BANDS_AMBER, FADER_OFF, FONT_MONO } from "./controlsTheme.ts";

/**
 * The band fader bank: the interactive half of the Bands card. Owns the
 * spectrum strip canvas (src/ui/spectrumStrip.ts, which does all the
 * drawing) and lays one invisible hit area per fader over its column of the
 * plot, plus a readout row underneath — the gain and centre frequency of
 * every fader, always visible.
 *
 * Each hit area is its own focusable `role="slider"` element, in
 * left-to-right order, so the panel's keyboard layer (deviceMenu.ts: the
 * Tab ring, digit blocks, and R/T via wireRowKeys) treats a fader exactly
 * like a slider row without knowing it's drawn on a canvas. Arrow keys,
 * Home and End are handled here since they're slider semantics rather than
 * panel hotkeys; the panel wires R/T through reset()/toggleOff().
 *
 * Travel is vertical: middle is 1× (see bandGains.ts's faderPosToGain for
 * the mapping and the centre detent), up boosts, down cuts, the bottom is
 * Off. T mutes a fader to Off and restores it on a second press; any other
 * write to that fader forgets the restore point, same contract as the rows.
 *
 * Values come in through setGains (the panel pushes the current scene's
 * store) and go out through onChange — this component holds a copy but is
 * not the source of truth, matching the rest of the panel.
 */

export interface BandFaders {
  el: HTMLElement;
  strip: SpectrumStrip;
  /** The focusable hit areas, leftmost first — the panel wires keys on these. */
  faders: HTMLElement[];
  setGains(gains: ArrayLike<number>): void;
  setEdgesHz(edges: Float32Array): void;
  isDefault(): boolean;
  /** Back to 1×. */
  reset(fader: number): void;
  /** Mute to Off / restore — see the header. */
  toggleOff(fader: number): void;
  /** Forget every restore point (a card-level Reset). */
  clearOff(): void;
}

export interface BandFadersOpts {
  onChange: (fader: number, gain: number) => void;
}

// Keyboard steps as a fraction of the travel — one nudge is small enough to
// land on a specific gain, Shift gets across the range in a few presses. A
// nudge must clear the centre detent, or stepping off 1× would snap straight
// back to it; stepping back onto the centre still lands exactly on 1×.
const KEY_STEP = FADER_DETENT * 1.2;
const KEY_STEP_LARGE = KEY_STEP * 4;

const wrapperStyle = `position: relative;`;
const readoutsStyle = `display: grid; grid-template-columns: repeat(${BAND_FADER_COUNT}, 1fr); gap: 2px 0; margin-top: 2px;`;
const gainReadoutBase = `font: 400 10px/1.2 ${FONT_MONO}; text-align: center; letter-spacing: 0.02em; font-variant-numeric: tabular-nums;`;
const gainReadoutStyle = `${gainReadoutBase} color: rgba(255,255,255,0.72);`;
const gainReadoutFlatStyle = `${gainReadoutBase} color: rgba(255,255,255,0.35);`;
const gainReadoutBoostStyle = `${gainReadoutBase} color: ${BANDS_AMBER};`;
const gainReadoutOffStyle = `${gainReadoutBase} color: ${FADER_OFF};`;
const hzReadoutStyle = `font: 400 9.5px/1.2 ${FONT_MONO}; text-align: center; color: rgba(255,255,255,0.35);`;

function formatGain(gain: number): string {
  if (gain <= BAND_GAIN_MIN) return "Off";
  return `${gain.toFixed(gain >= 2 ? 1 : 2)}×`;
}

function gainReadout(gain: number): string {
  if (gain <= BAND_GAIN_MIN) return gainReadoutOffStyle;
  if (gain === BAND_GAIN_DEFAULT) return gainReadoutFlatStyle;
  return gain > BAND_GAIN_DEFAULT ? gainReadoutBoostStyle : gainReadoutStyle;
}

export function createBandFaders(opts: BandFadersOpts): BandFaders {
  const strip = createSpectrumStrip();

  const el = document.createElement("div");
  el.style.cssText = wrapperStyle;
  el.appendChild(strip.el);

  const gains = new Float32Array(BAND_FADER_COUNT).fill(BAND_GAIN_DEFAULT);
  const offStored: (number | null)[] = Array(BAND_FADER_COUNT).fill(null);
  let edgesHz: Float32Array | null = null;

  const faders: HTMLElement[] = [];
  const gainSpans: HTMLElement[] = [];
  const hzSpans: HTMLElement[] = [];

  const readouts = document.createElement("div");
  readouts.style.cssText = readoutsStyle;

  for (let i = 0; i < BAND_FADER_COUNT; i++) {
    const hit = document.createElement("div");
    hit.className = "vc-fader";
    hit.setAttribute("role", "slider");
    hit.setAttribute("tabindex", "0");
    hit.setAttribute("aria-orientation", "vertical");
    hit.setAttribute("aria-valuemin", String(BAND_GAIN_MIN));
    hit.setAttribute("aria-valuemax", String(BAND_GAIN_MAX));
    hit.style.cssText = `left: ${(i / BAND_FADER_COUNT) * 100}%; width: ${100 / BAND_FADER_COUNT}%; height: ${STRIP_PLOT_HEIGHT_PX}px;`;
    el.appendChild(hit);
    faders.push(hit);

    const gainSpan = document.createElement("span");
    const hzSpan = document.createElement("span");
    hzSpan.style.cssText = hzReadoutStyle;
    gainSpans.push(gainSpan);
    hzSpans.push(hzSpan);
  }
  // Two rows of the same grid: gains above, frequencies below.
  readouts.append(...gainSpans, ...hzSpans);
  el.appendChild(readouts);

  function showFader(i: number): void {
    const g = gains[i];
    gainSpans[i].textContent = formatGain(g);
    gainSpans[i].style.cssText = gainReadout(g);
    faders[i].setAttribute("aria-valuenow", g.toFixed(2));
    faders[i].setAttribute("aria-valuetext", formatGain(g));
  }

  function showAll(): void {
    for (let i = 0; i < BAND_FADER_COUNT; i++) showFader(i);
    strip.setFaders(gains);
  }

  function labelFaders(): void {
    for (let i = 0; i < BAND_FADER_COUNT; i++) {
      const hz = edgesHz ? formatHz(faderCenterHz(i, edgesHz)) : "";
      hzSpans[i].textContent = hz;
      faders[i].setAttribute("aria-label", hz ? `Band ${hz}` : `Band ${i + 1}`);
    }
  }

  /** A user write: forgets the fader's restore point, pushes the value out,
   *  and redraws so the knob follows even when audio isn't ticking. */
  function commit(i: number, gain: number): void {
    offStored[i] = null;
    gains[i] = gain;
    showFader(i);
    strip.setFaders(gains);
    strip.redraw();
    opts.onChange(i, gain);
  }

  function setFromPointer(i: number, e: PointerEvent): void {
    const rect = faders[i].getBoundingClientRect();
    const pos = 1 - (e.clientY - rect.top) / rect.height;
    commit(i, faderPosToGain(pos));
  }

  faders.forEach((hit, i) => {
    let dragging = false;
    hit.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      dragging = true;
      hit.setPointerCapture(e.pointerId);
      // Focus follows the finger so R/T/arrows act on the fader just touched.
      hit.focus({ preventScroll: true });
      strip.setFocused(i);
      setFromPointer(i, e);
      e.preventDefault();
    });
    hit.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      setFromPointer(i, e);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      strip.setFocused(document.activeElement === hit ? i : -1);
      strip.redraw();
    };
    hit.addEventListener("pointerup", end);
    hit.addEventListener("pointercancel", end);

    hit.addEventListener("focus", () => {
      strip.setFocused(i);
      strip.redraw();
    });
    hit.addEventListener("blur", () => {
      if (!dragging) strip.setFocused(-1);
      strip.redraw();
    });

    hit.addEventListener("keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      let pos: number;
      switch (e.key) {
        case "ArrowUp":
          pos = gainToFaderPos(gains[i]) + step;
          break;
        case "ArrowDown":
          pos = gainToFaderPos(gains[i]) - step;
          break;
        case "Home":
          pos = 0;
          break;
        case "End":
          pos = 1;
          break;
        default:
          return;
      }
      // Stops the stacked panel (controlsTheme.ts) from scrolling on the
      // same keystroke; R/T fall through to the panel's own wiring.
      e.preventDefault();
      commit(i, faderPosToGain(Math.min(1, Math.max(0, pos))));
    });
  });

  showAll();
  labelFaders();

  return {
    el,
    strip,
    faders,
    setGains(next: ArrayLike<number>): void {
      for (let i = 0; i < BAND_FADER_COUNT; i++) gains[i] = next[i];
      showAll();
      strip.redraw();
    },
    setEdgesHz(edges: Float32Array): void {
      edgesHz = edges;
      strip.setEdgesHz(edges);
      labelFaders();
    },
    isDefault: () => isDefaultGains(gains),
    reset(i: number): void {
      commit(i, BAND_GAIN_DEFAULT);
    },
    toggleOff(i: number): void {
      const stored = offStored[i];
      if (stored !== null) {
        commit(i, stored);
      } else {
        const restore = gains[i];
        commit(i, BAND_GAIN_MIN);
        offStored[i] = restore;
      }
    },
    clearOff(): void {
      offStored.fill(null);
    },
  };
}
