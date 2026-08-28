/**
 * Design tokens and the one stylesheet behind the controls panel
 * (src/ui/deviceMenu.ts), its spectrum strip (src/ui/spectrumStrip.ts) and
 * the round chrome buttons in index.html — the "Viz Controls" design.
 *
 * Everything else in src/ui/ styles itself with inline cssText, and most of
 * the panel still does; what can't be expressed inline lives here as class
 * rules: slider track/thumb pseudo-elements, the hover/focus-revealed row
 * hints, the boolean toggle's knob, the band faders' hit areas over the
 * spectrum canvas, the thin scroll rail, the narrow-viewport column stacking,
 * and the "active" ring on a chrome button. The accent constants are here
 * rather than in deviceMenu.ts because the spectrum strip paints the same
 * hues onto a canvas — one owner, no drifting duplicates.
 *
 * Fonts are self-hosted through Vite from their npm packages (licenses in
 * THIRD-PARTY-NOTICES.md): Chakra Petch for labels, Share Tech Mono for
 * everything caps/small, DSEG7-Classic for the seven-segment readouts. The
 * accents are the design's oklch values converted to hex, since canvas fills
 * can't take oklch().
 */

// Latin subsets only — the panel's strings are all ASCII, and the full
// entries would also bundle Thai/Vietnamese faces nothing here renders.
import "@fontsource/chakra-petch/latin-300.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/share-tech-mono/latin-400.css";
import dseg7Url from "dseg/fonts/DSEG7-Classic/DSEG7Classic-Regular.woff2?url";

/** Mic input gain — Sensitivity/Acceleration/Smoothing and the live level wash. */
export const INPUT_GREEN = "#8ce6a0";
/** This scene's own look — its declared settings. */
export const SCENE_VIOLET = "#c3a5f9";
/** The band fader bank — how hard each part of the spectrum drives the visuals. */
export const BANDS_AMBER = "#f9b96c";
/** A fader that's been pulled all the way down to Off (spectrumStrip.ts, bandFaders.ts). */
export const FADER_OFF = "#f08a8a";
/** The global auto system — strength knob and master switch. */
export const AUTO_SKY = "#59bbfb";

/** Spectrum strip bar tints, one step darker than the card accents they echo. */
export const STRIP_LOW = "#89e29d";
export const STRIP_MID = "#c0a2f5";
export const STRIP_HIGH = "#f6b15b";
/** The "audio is flowing" dot in the spectrum card header. */
export const LIVE_DOT = "#83dc97";
/** Rule under the spectrum card header. */
export const HAIRLINE = "#efb062";
/** The warning ramp: the Input card's level wash as it nears clipping, and
 *  the meters' clip/drop flashes (src/ui/audioMeters.ts). yellow-500 / red-500. */
export const HOT_YELLOW = "#eab308";
export const HOT_RED = "#ef4444";

export const FONT_LABEL = "'Chakra Petch', system-ui, sans-serif";
export const FONT_MONO = "'Share Tech Mono', ui-monospace, monospace";
export const FONT_DIGITS = `'DSEG7-Classic', ${FONT_MONO}`;

/** Below this viewport width the two panel columns stack into one. */
export const STACK_BELOW_PX = 720;

/** `#rrggbb` + alpha in [0,1] -> `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

// Glass that darkens and desaturates whatever scene is behind it, so text
// holds its contrast over bright caustics without an opaque backdrop.
export const GLASS_FILTER = "blur(20px) saturate(.6) brightness(.5) contrast(1.08)";
export const glassCardStyle = `
  position: relative; overflow: hidden;
  background: rgba(8, 11, 10, 0.2);
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
  border: 1px solid rgba(255, 255, 255, 0.13); border-top-color: rgba(255, 255, 255, 0.22);
  border-radius: 3px;
`;
/** Faint horizontal scanlines laid over a card — purely decorative. */
export const scanlineStyle = `
  position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.014) 0 1px, transparent 1px 3px);
`;

const STYLE_ID = "vc-controls-styles";

const stylesheet = `
@font-face {
  font-family: 'DSEG7-Classic';
  src: url(${dseg7Url}) format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}

/* Anchored top-right; the columns stop short of the bottom-right chrome
 * buttons (index.html) so the gear that closes the panel stays reachable. */
.vc-root {
  position: fixed; top: 16px; right: 16px; z-index: 30;
  display: none; gap: 4px; align-items: flex-start;
  max-height: calc(100vh - 74px);
  color: #fff; font-family: ${FONT_LABEL};
}
.vc-root.vc-open { display: flex; }
/* The spectrum card stays put; the meters (src/ui/audioMeters.ts) scroll
 * in their own strip beneath it, the way the controls column scrolls. */
.vc-spectrum-col {
  width: 377px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 74px);
}
.vc-spectrum-col > * { flex-shrink: 0; }
.vc-spectrum-col > .vc-meters { flex-shrink: 1; min-height: 0; overflow-y: auto; }
.vc-meters { display: flex; flex-direction: column; gap: 4px; }
.vc-meters > * { flex-shrink: 0; }
.vc-controls-col {
  width: 314px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 74px); overflow-y: auto;
}
/* Cards scroll past the column's edge rather than squashing to fit it. */
.vc-controls-col > * { flex-shrink: 0; }
@media (max-width: ${STACK_BELOW_PX}px) {
  .vc-root { flex-direction: column; width: min(320px, 88vw); overflow-y: auto; }
  .vc-root > *, .vc-spectrum-col > * { flex-shrink: 0; }
  /* Dissolve the spectrum column so its card and the meters become root
   * items in their own right: spectrum, then the controls, then the meters
   * last — a phone shouldn't have to scroll past a screen of readouts to
   * reach a slider. */
  .vc-spectrum-col { display: contents; }
  .vc-spectrum-card, .vc-controls-col { width: 100%; max-height: none; overflow: visible; }
  .vc-spectrum-col > .vc-meters { width: 100%; order: 1; max-height: none; overflow: visible; }
}

.vc-scroll { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.25) transparent; }
.vc-scroll::-webkit-scrollbar { width: 4px; }
.vc-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.22); border-radius: 2px; }
.vc-scroll::-webkit-scrollbar-track { background: transparent; }

/* The digit badge on a keyboard block heading (a card title or a scene group
 * heading — see deviceMenu.ts's markBlock/renumberBlocks). Reads as an index,
 * not part of the title, so it's dimmer and set apart with a little trailing
 * space rather than inline with the letters. Text filled in by JS. */
.vc-block-n {
  display: inline-block; min-width: 1.1em; margin-right: 0.6em;
  color: rgba(255, 255, 255, 0.32); font-variant-numeric: tabular-nums;
}

/* A row "wakes" when the pointer is anywhere over it (the row is a far
 * bigger target than its 3px track) or its control has focus: the label
 * tints toward the row's accent, the track glows through a hairline border,
 * and the slider zooms up so the thumb is easy to grab precisely. On top of
 * that flat zoom, --vc-thumb-boost multiplies in a little extra as the
 * pointer nears the thumb specifically — set by deviceMenu.ts's
 * wireThumbMagnet, unset (falls back to 1) everywhere else. */
/* The row frames itself with padding that negative margins cancel out, so
 * the ring + glow around the whole title-and-slider block costs no layout. */
.vc-row {
  position: relative; --vc-accent: #fff;
  padding: 6px 8px; margin: -6px -8px; border-radius: 4px;
  box-shadow: 0 0 0 1px transparent;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}
/* A meter row (audioMeters.ts) has no control to focus, so the row itself
 * is focusable — a tap unfolds its hint the way tapping a slider does. The
 * hover/focus ring below is the focus indicator; no second outline. */
.vc-row[tabindex]:focus { outline: none; }
.vc-row:hover, .vc-row:focus-within {
  background-color: color-mix(in srgb, var(--vc-accent) 6%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent),
    0 0 14px color-mix(in srgb, var(--vc-accent) 22%, transparent);
}
.vc-label { color: #fff; transition: color 0.18s ease, text-shadow 0.18s ease; }
.vc-row:hover .vc-label, .vc-row:focus-within .vc-label {
  color: var(--vc-accent);
  text-shadow: 0 0 10px color-mix(in srgb, var(--vc-accent) 35%, transparent);
}
.vc-hint {
  max-height: 0; opacity: 0; overflow: hidden; margin-top: 0;
  transition: max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
  font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.65);
}
.vc-row:hover .vc-hint, .vc-row:focus-within .vc-hint { max-height: 48px; opacity: 1; margin-top: 5px; }

/* The whole input is the touch target (taller than the 3px track it draws).
 * The accent comes from the enclosing .vc-row. */
.vc-slider {
  -webkit-appearance: none; appearance: none;
  display: block; width: 100%; height: 22px; margin: 2px 0 0; padding: 0;
  background: transparent; cursor: pointer; touch-action: pan-y;
  --vc-fill: 0%;
  transform-origin: 50% 50%;
  transition: transform 0.18s ease;
}
.vc-slider:focus { outline: none; }
.vc-row:hover .vc-slider, .vc-row:focus-within .vc-slider { transform: scale(1.015, 1.6); }
.vc-slider::-webkit-slider-runnable-track {
  height: 3px; border-radius: 2px;
  background: linear-gradient(var(--vc-accent), var(--vc-accent)) no-repeat 0 0 / var(--vc-fill) 100%, rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 0 0 transparent;
  transition: box-shadow 0.18s ease;
}
.vc-row:hover .vc-slider::-webkit-slider-runnable-track,
.vc-row:focus-within .vc-slider::-webkit-slider-runnable-track {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent),
    0 0 8px color-mix(in srgb, var(--vc-accent) 30%, transparent);
}
.vc-slider::-webkit-slider-thumb {
  -webkit-appearance: none; width: 3px; height: 11px; margin-top: -4px;
  border: none; border-radius: 2px; background: #fff;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.vc-row:hover .vc-slider::-webkit-slider-thumb,
.vc-row:focus-within .vc-slider::-webkit-slider-thumb {
  transform: scaleX(calc(1.7 * var(--vc-thumb-boost, 1)));
  box-shadow: 0 0 6px color-mix(in srgb, var(--vc-accent) 60%, transparent);
}
.vc-slider::-moz-range-track {
  height: 3px; border-radius: 2px; background: rgba(255, 255, 255, 0.18);
  transition: box-shadow 0.18s ease;
}
.vc-row:hover .vc-slider::-moz-range-track,
.vc-row:focus-within .vc-slider::-moz-range-track {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent),
    0 0 8px color-mix(in srgb, var(--vc-accent) 30%, transparent);
}
.vc-slider::-moz-range-progress { height: 3px; border-radius: 2px; background: var(--vc-accent); }
.vc-slider::-moz-range-thumb {
  width: 3px; height: 11px; border: none; border-radius: 2px; background: #fff;
  transition: transform 0.18s ease;
}
.vc-row:hover .vc-slider::-moz-range-thumb,
.vc-row:focus-within .vc-slider::-moz-range-thumb { transform: scaleX(calc(1.7 * var(--vc-thumb-boost, 1))); }

/* A band fader's hit area (bandFaders.ts): an invisible column over the
 * spectrum canvas, which draws the fader itself. touch-action: none is the
 * opposite of the slider's pan-y on purpose — a vertical drag here moves the
 * fader, it must never scroll the stacked panel. The focus ring is inset so
 * it stays inside the card's overflow: hidden. */
.vc-fader {
  position: absolute; top: 0; touch-action: none; cursor: ns-resize;
  outline: none; border-radius: 3px;
}
.vc-fader:focus-visible {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-accent) 70%, transparent);
}

.vc-toggle {
  position: relative; width: 28px; height: 14px; margin: 6px 0 0 auto; padding: 0;
  border: none; border-radius: 7px; background: rgba(255, 255, 255, 0.18);
  cursor: pointer; display: block; transition: background 0.15s ease, box-shadow 0.18s ease;
}
.vc-row:hover .vc-toggle, .vc-row:focus-within .vc-toggle {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent);
}
.vc-toggle::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 10px; height: 10px;
  border-radius: 50%; background: #fff; transition: transform 0.15s ease, background 0.15s ease;
}
.vc-toggle[aria-checked="true"] { background: var(--vc-accent); }
.vc-toggle[aria-checked="true"]::after { transform: translateX(14px); background: #070a09; }

/* Chrome buttons (index.html) ring while their thing is active: the gear
 * while this panel is open, fullscreen while immersed. */
.iconBtn[aria-pressed="true"] { border-color: rgba(255, 255, 255, 0.5); color: #fff; }
`;

/** Installs the panel's stylesheet once; safe to call from every creator. */
export function ensureControlsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}
