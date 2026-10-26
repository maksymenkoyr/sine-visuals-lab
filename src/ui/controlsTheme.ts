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

// Latin subsets only: the full entries bundle faces nothing here renders.
import "@fontsource/chakra-petch/latin-300.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/share-tech-mono/latin-400.css";
import dseg7Url from "dseg/fonts/DSEG7-Classic/DSEG7Classic-Regular.woff2?url";
import { GLASS_PANE_CLASS } from "./glassPanes.ts";
import { GLASS_LOOK, glassFilterCss } from "./glassPref.ts";
import { HEAT_COLORS, HEAT_REFRESH_MS } from "./heat.ts";

export const INPUT_GREEN = "#8ce6a0";
export const SCENE_VIOLET = "#c3a5f9";
export const BANDS_AMBER = "#f9b96c";
/** A band fader pulled down to Off (spectrumStrip.ts, bandFaders.ts). */
export const FADER_OFF = "#f08a8a";
export const AUTO_SKY = "#59bbfb";
export const POWER_TEAL = "#4dd4c0";

/** A scene setting's `family` rows take these in place of SCENE_VIOLET, handed
 *  out in order of first appearance and wrapping (deviceMenu.ts's
 *  renderSceneSettings). Must stay clear of the card accents above and the
 *  drive-source colours (driveSources.ts): a family colour and a drive
 *  port/cable share a row and must never be mistaken for each other. */
export const FAMILY_ACCENTS = ["#8ea2ff", "#f28bd0", "#c9e26b"] as const;

/** Spectrum strip bar tints, a step darker than the card accents they echo. */
export const STRIP_LOW = "#89e29d";
export const STRIP_MID = "#c0a2f5";
export const STRIP_HIGH = "#f6b15b";
export const LIVE_DOT = "#83dc97";
/** Warning ramp: the Input level wash near clipping and the meters' clip/drop
 *  flashes (audioMeters.ts). */
export const HOT_YELLOW = "#eab308";
export const HOT_RED = "#ef4444";

export const FONT_LABEL = "'Chakra Petch', system-ui, sans-serif";
export const FONT_MONO = "'Share Tech Mono', ui-monospace, monospace";
export const FONT_DIGITS = `'DSEG7-Classic', ${FONT_MONO}`;

/** Minimum gap between the docked meters column and the docked Power+settings
 *  side, for the patch bay's cables (cableLayer.ts) to sweep through. Not a CSS
 *  margin; it only sizes STACK_BELOW_PX. */
export const CABLE_GUTTER_PX = 56;

/** Below this viewport width the panel's columns stack into one: Power + Bands
 *  + controls side by side (~899px plus gaps) plus CABLE_GUTTER_PX. */
export const STACK_BELOW_PX = 940 + CABLE_GUTTER_PX;

/** The folded Power card's side (powerCard.ts); a notch under FOLDED_BAR_PX so
 *  it reads as a button, not a card. */
export const POWER_SQUARE_PX = 26;
/** The folded Power card's width: the square's height plus room for the live
 *  status dot and FPS beside the glyph. */
export const POWER_FOLDED_W_PX = 70;
/** A folded card's title-bar height; the Auto master bar (deviceMenu.ts) matches it. */
export const FOLDED_BAR_PX = 32;
/** Right-edge room the Hits strip (audioMeters.ts) keeps free for
 *  lane jacks, so no trace runs under a jack or its usage dots. */
export const LANE_JACK_GUTTER_PX = 20;

/** `#rrggbb` + alpha in [0,1] -> `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

// Glass: both properties are CSS custom properties switched by the
// `vc-glass-blur` class on <html> (glassPref.ts, which also holds what the
// blur costs: a backdrop-filter re-processes the WebGL canvas every frame).
// Under `vc-glass-drawn` the renderer draws the blur itself, and surfaces in
// glassPanes.ts's GLASS_PANE_CLASS drop their backdrop-filter.
// Every glass surface takes both inline, so the switch is one class toggle.
export const GLASS_BG = "var(--vc-glass-bg)";
export const GLASS_FILTER = "var(--vc-glass-filter)";
export const glassCardStyle = `
  position: relative; overflow: hidden;
  background: ${GLASS_BG};
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
  border: 1px solid rgba(255, 255, 255, 0.13); border-top-color: rgba(255, 255, 255, 0.22);
  border-radius: 3px;
`;
export const scanlineStyle = `
  position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(to bottom, rgba(255, 255, 255, 0.014) 0 1px, transparent 1px 3px);
`;

const STYLE_ID = "vc-controls-styles";

const stylesheet = `
/* The screen height every panel column is sized from. A plain 100vh is Safari's
 * taller, toolbar-hidden height, so on iPad/iPhone a column ran past the visible
 * bottom, over the gear that closes the panel. 100dvh follows the toolbar. */
:root {
  --vc-vh: 100vh;
  --vc-glass-bg: rgba(8, 11, 10, 0.77);
  --vc-glass-filter: none;
}
@supports (height: 100dvh) {
  :root { --vc-vh: 100dvh; }
}
:root.vc-glass-blur {
  --vc-glass-bg: rgba(8, 11, 10, 0.2);
  --vc-glass-filter: ${glassFilterCss(GLASS_LOOK)};
}
/* !important beats the surface's inline backdrop-filter. */
:root.vc-glass-drawn .${GLASS_PANE_CLASS} {
  -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
}
@font-face {
  font-family: 'DSEG7-Classic';
  src: url(${dseg7Url}) format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}

/* Anchored top-right: Power (.vc-power-col) then the settings column. The meters
 * side (.vc-spectrum-col) is a DOM child of .vc-cols-wrap (so deviceMenu.ts's
 * onDocPointerDown root.contains(target) still sees it as "inside the panel") but
 * docks to the top-left corner in the wide layout. Both sides stop short of the
 * bottom-right chrome buttons (index.html) so the gear stays reachable, which
 * holds only while heights come from --vc-vh, not 100vh.
 *
 * pointer-events: none plus "> *" restoring auto: the row's box is as tall as its
 * tallest child, so beside a folded (short) side it would cover a gap that counts
 * as "inside" for onDocPointerDown and swallow a click meant for the scene.
 * Same for .vc-cols-wrap. */
.vc-root {
  position: fixed; top: 16px; right: 16px; z-index: 30;
  display: none; gap: 4px; align-items: flex-start;
  max-height: calc(var(--vc-vh) - 74px);
  color: #fff; font-family: ${FONT_LABEL};
  pointer-events: none;
}
.vc-root.vc-open { display: flex; }
.vc-root > * { pointer-events: auto; }
/* Power (powerCard.ts). Folded, the wide-layout media query below shrinks the
 * card to a POWER_FOLDED_W_PX by POWER_SQUARE_PX strip and the column hugs it (width: auto there). */
.vc-power-col {
  width: 200px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(var(--vc-vh) - 74px);
}
.vc-power-col > * { flex-shrink: 0; }
/* Shown only while the card is folded in the wide layout; stacked, Power folds to
 * a title bar like every card. */
.vc-power-square { display: none; }
/* The meters side. Wide layout: docks to the top-left corner independently of
 * .vc-root (see its comment for why onDocPointerDown stays safe). The stacked
 * media query dissolves it with display: contents, which also voids position:
 * fixed. The bands block (.vc-spectrum-card) stays put; the meters
 * (audioMeters.ts) scroll beneath it. The top clears index.html's #sceneNav chip
 * row, which shares this corner. */
.vc-spectrum-col {
  width: 377px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(var(--vc-vh) - 76px);
  position: fixed; top: 60px; left: 16px; z-index: 30;
}
.vc-spectrum-col > * { flex-shrink: 0; }
.vc-spectrum-col > .vc-meters { flex-shrink: 1; min-height: 0; overflow-y: auto; }
.vc-meters { display: flex; flex-direction: column; gap: 4px; }
.vc-meters > * { flex-shrink: 0; }
.vc-controls-col {
  width: 314px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(var(--vc-vh) - 74px); overflow-y: auto;
}
/* Solo (deviceMenu.ts setSolo/applySolo), wide layout only: what's left sits at
 * the bottom above the footer. An auto top margin, not justify-content: flex-end,
 * which would make an overflowing pane's top unreachable by scrolling. */
@media (min-width: ${STACK_BELOW_PX + 1}px) {
  .vc-root.vc-solo .vc-controls-col { height: calc(var(--vc-vh) - 74px); }
  .vc-root.vc-solo .vc-controls-col > :not(.vc-solo-hidden):not(.vc-dock) { margin-top: auto; }
}
/* Cards scroll past the column's edge rather than squashing to fit it. */
.vc-controls-col > * { flex-shrink: 0; }
/* Patch focus (refreshChain, patchChain.ts): while a chain is lit, the items on it glow.
 * Nothing off it dims: a faded row read as switched off. */
.vc-root.vc-chain-on .vc-chain-lit:not(:hover):not(:focus-within) {
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent, #fff) 35%, transparent),
    0 0 18px color-mix(in srgb, var(--vc-accent, #fff) 28%, transparent);
}
/* Power folds to a small square, wide layout only (powerCard.ts's header says why:
 * the card's content stays laid out at full width so it is clipped, never reflowed). */
@media (min-width: ${STACK_BELOW_PX + 1}px) {
  .vc-power-col { width: auto; align-items: flex-end; }
  /* flex-end, not stretch: a card narrower than the pad clips the pad on the LEFT
   * (glassCardStyle's overflow: hidden), so its content doesn't slide with the
   * shrinking edge. */
  .vc-power-card {
    box-sizing: border-box; width: 200px;
    display: flex; justify-content: flex-end; align-items: flex-start;
  }
  /* The card's border eats into its box, so the pad is that much narrower.
   * flex: none so it never shrinks to less than its written width. */
  .vc-power-card > .vc-card-pad { flex: none; width: 198px; box-sizing: border-box; }
  .vc-power-card.vc-folded, .vc-root:not(.vc-open) .vc-power-card { width: ${POWER_FOLDED_W_PX}px; height: ${POWER_SQUARE_PX}px; }
  /* Hidden, not removed: the pad stays laid out at full width so unfolding doesn't reflow. */
  .vc-power-card.vc-folded > .vc-card-pad, .vc-root:not(.vc-open) .vc-power-card > .vc-card-pad { visibility: hidden; }
  /* Pinned at the square's inner size (inside the border), not inset: 0, so the
   * glyph stays put while the card opens (powerCard.ts's foldTransition). */
  .vc-power-square {
    display: flex; align-items: center; justify-content: flex-end; gap: 6px; position: absolute; z-index: 1;
    top: 0; right: 0; width: ${POWER_FOLDED_W_PX - 2}px; height: ${POWER_SQUARE_PX - 2}px;
    padding: 0 6px 0 0; margin: 0; background: transparent; border: 0; cursor: pointer;
    color: ${POWER_TEAL}; opacity: 0; visibility: hidden; pointer-events: none;
    transition: color 0.15s ease;
  }
  .vc-power-card.vc-folded > .vc-power-square, .vc-root:not(.vc-open) .vc-power-card > .vc-power-square { opacity: 1; visibility: visible; pointer-events: auto; }
  /* Panel closed: the root stays up for the Power strip alone, however the card was folded
   * (deviceMenu.ts opens the panel from a click on it). */
  .vc-root:not(.vc-open) { display: flex; }
  .vc-root:not(.vc-open) > :not(.vc-cols-wrap),
  .vc-root:not(.vc-open) .vc-cols-wrap > :not(.vc-power-col),
  .vc-root:not(.vc-open) .vc-power-col > :nth-child(n+2) { display: none; }
  .vc-root:not(.vc-open) .vc-cols-wrap > .vc-power-col { display: flex; }
  .vc-power-square:hover, .vc-power-square:focus-visible { color: #fff; }
  .vc-power-square:focus-visible { outline: none; filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.7)); }
}
/* .vc-cols-wrap holds Power and the fold toggle (the meters column docks
 * elsewhere). When every card in Power and the meters column is folded,
 * vc-cols-folded collapses it to one triangle that reopens everything
 * (refreshColumnsFold in deviceMenu.ts says why the meters column still counts).
 * Scoped to direct children so a lone folded card never triggers it. */
/* align-items: flex-start stops a folded column stretching to its taller neighbour;
 * pointer-events follows .vc-root's rule, for the same click-through reason. */
.vc-cols-wrap {
  display: flex; flex-direction: row; align-items: flex-start; flex: none; gap: 4px;
  pointer-events: none;
}
.vc-cols-wrap > * { pointer-events: auto; }
.vc-cols-wrap.vc-cols-folded > .vc-power-col,
.vc-cols-wrap.vc-cols-folded > .vc-spectrum-col { display: none; }
.vc-cols-toggle {
  display: none; flex: none; width: 22px; height: 22px; padding: 0;
  align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 3px; color: rgba(255, 255, 255, 0.55); cursor: pointer;
  font: 400 12px/1 ${FONT_MONO};
}
.vc-cols-wrap.vc-cols-folded > .vc-cols-toggle { display: flex; }
.vc-cols-toggle:hover, .vc-cols-toggle:focus-visible { color: #fff; }
@media (max-width: ${STACK_BELOW_PX}px) {
  /* Undoes the base rule's none: stacked, children are full width so no gap needs
   * to pass clicks, and iOS WebKit won't touch-scroll a scroller whose own box has
   * pointer-events: none (the panel was unscrollable on iPhone). */
  .vc-root {
    flex-direction: column; width: min(320px, 88vw); overflow-y: auto;
    pointer-events: auto;
    max-height: calc(var(--vc-vh) - 74px);
  }
  .vc-root > *, .vc-spectrum-col > * { flex-shrink: 0; }
  /* Dissolve the spectrum column so the bands block and the meters become root
   * items: spectrum, controls, then meters, so a phone needn't scroll past
   * readouts to reach a slider. */
  .vc-spectrum-col { display: contents; }
  .vc-power-col, .vc-spectrum-card, .vc-controls-col { width: 100%; max-height: none; overflow: visible; }
  .vc-spectrum-col > .vc-meters { width: 100%; order: 1; max-height: none; overflow: visible; }
  /* The triangle-collapse only makes sense beside other columns: dissolve the
   * wrapper and undo vc-cols-folded's hiding. Wins by coming later at equal
   * specificity. */
  .vc-cols-wrap { display: contents; }
  .vc-cols-wrap.vc-cols-folded > .vc-power-col { display: block; }
  .vc-cols-wrap.vc-cols-folded > .vc-spectrum-col { display: contents; }
  .vc-cols-wrap.vc-cols-folded > .vc-cols-toggle { display: none; }
}

/* Header margin and pad padding live here, not inline (controlsKit.ts createCard):
 * an inline style would beat .vc-folded and leave a gap. Folded, the pad is padded
 * evenly so the title bar centres, and the right-hand slot goes with the body. */
.vc-card-head { margin-bottom: 9px; }
.vc-card-pad { padding: 10px 12px 12px; }
.vc-card.vc-folded .vc-card-head { margin-bottom: 0; }
.vc-card.vc-folded .vc-card-pad { padding: 9px 12px; }
.vc-card.vc-folded .vc-card-body { display: none; }
/* !important: the slot has an inline display (rowRightStyle's flex) that would win. */
.vc-card.vc-folded .vc-card-right { display: none !important; }

/* Fold chevron, drawn rather than a glyph to match the chip borders; the button
 * box is larger than the stroke for a comfortable target. */
.vc-fold {
  position: relative; width: 16px; height: 16px; margin: -2px -3px -2px 0; padding: 0;
  background: transparent; border: none; flex-shrink: 0; cursor: pointer;
  color: rgba(255, 255, 255, 0.4); transition: color 0.15s ease;
}
.vc-fold::before {
  content: ""; position: absolute; left: 50%; top: 50%; width: 5px; height: 5px;
  border-right: 1px solid currentColor; border-bottom: 1px solid currentColor;
  transform: translate(-50%, -70%) rotate(45deg);
  transition: transform 0.18s ease;
}
.vc-card.vc-folded .vc-fold::before { transform: translate(-65%, -50%) rotate(-45deg); }
.vc-card-head:hover .vc-fold, .vc-fold:focus-visible { color: #fff; }
.vc-fold:focus-visible { outline: none; filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.7)); }

/* Footer "Hide left" / M (deviceMenu.ts). Outranks the stacked layout's
 * display: contents on specificity. */
.vc-root.vc-meters-hidden .vc-spectrum-col { display: none; }
/* Solo (applySolo): !important beats the inline and display: contents rules
 * those elements carry. */
.vc-solo-hidden { display: none !important; }

/* Footer and keys list stick to the bottom of the controls column (the screen, stacked). */
.vc-dock { position: sticky; bottom: 0; z-index: 2; display: flex; flex-direction: column; }

/* A keys-list row's hover/click echo on each live control it names
 * (deviceMenu.ts flashOn/clearFlash); only ever adds a class. */
.vc-key-flash { outline: 1px solid #fff; animation: vc-key-flash-pulse 0.5s ease-out; }
@keyframes vc-key-flash-pulse {
  from { box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.35); }
  to { box-shadow: 0 0 0 5px rgba(255, 255, 255, 0); }
}

/* Holding Shift (keyHints.ts) shows each tagged control's keycap (data-keycap).
 * .vc-keycap-anchor makes a static control its own positioning context; skip it on
 * already-positioned controls (index.html's #menuBtn/#fsBtn, fixed): relative would
 * beat fixed on specificity. The .vc-block digit badge never has data-keycap
 * (keyHints.ts's header). */
.vc-keycap-anchor { position: relative; }
body.vc-keys-reveal [data-keycap]::after {
  content: attr(data-keycap); position: absolute; top: -7px; right: -7px;
  min-width: 14px; height: 13px; padding: 0 2px; border-radius: 3px;
  background: rgba(8, 11, 10, 0.94); border: 1px solid rgba(255, 255, 255, 0.75);
  color: #fff; font: 600 8.5px/13px ${FONT_MONO}; text-align: center;
  pointer-events: none; z-index: 41;
}

/* The keys list: each SHORTCUTS entry is a row button that performs its shortcut
 * or flashes the controls it names (wireKeysRow). */
.vc-keys {
  display: none; flex-direction: column; gap: 1px; padding: 8px 6px;
  background: var(--vc-glass-bg);
  -webkit-backdrop-filter: ${GLASS_FILTER}; backdrop-filter: ${GLASS_FILTER};
  border: 1px solid rgba(255, 255, 255, 0.13); border-bottom: none; border-radius: 3px 3px 0 0;
  font: 400 11px/1.3 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.75);
}
.vc-keys.vc-keys-show { display: flex; }
.vc-keys-row {
  display: grid; grid-template-columns: 46px 1fr; gap: 4px 12px; align-items: baseline;
  width: 100%; background: none; border: none; border-radius: 3px; padding: 4px 6px;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
}
.vc-keys-row:hover, .vc-keys-row:focus-visible { background: rgba(255, 255, 255, 0.09); outline: none; }
.vc-keys-row:disabled { cursor: default; opacity: 0.55; }
.vc-keys-key {
  font: 400 9.5px/1.3 ${FONT_MONO}; letter-spacing: 0.08em; color: #fff; white-space: nowrap;
}

.vc-scroll { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.25) transparent; }
.vc-scroll::-webkit-scrollbar { width: 4px; }
.vc-scroll::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.22); border-radius: 2px; }
.vc-scroll::-webkit-scrollbar-track { background: transparent; }

/* Digit badge on a keyboard block heading (deviceMenu.ts markBlock/renumberBlocks);
 * dimmer and spaced off so it reads as an index. Text filled in by JS. */
.vc-block-n {
  display: inline-block; min-width: 1.1em; margin-right: 0.6em;
  color: rgba(255, 255, 255, 0.32); font-variant-numeric: tabular-nums;
}

/* A row "wakes" when the pointer is anywhere over it (a far bigger target than the
 * track) or its control has focus. --vc-thumb-boost grows the thumb further near the
 * pointer (deviceMenu.ts wireThumbMagnet); unset, it falls back to 1. */
/* Padding cancelled by negative margins: the ring and glow cost no layout. */
.vc-row {
  position: relative; --vc-accent: #fff;
  padding: 6px 8px; margin: -6px -8px; border-radius: 4px;
  box-shadow: 0 0 0 1px transparent;
  transition: box-shadow 0.18s ease, background-color 0.18s ease;
}
/* A meter row (audioMeters.ts) has no control, so the row is focusable (a tap
 * unfolds its hint); the hover/focus ring below is the indicator, hence no outline. */
.vc-row[tabindex]:focus { outline: none; }
/* MIDI learn (midiCard.ts): mappable rows get a dashed edge; the one picked for the
 * next knob keeps a solid one. */
.vc-midi-learning [data-midi-row] { outline: 1px dashed color-mix(in srgb, var(--vc-accent) 70%, transparent); outline-offset: 1px; cursor: crosshair; }
.vc-midi-learning [data-midi-row] * { cursor: crosshair; }
.vc-midi-learning [data-midi-row].vc-midi-picked { outline: 2px solid var(--vc-accent); }
.vc-row:hover, .vc-row:focus-within {
  background-color: color-mix(in srgb, var(--vc-accent) 6%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent),
    0 0 14px color-mix(in srgb, var(--vc-accent) 22%, transparent);
}
/* One input in the Source row's list (deviceMenu.ts buildRow) lights up under the
 * pointer. Box-shadow and filter only: its border and background are inline styles
 * refresh() rewrites, which beat any rule here. Off for touch, where it would
 * stick after a tap. */
.vc-src-row { transition: box-shadow 0.18s ease, filter 0.18s ease; }
.vc-src-row:focus-visible { outline: none; }
@media (hover: hover) {
  .vc-src-row:hover, .vc-src-row:focus-visible {
    filter: brightness(1.2);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--vc-accent) 35%, transparent),
      inset 0 0 16px color-mix(in srgb, var(--vc-accent) 12%, transparent),
      0 0 12px color-mix(in srgb, var(--vc-accent) 18%, transparent);
  }
}
@media (hover: none) {
  .vc-src-row:focus-visible {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent);
  }
}
@media (prefers-reduced-motion: reduce) {
  .vc-src-row { transition: none; }
}
.vc-label { color: #fff; transition: color 0.18s ease, text-shadow 0.18s ease; }
.vc-row:hover .vc-label, .vc-row:focus-within .vc-label {
  color: var(--vc-accent);
  text-shadow: 0 0 10px color-mix(in srgb, var(--vc-accent) 35%, transparent);
}
/* A row's own hint never unfolds in the row: src/ui/rowHints.ts shows a copy
 * of it beside the panel (.vc-row-hint, below), so nothing in the column
 * moves on hover. Kept in the row, visually hidden, so a screen reader still
 * reads it with the row, and so the code that writes into it keeps working.
 * On a touch screen (iPad Safari) a tap that makes something appear through
 * :hover counts as a hover, and the tap's click is dropped, so a jack inside
 * the row didn't plug in until a second tap: rowHints.ts shows a finger the
 * hint through focus only. */
.vc-hint {
  position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap;
}
/* The floating copy (src/ui/rowHints.ts): beside the row's column, level
 * with the row, over the picture; or over the rows below it where there's no
 * room beside (.vc-row-hint-over). Dark glass and a left rule in the row's
 * own accent (--c, set by rowHints.ts), like the jack tooltip (.vc-tooltip,
 * below); above the cable layer, which it can sit over. */
.vc-row-hint {
  position: fixed; z-index: 40; pointer-events: none; box-sizing: border-box;
  background: rgba(8, 11, 10, 0.94); border-radius: 3px;
  padding: 6px 9px 7px 11px; font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.82);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
/* The accent rule is drawn, not a border, so it can grow on the way in. */
.vc-row-hint::before {
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
  border-radius: 3px 0 0 3px; background: var(--c, #fff); transform-origin: 50% 0;
}
/* rowHints.ts sets --dx/--dy so the layer comes out of the row's column.
 * Only the swap class glides top: a glide on every place() would lag the
 * layer behind its row while the panel scrolls. */
@media (prefers-reduced-motion: no-preference) {
  .vc-row-hint-in { animation: vc-row-hint-in 0.22s cubic-bezier(0.2, 0.9, 0.3, 1.15) both; }
  .vc-row-hint-in::before {
    animation: vc-row-hint-rule 0.32s cubic-bezier(0.3, 0.8, 0.3, 1) both;
  }
  .vc-row-hint-swap { transition: top 0.16s cubic-bezier(0.25, 0.8, 0.3, 1); }
  .vc-row-hint-swap .vc-row-hint-text { animation: vc-row-hint-text 0.18s ease-out both; }
  .vc-row-hint-out { animation: vc-row-hint-out 0.12s ease-in both; }
}
@keyframes vc-row-hint-in {
  from {
    opacity: 0; filter: blur(3px);
    transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(0.97);
  }
  to { opacity: 1; filter: none; transform: none; }
}
@keyframes vc-row-hint-rule {
  from { transform: scaleY(0); box-shadow: 0 0 0 transparent; }
  60% { box-shadow: 0 0 10px var(--c, #fff); }
  to { transform: scaleY(1); box-shadow: 0 0 0 transparent; }
}
@keyframes vc-row-hint-text { from { opacity: 0; transform: translateY(3px); } }
.vc-row-hint-text { display: block; }
@keyframes vc-row-hint-out { to { opacity: 0; transform: translate(var(--dx, 0px), var(--dy, 0px)); } }
/* Auto takeover line (AUTO_HOLDING_HINT): a second line in auto's colour while auto
 * holds the row, so the description above stays readable. */
.vc-hint-auto { color: ${withAlpha(AUTO_SKY, 0.85)}; }
/* The line before a colour word in a hint (hintSwatches.ts), drawn like a meter
 * trace in currentColor. The word and line never wrap apart; the faint ring keeps
 * a black line visible on the dark panel. */
.vc-swatch-word { white-space: nowrap; }
.vc-swatch {
  display: inline-block; width: 1.1em; height: 2px; margin-right: 0.3em;
  border-radius: 1px; vertical-align: 0.3em; background: currentColor;
  box-shadow: 0 0 4px currentColor, 0 0 0 0.5px rgba(255, 255, 255, 0.25);
}
.vc-swatch-bare .vc-swatch { margin: 0 0.1em; }

/* A row's "reacts to" strip (createSignalStrip): a sibling of .vc-hint, not inside
 * it, so they reveal independently (auto's takeover line goes in the hint, never
 * here). Its pills are buttons, so it can't float beside the panel like the hint
 * (that layer ignores the pointer); it unfolds in the row instead, on focus or
 * pinned open by its head chip (.vc-reads-open), but not on hover, which would
 * slide the rows below under the cursor. */
.vc-reads {
  max-height: 0; opacity: 0; overflow: hidden; margin-top: 0;
  transition: max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
}
.vc-row:focus-within .vc-reads, .vc-reads.vc-reads-open {
  max-height: 60px; opacity: 1; margin-top: 6px;
}

/* The whole input is the touch target, taller than the track it draws. The accent
 * comes from the enclosing .vc-row. */
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
/* A .vc-slider outside a .vc-row (buildWeightSlider) has no :focus-within ancestor
 * for the effect above, so it gets a plain ring. */
.vc-slider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px color-mix(in srgb, var(--vc-accent) 60%, transparent);
}
.vc-slider:focus-visible::-moz-range-thumb {
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px color-mix(in srgb, var(--vc-accent) 60%, transparent);
}
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

/* A row muted by its T chip (createControlRow): the thumb stays on the value a second
 * T restores, so it turns FADER_OFF; an auto-held row keeps its accent. */
.vc-row-off .vc-slider { --vc-accent: rgba(255, 255, 255, 0.28); }
.vc-row-off .vc-slider::-webkit-slider-thumb { background: ${FADER_OFF}; }
.vc-row-off .vc-slider::-moz-range-thumb { background: ${FADER_OFF}; }

/* Linked-item divergent-value tick (createControlRow's linkedTicks): the wrapper is
 * sized exactly to its slider so a tick's left percentage (valueToPercent) lands
 * where a drag to that value would. A readout, never a handle. */
.vc-slider-ticks { position: absolute; inset: 0; pointer-events: none; }
.vc-slider-tick {
  position: absolute; top: 50%; width: 2px; height: 12px;
  transform: translate(-50%, -50%); border-radius: 1px;
  background: var(--c, rgba(255, 255, 255, 0.85));
  box-shadow: 0 0 3px var(--c, rgba(255, 255, 255, 0.6));
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

/* Enum chip strip (createPickerRow): the strip is the ring stop, so it rings as a whole. */
.vc-picker { outline: none; border-radius: 4px; margin-top: 6px; }
.vc-picker:focus-visible {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vc-accent) 70%, transparent);
}

/* The patch bay (deviceMenu.ts): a drive row's input port and pinned/preview highlight.
 *
 * The port is a class rule because drivePortStyle() only writes colour/border/
 * box-shadow inline. Its left is positive: .vc-row's padding/negative-margin pair
 * means a more negative offset lands outside .vc-card's overflow: hidden and is clipped.
 *
 * --vc-pin-color (set by refreshMeta, on the row) is the setting's first plugged
 * source colour, or SCENE_VIOLET for a "scene" mix with nothing plugged, matching
 * drivePortStyle's glow. Pinned gets a solid border; previewed only the tint (see
 * the row grammar in this file's header for why a click expands the patch panel). */
.vc-drive-port {
  position: absolute; left: 6px; top: 6px; width: 10px; height: 10px; border-radius: 50%;
  padding: 0; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.vc-drive-port:hover { transform: scale(1.25); }
.vc-drive-port:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.vc-drive-row-left { padding-left: 14px; }
.vc-row.vc-drive-pinned {
  background-color: color-mix(in srgb, var(--vc-pin-color, ${SCENE_VIOLET}) 8%, transparent);
  box-shadow: 0 0 0 1.5px var(--vc-pin-color, ${SCENE_VIOLET});
}
/* Solo's eye (positionSoloEye): fixed on <body> just outside the pinned row's left
 * edge, in the pin's colour. The lids draw back (--open) while this setting is the
 * only thing shown. Click only; very dim at rest so it doesn't compete with the row. */
.vc-solo-eye {
  position: fixed; z-index: 31; width: 18px; height: 18px; padding: 0;
  background: none; border: none; cursor: pointer; color: var(--vc-pin-color, ${SCENE_VIOLET});
  --open: 0;
}
.vc-solo-eye svg { width: 18px; height: 18px; display: block; overflow: visible; }
.vc-eye-lid-top, .vc-eye-lid-bot {
  transform: scaleY(calc(1 - var(--open)));
  transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.3, 1);
}
.vc-eye-lid-top { transform-origin: 12px 4.6px; }
.vc-eye-lid-bot { transform-origin: 12px 19.4px; }
.vc-solo-eye { opacity: 0.28; transition: opacity 0.18s ease; }
.vc-solo-eye:hover, .vc-solo-eye:focus-visible { opacity: 1; outline: none; }
.vc-solo-eye.vc-solo-eye-on { --open: 1; }
.vc-solo-eye.vc-solo-eye-on svg { filter: drop-shadow(0 0 3px var(--vc-pin-color, ${SCENE_VIOLET})); }
@media (prefers-reduced-motion: reduce) {
  .vc-eye-lid-top, .vc-eye-lid-bot { transition: none; }
}
.vc-row.vc-drive-preview {
  background-color: color-mix(in srgb, var(--vc-pin-color, ${SCENE_VIOLET}) 6%, transparent);
}

/* Typable readout digits (createControlRow): unchanged bar the text cursor, a caret in
 * --vc-accent and the selection highlight; never an input box, underline or background. */
.vc-digits-typable { cursor: text; }
.vc-digits-edit { outline: none; caret-color: var(--vc-accent); min-width: 0.6em; }
.vc-digits-edit::selection {
  color: #fff; background: color-mix(in srgb, var(--vc-accent) 45%, transparent);
}

/* The ⚠ beside a custom value (createControlRow, render/customValues.ts). Only the
 * blurred copy's opacity pulses: opacity animates on the compositor, so nothing
 * repaints, and it exists only while a custom value does. Reduced motion holds it still. */
.vc-custom-mark { position: relative; align-self: center; line-height: 0; color: var(--vc-accent); }
.vc-custom-icon { position: relative; }
.vc-custom-glow {
  position: absolute; left: 0; top: 0; filter: blur(1.5px); opacity: 0.35;
  animation: vc-custom-glow 2.4s ease-in-out infinite alternate; will-change: opacity;
}
.vc-custom-glow path { stroke-width: 2.4; }
@keyframes vc-custom-glow { from { opacity: 0.15; } to { opacity: 0.6; } }
@media (prefers-reduced-motion: reduce) {
  .vc-custom-glow { animation: none; }
}

/* Jacks (jack.ts): a ring a meter row or hits lane mounts, in its source's colour
 * (driveSources.ts). Solid when it feeds the shown (preview ?? pinned) setting; the
 * usage dots count this scene's settings using it, always on. jack.ts's header has
 * the split between this file and deviceMenu.ts. */
.vc-jack {
  position: relative; width: 13px; height: 13px; border-radius: 50%; padding: 0;
  border: 1.5px solid var(--c); flex-shrink: 0; cursor: pointer;
  background: radial-gradient(circle, rgba(5, 4, 8, 0.9) 0 34%, color-mix(in srgb, var(--c) 18%, transparent) 36%);
  transition: transform 0.15s ease, box-shadow 0.2s ease;
}
.vc-jack:hover { transform: scale(1.2); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c) 22%, transparent); }
.vc-jack-filled {
  background: radial-gradient(circle, var(--c) 0 40%, color-mix(in srgb, var(--c) 30%, #111) 44%);
  box-shadow: 0 0 8px color-mix(in srgb, var(--c) 60%, transparent);
}
.vc-jack:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
/* Usage dots (jack.ts setUses/useDotLayout): each at its own --a, --r out, sized --s. */
.vc-jack-uses { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.vc-jack-uses i {
  position: absolute; left: calc(var(--s) / -2); top: calc(var(--s) / -2);
  width: var(--s); height: var(--s); border-radius: 50%; background: var(--c); opacity: 0.75;
  transform: rotate(var(--a)) translateY(calc(-1 * var(--r)));
}
/* Heat pip (heat.ts) after a wire's name: coloured cold to hot via --heat, gliding
 * between recolours. */
.vc-heat-pip {
  position: absolute; width: 4px; height: 4px; border-radius: 50%; background-color: var(--heat); pointer-events: none;
  transition: background-color ${HEAT_REFRESH_MS}ms linear;
}
.vc-heat-pip[hidden] { display: none; }
.vc-heat-pip-wire { position: relative; display: inline-block; margin-left: 7px; vertical-align: 1px; }
/* Heat strip (heat.ts) under a wired setting's graph or a signal's monitor, and in
 * the Heat history card. */
.vc-heat-strip { height: 2px; margin-top: 3px; border-radius: 1px; background: rgba(255,255,255,0.06); }
.vc-heat-strip[hidden] { display: none; }
/* A signal monitor's strips (audioMeters.ts): one line per signal, led by a dot in its colour (--c). */
.vc-heat-monitor { display: grid; gap: 3px; margin-top: 5px; }
.vc-heat-monitor-line { display: flex; align-items: center; gap: 5px; }
.vc-heat-monitor-line::before { content: ""; flex: none; width: 4px; height: 4px; border-radius: 50%; background: var(--c); }
.vc-heat-monitor-line .vc-heat-strip { flex: 1; margin-top: 0; }
.vc-heat-hist { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 4px 8px; align-items: center; }
.vc-heat-hist-label { font: 400 11px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.78); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-heat-hist-strip { height: 5px; border-radius: 1px; background: rgba(255,255,255,0.06); }
.vc-heat-hist-group { grid-column: 1 / -1; font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(255,255,255,0.45); margin-top: 6px; }
.vc-heat-hist-axis { display: flex; justify-content: space-between; font: 400 9.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.45); margin: 6px 0 0 104px; }
.vc-heat-hist-note { font: 400 11px/1.4 ${FONT_LABEL}; color: rgba(255,255,255,0.55); margin-bottom: 4px; }
/* The heat lens (L, or the column head's HEAT chip): wired setting rows, signal monitor
 * rows and signal jacks (.vc-heat-row/.vc-heat-jack, audioMeters.ts mountJack) glow in
 * --vc-heat (recoloured at most every HEAT_REFRESH_MS), brighter with --vc-heat-glow
 * (0..1). A pseudo-element, so the row's own rings and the jack's fill are untouched.
 * --vc-heat is a registered colour so it glides; the glow stays immediate. */
@property --vc-heat { syntax: "<color>"; inherits: true; initial-value: ${HEAT_COLORS[0]}; }
.vc-heat-lens .vc-heat-row::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  background: color-mix(in srgb, var(--vc-heat, #4d5b78) calc(6% + 14% * var(--vc-heat-glow, 0)), transparent);
  box-shadow: inset 3px 0 0 var(--vc-heat, #4d5b78),
    0 0 calc(2px + 16px * var(--vc-heat-glow, 0)) color-mix(in srgb, var(--vc-heat, #4d5b78) calc(20% + 60% * var(--vc-heat-glow, 0)), transparent);
  transition: --vc-heat ${HEAT_REFRESH_MS}ms linear;
}
.vc-heat-lens .vc-heat-jack::after {
  content: ""; position: absolute; inset: -2px; border-radius: 50%; pointer-events: none;
  box-shadow: 0 0 calc(2px + 12px * var(--vc-heat-glow, 0)) calc(1px + 2px * var(--vc-heat-glow, 0))
    color-mix(in srgb, var(--vc-heat, #4d5b78) calc(35% + 60% * var(--vc-heat-glow, 0)), transparent);
  transition: --vc-heat ${HEAT_REFRESH_MS}ms linear;
}

/* Highlighting while a setting is previewed/pinned (refreshPatchHighlight,
 * refreshBandsJacks, audioMeters.ts refreshPatchView): meter rows dim except those
 * jack.ts setRowFed marks as feeding something.
 *  - .vc-row-fed: feeds the pinned setting, nothing else previewed. Strong glow.
 *  - .vc-row-fed-soft: feeds the previewed setting (wins over a pinned feed on the
 *    same row) or is named in a "scene" setting's display-only sceneSources (drives.ts).
 *  - .vc-row-fed-faint: feeds the pinned setting while a different one is previewed.
 * A hit lane also gets its own glow bar (audioMeters.ts), since each lane can feed
 * a different setting. */
/* .vc-row-keep (the Bands faders row) opts out: it is the primary display and gets
 * band-range dimming (spectrumStrip.ts setHighlight) instead of a flat opacity drop. */
.vc-spectrum-col.vc-patching .vc-row:not(.vc-row-fed):not(.vc-row-fed-soft):not(.vc-row-fed-faint):not(.vc-row-keep) { opacity: 0.45; }
/* "Only this" (driveSolo.ts): the soloed row stays at full strength, with the rows of its own open panel. */
.vc-drive-solo-dim .vc-row:not(.vc-row-solo):not(.vc-row-solo .vc-row) { opacity: 0.45; }
.vc-row-fed, .vc-row-fed-soft, .vc-row-fed-faint {
  box-shadow: inset 0 0 0 1px var(--vc-hl, transparent), 0 0 16px color-mix(in srgb, var(--vc-hl, transparent) 20%, transparent);
}
.vc-row-fed-soft { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-hl, transparent) 45%, transparent); }
.vc-row-fed-faint { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-hl, transparent) 25%, transparent); }
.vc-lane-glow {
  position: absolute; left: 0; right: ${LANE_JACK_GUTTER_PX}px; pointer-events: none; border-radius: 2px;
  background: color-mix(in srgb, var(--c) 22%, transparent); opacity: 0; transition: opacity 0.15s ease;
}
.vc-lane-glow.on { opacity: 1; }

/* Hovering a jack highlights every scene row it feeds: a transient echo of
 * .vc-row-fed, keyed to the jack (onJackHover). */
.vc-row.vc-drive-hl {
  box-shadow: 0 0 0 1px var(--vc-hl2, transparent), 0 0 14px color-mix(in srgb, var(--vc-hl2, transparent) 22%, transparent);
}

/* The cable layer (cableLayer.ts): one fixed SVG above .vc-root covering the viewport,
 * so a cable can cross cards without their overflow: hidden clipping it. Two groups
 * (its header): the pinned setting's cables below, and the previewed setting's
 * flatter .vc-cable-preview. .vc-cable-dimmed pulls the pinned group back while a
 * preview shows. */
.vc-cable-layer { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 31; overflow: visible; }
.vc-cable-glow { fill: none; stroke-width: 6; opacity: 0.13; }
.vc-cable-core { fill: none; stroke-width: 1.5; opacity: 0.8; }
.vc-cable-core.vc-cable-soft { stroke-dasharray: 3 3; opacity: 0.4; }
.vc-cable-flow { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 0.1 10; opacity: 0.9; }
.vc-cable-flow.vc-cable-soft { opacity: 0.4; }
.vc-cable-core.vc-cable-new { stroke-dasharray: 100; stroke-dashoffset: 100; animation: vc-cable-draw 0.25s ease-out forwards; }
.vc-cable-glow.vc-cable-new, .vc-cable-flow.vc-cable-new { opacity: 0; animation: vc-cable-fadein 0.2s 0.2s forwards; }
@keyframes vc-cable-draw { to { stroke-dashoffset: 0; } }
@keyframes vc-cable-fadein { to { opacity: var(--o, 0.8); } }
@media (prefers-reduced-motion: reduce) {
  .vc-cable-core.vc-cable-new, .vc-cable-glow.vc-cable-new, .vc-cable-flow.vc-cable-new { animation: none; stroke-dashoffset: 0; opacity: var(--o, 0.8); }
  .vc-cable-flow { stroke-dasharray: none; }
}
/* !important: must win whichever other cable classes (.vc-cable-soft, .vc-cable-new)
 * share the path. */
.vc-cable-glow.vc-cable-dimmed, .vc-cable-core.vc-cable-dimmed, .vc-cable-flow.vc-cable-dimmed { opacity: 0.35 !important; }
/* Flat and quiet on purpose: a transient hover must not read as "committed". */
.vc-cable-preview { fill: none; stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
.vc-cable-drag { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 6 6; opacity: 0.95; }
.vc-root.vc-dragging .vc-drive-port { box-shadow: 0 0 0 4px rgba(195,165,249,0.28); }
.vc-root.vc-dragging .vc-drop-target { box-shadow: 0 0 0 1px rgba(255,255,255,0.7), 0 0 14px -4px #fff; }
@media (min-width: ${STACK_BELOW_PX + 1}px) { .vc-jack { cursor: grab; } }
.vc-root.vc-dragging, .vc-root.vc-dragging * { cursor: grabbing !important; }
/* A lit signal's wires to every port it reaches (cableLayer.ts fan group): solid where
 * a preview is dashed, quieter than a pinned cable. */
.vc-cable-fan { fill: none; stroke-width: 1; opacity: 0.55; animation: vc-cable-fan-in 0.15s ease-out; }
@keyframes vc-cable-fan-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .vc-cable-fan { animation: none; } }
/* Each Only when condition source (drives.ts header; deviceMenu.ts cableGroupFor): a
 * longer dash than the soft/preview ones so a gate reads distinctly. Core only; the
 * flow layer keeps its short dash and the glow layer stays solid. */
.vc-cable-core.vc-cable-cond { stroke-dasharray: 9 6; }
/* A muted source's cable (DriveSource.off): one flat path, no glow/flow layer
 * (cableLayer.ts skips them), with a longer dash than the others. */
.vc-cable-muted { fill: none; stroke-width: 1; stroke-dasharray: 14 8; opacity: 0.3; }
/* Pressing a cable unplugs it (cableLayer.ts onPress, wired by deviceMenu.ts
 * cableGroupFor). The layer is pointer-events: none, so this transparent hit stroke is
 * the only part that answers; its width, not the core's, makes a thin cable easy to
 * press. The same stroke carries the hover lift: a drop-shadow in the group's CSS
 * color (via currentColor), a thicker core, a brighter glow, and flow beads lifted
 * toward white and wider (at resting width they'd sink into the thicker core and the
 * flow would vanish exactly while the cable is looked at). The bead lift is
 * motion-only: reduced motion draws the flow as a solid line, which whitening would
 * just recolour. Preview/scene-mix cables never grow a hit stroke, so they never
 * light up like this. */
.vc-cable-hit { fill: none; stroke: transparent; stroke-width: 14; stroke-linecap: round; pointer-events: stroke; cursor: pointer; }
.vc-cable-g { transition: filter 0.15s ease; }
.vc-cable-core { transition: stroke-width 0.12s ease, opacity 0.12s ease; }
.vc-cable-glow { transition: opacity 0.12s ease, stroke-width 0.12s ease; }
.vc-cable-flow { transition: opacity 0.12s ease, stroke-width 0.12s ease; }
.vc-cable-muted { transition: opacity 0.12s ease; }
.vc-cable-g:hover { filter: drop-shadow(0 0 3px currentColor) drop-shadow(0 0 9px currentColor); }
.vc-cable-g:hover .vc-cable-core { stroke-width: 3; opacity: 1; }
.vc-cable-g:hover .vc-cable-glow { opacity: 0.5; stroke-width: 9; }
.vc-cable-g:hover .vc-cable-flow { opacity: 1; }
@media (prefers-reduced-motion: no-preference) {
  .vc-cable-g:hover .vc-cable-flow { stroke-width: 3.5; stroke: color-mix(in srgb, currentColor 25%, white); }
}
.vc-cable-g:hover .vc-cable-muted { opacity: 0.8; }
@media (prefers-reduced-motion: reduce) {
  .vc-cable-g, .vc-cable-core, .vc-cable-glow, .vc-cable-flow, .vc-cable-muted { transition: none; }
}

/* "Pick a setting first": a jack clicked with nothing pinned or previewed (showToast). */
.vc-toast {
  position: fixed; left: 50%; bottom: 84px; transform: translate(-50%, 6px);
  background: rgba(8, 11, 10, 0.92); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
  padding: 8px 14px; font: 400 12px/1.3 ${FONT_LABEL}; color: #fff; z-index: 32;
  opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease;
}
.vc-toast-show { opacity: 1; transform: translate(-50%, 0); }

/* The instant tooltip (tooltip.ts) for a jack, a row's input port or sparkline (the
 * pinned patch panel uses .vc-drive-bottom-hint instead). Its --c is set by
 * tooltip.ts. z-index above the cable layer and the toast: it must read over both. */
.vc-tooltip {
  position: fixed; z-index: 40; pointer-events: none; max-width: 230px;
  background: rgba(8, 11, 10, 0.94); border-left: 2px solid var(--c, #fff);
  border-radius: 3px; padding: 5px 8px 6px;
  font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.vc-tooltip div + div { color: rgba(255, 255, 255, 0.55); margin-top: 2px; }

/* The patch panel's bottom hint (buildPatchPanel): a fixed-height strip so the panel
 * doesn't reflow as the text changes; written by one delegated listener pair from
 * each control's data-hint, never per tick. */
.vc-drive-bottom-hint {
  min-height: 2.6em; font: 400 11px/1.3 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.6);
  padding-top: 2px; border-top: 1px solid rgba(255, 255, 255, 0.07);
}

/* The Only when marker (buildSourceLine) sits in every source line's gutter column
 * (driveSrcGutterStyle), a fixed-width span reserved even for non-conditions so the
 * rule never shifts a line's contents. Lit only on a condition line. */
.vc-drive-gutter-cond { border-right: 2px dashed rgba(255, 255, 255, 0.45); }

/* The source line's on/off switch (buildMuteSwitch): a compact copy of .vc-toggle's
 * look, deliberately not that class, which is the Tab-ring selector (ringElements()).
 * --c lights the track while the source is on. */
.vc-mute-switch {
  position: relative; width: 18px; height: 10px; padding: 0; border: none; border-radius: 6px;
  background: rgba(255, 255, 255, 0.16); cursor: pointer; flex-shrink: 0;
  transition: background 0.15s ease;
}
.vc-mute-switch::after {
  content: ""; position: absolute; top: 1.5px; left: 1.5px; width: 7px; height: 7px;
  border-radius: 50%; background: #fff; transition: transform 0.15s ease;
}
.vc-mute-switch[aria-checked="true"] { background: color-mix(in srgb, var(--c, #fff) 55%, rgba(255, 255, 255, 0.16)); }
.vc-mute-switch[aria-checked="true"]::after { transform: translateX(8px); }
.vc-mute-switch:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* A muted source line (DriveSource.off) dims, except the switch, so it's clear what
 * brings the source back. */
.vc-drive-src-muted > *:not(.vc-mute-switch) { opacity: 0.45; }

/* Chrome buttons (index.html) ring while active: the gear while open, fullscreen while immersed. */
.iconBtn[aria-pressed="true"] { border-color: rgba(255, 255, 255, 0.5); color: #fff; }

/* The Source row's "nothing picked yet" line (createSourceRow): an echo of the gallery
 * masthead's shimmer hint (gallery.ts .gal-source-hint-text). The base colour is
 * here, not inline, which would beat this rule. Text only, no arrow: these chips sit
 * above the line, so there is no single direction to point. */
.vc-src-status { color: rgba(255, 255, 255, 0.5); }
@media (prefers-reduced-motion: no-preference) {
  .vc-src-status[data-prompting] {
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.4) 40%, #fff 50%, rgba(255, 255, 255, 0.4) 60%) 100% 0 /
      250% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
    animation: vc-src-shimmer 2.6s ease-in-out infinite;
  }
  @keyframes vc-src-shimmer {
    from { background-position: 100% 0; }
    to { background-position: 0 0; }
  }
}

/* Source row status while inputHealth.ts reads anything but ok (inputHealthText): the
 * warning ramp of HOT_YELLOW/HOT_RED. Never together with [data-prompting], which
 * applies only while nothing is live. */
.vc-src-status[data-warn="amber"] { color: ${HOT_YELLOW}; }
.vc-src-status[data-warn="red"] { color: ${HOT_RED}; }

/* ---- src/ui/widgets/itemBoxes.ts + strainConsole.ts + pairPads.ts ----
 * Item widgets, styled with this file's tokens rather than a widget-local stylesheet.
 * Always two columns so a box stays wide enough for its code and swatch in the narrow
 * layout (itemBoxes.ts's header: why the live preview lands in .vc-item-preview
 * without a layout change). */
.vc-item-boxes {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px;
}
.vc-item-box {
  display: grid; gap: 6px; padding: 8px; border-radius: 6px; text-align: left; min-width: 0;
  background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.13); cursor: pointer; font: inherit; color: inherit;
}
.vc-item-box:focus-visible { outline: 2px solid ${SCENE_VIOLET}; outline-offset: 2px; }
.vc-item-box-sel {
  border-color: var(--c, ${SCENE_VIOLET});
  background: color-mix(in srgb, var(--c, ${SCENE_VIOLET}) 14%, transparent);
}
.vc-item-box-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.vc-item-led {
  flex: none; width: 8px; height: 8px; border-radius: 50%;
  background: var(--c, #fff); box-shadow: 0 0 7px var(--c, #fff);
}
.vc-item-code {
  font: 500 11.5px/1 ${FONT_MONO}; color: #fff; letter-spacing: 0.03em;
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
/* A live preview is a <canvas> in this slot; a family without one keeps a placeholder
 * <div>, so the layout is the same. */
.vc-item-preview {
  display: block; width: 100%; aspect-ratio: 1; border-radius: 4px;
  background: color-mix(in srgb, var(--c, #fff) 10%, rgba(0, 0, 0, 0.35));
  border: 1px solid rgba(255, 255, 255, 0.08);
}
/* Per-box readouts and the population bar + Rebalance/Pipette row (itemBoxes.ts). */
.vc-item-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-top: 4px; }
.vc-item-stat { display: grid; justify-items: center; gap: 1px; font: 400 9px/1.1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.04em; }
.vc-item-stat b { color: #fff; font-weight: 400; font-size: 10.5px; font-variant-numeric: tabular-nums; }

.vc-pop-wrap { display: grid; gap: 6px; justify-items: center; margin: 4px 0 10px; }
.vc-popbar { display: flex; height: 10px; width: 100%; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.08); }
.vc-popbar span { display: block; height: 100%; transition: width 0.2s ease; }
.vc-poplabels { display: flex; flex-wrap: wrap; gap: 5px 12px; justify-content: center; font: 400 10px/1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.65); }
.vc-poplabels i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 4px; box-shadow: 0 0 5px currentColor; }
.vc-pop-actions { display: flex; gap: 8px; }

/* The one Random under the boxes (itemBoxes.ts, "One Random"); the die spins once per roll. */
.vc-roll {
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
  margin: 10px 0 8px; padding: 9px 12px; cursor: pointer; color: ${SCENE_VIOLET};
  background: linear-gradient(135deg, rgba(195, 165, 249, 0.16), rgba(195, 165, 249, 0.04));
  border: 1px solid rgba(195, 165, 249, 0.55); border-radius: 8px;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.vc-roll[hidden] { display: none; }
.vc-roll:hover, .vc-roll:focus-visible {
  color: #fff; border-color: ${SCENE_VIOLET};
  background: linear-gradient(135deg, rgba(195, 165, 249, 0.3), rgba(195, 165, 249, 0.08));
}
.vc-roll-die { width: 22px; height: 22px; flex-shrink: 0; }
.vc-roll-text { display: grid; justify-items: start; gap: 2px; text-align: left; }
.vc-roll-text b { font: 500 13px/1 ${FONT_LABEL}; letter-spacing: 0.08em; text-transform: uppercase; }
.vc-roll-text span { font: 400 10px/1.1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.03em; }
.vc-roll-spin .vc-roll-die { animation: vc-roll-spin 0.45s cubic-bezier(0.3, 1.4, 0.6, 1); }
@keyframes vc-roll-spin { from { transform: rotate(-200deg) scale(0.7); } to { transform: rotate(0) scale(1); } }
@media (prefers-reduced-motion: reduce) {
  .vc-roll-spin .vc-roll-die { animation-duration: 0.01s; }
}

/* ---- src/ui/widgets/strainConsole.ts (see its header) ---- */
.vc-sc-track:focus-visible { outline: 2px solid ${SCENE_VIOLET}; outline-offset: 2px; }
.vc-sc-detail[hidden] { display: none; }
.vc-sc-lanes { display: grid; gap: 6px; }
.vc-sc-row {
  display: grid; gap: 6px; padding: 8px 10px; margin-inline: -10px; border-radius: 6px;
  transition: background-color 0.15s ease, box-shadow 0.15s ease;
}
.vc-sc-row:hover, .vc-sc-row:focus-within {
  background: rgba(195, 165, 249, 0.06); box-shadow: 0 0 0 1px rgba(195, 165, 249, 0.4), 0 0 14px rgba(195, 165, 249, 0.18);
}
.vc-sc-row-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.vc-sc-row-name { display: flex; align-items: center; gap: 8px; }
/* A stand-in with the real port's look until the row mounts, then the row's own port moves in. */
.vc-sc-port-slot { display: inline-flex; width: 14px; height: 14px; align-items: center; justify-content: center; }
.vc-sc-port-slot .vc-drive-port { position: static; flex: none; }
.vc-sc-port-slot .vc-drive-port[hidden] { display: none; }
.vc-row.vc-port-moved .vc-drive-row-left { padding-left: 0; }
.vc-sc-row-title { font: 400 14px/1.2 ${FONT_LABEL}; color: #fff; }
.vc-sc-row:hover .vc-sc-row-title, .vc-sc-row:focus-within .vc-sc-row-title { color: ${SCENE_VIOLET}; }
.vc-sc-chip {
  padding: 3px 8px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.24); background: rgba(255, 255, 255, 0.04);
  font: 400 10px/1 ${FONT_MONO}; letter-spacing: 0.08em; color: rgba(255, 255, 255, 0.64); cursor: pointer;
}
.vc-sc-chip:hover { color: #fff; }
.vc-sc-chip[aria-pressed="true"] { color: #fff; border-color: ${SCENE_VIOLET}; background: rgba(195, 165, 249, 0.14); }
.vc-sc-lane-list { display: grid; gap: 3px; }
.vc-sc-lane { display: grid; grid-template-columns: 14px 30px minmax(0, 1fr) 44px; align-items: center; gap: 8px; height: 16px; }
.vc-sc-lane-port { display: flex; align-items: center; }
.vc-sc-lane-code { font: 400 10px/1 ${FONT_MONO}; white-space: nowrap; overflow: hidden; }
.vc-sc-lane-val { font: 400 11px/1 ${FONT_MONO}; text-align: right; color: rgba(255, 255, 255, 0.64); font-variant-numeric: tabular-nums; }
.vc-sc-track { position: relative; height: 16px; cursor: pointer; touch-action: none; outline: none; }
.vc-sc-rail { position: absolute; left: 0; right: 0; top: 7px; height: 2px; border-radius: 1px; background: rgba(255, 255, 255, 0.14); }
.vc-sc-fill { position: absolute; left: 0; top: 7px; height: 2px; border-radius: 1px; }
.vc-sc-thumb {
  position: absolute; top: 2px; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%;
  border: 2px solid #0b0f10; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5);
}
.vc-sc-rail[style*="gradient"] { height: 4px; top: 6px; opacity: 0.7; }

.vc-sc-detail { display: grid; gap: 4px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.vc-sc-detail-head { font: 400 11px/1 ${FONT_MONO}; letter-spacing: 0.08em; }

.vc-sc-syn { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 14px; margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.vc-sc-wheel { position: relative; width: 64px; height: 64px; }
.vc-sc-wheel-ring {
  position: absolute; inset: 0; border-radius: 50%; opacity: 0.55;
  background: conic-gradient(hsl(0 90% 58%), hsl(60 90% 58%), hsl(120 90% 58%), hsl(180 90% 58%), hsl(240 90% 58%), hsl(300 90% 58%), hsl(360 90% 58%));
  -webkit-mask: radial-gradient(circle, transparent 60%, #000 61%); mask: radial-gradient(circle, transparent 60%, #000 61%);
}
.vc-sc-wheel svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.vc-sc-syn-left { display: grid; justify-items: center; gap: 4px; }
/* Mix row and colour row (strainConsole.ts); the buttons reuse .vc-mix-row and
 * .vc-exp-pill below. */
.vc-sc-mix { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.vc-sc-mix .vc-mix-row { margin-bottom: 8px; }
.vc-sc-syn > .vc-mix-row { grid-column: 1 / -1; margin-bottom: 0; }
.vc-sc-harmony { font: 400 9px/1.1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.5); min-height: 10px; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .vc-sc-row { transition: none; }
}

/* position/left/top are set inline per tap, on <body>, so the panel's scroll container
 * doesn't clip it. */
.vc-pipette-ring {
  position: fixed; width: 10px; height: 10px; margin: -5px 0 0 -5px;
  border: 2px solid ${BANDS_AMBER}; border-radius: 50%; opacity: 0.95;
  pointer-events: none; z-index: 9999; animation: vc-pipette-pulse 0.65s ease-out forwards;
}
@keyframes vc-pipette-pulse { to { width: 64px; height: 64px; margin: -32px 0 0 -32px; opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .vc-pipette-ring { animation: none; opacity: 0; transition: opacity 0.5s ease-out; }
}

/* ---- src/ui/widgets/pairPads.ts ----
 * Each section is a plain .vc-row (wake-on-hover and .vc-drive-pinned come free), so
 * no rules of their own are needed for that. */.vc-relrow* rules above this comment's
 * own predecessor (relationWeb.ts/relationRows.ts, deleted the same day this
 * widget landed). */
.vc-pair-layers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
.vc-pair-layer {
  display: grid; gap: 2px; text-align: left; padding: 8px 10px; cursor: pointer; font: inherit; color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; background: rgba(255, 255, 255, 0.02);
}
.vc-pair-layer b { font: 600 13px/1.2 ${FONT_LABEL}; letter-spacing: 0.02em; }
.vc-pair-layer span { font-size: 11.5px; line-height: 1.3; color: rgba(255, 255, 255, 0.4); }
/* --lc is PAIR_LOOK's smell/touch pos colour, set once per button. */
.vc-pair-layer-smell { --lc: 140, 230, 160; }
.vc-pair-layer-touch { --lc: 89, 187, 251; }
.vc-pair-layer[aria-checked="true"] {
  border-color: rgb(var(--lc)); box-shadow: inset 0 0 0 1px rgb(var(--lc)), 0 0 18px -8px rgb(var(--lc));
  background: rgba(var(--lc), 0.06);
}
.vc-pair-layer[aria-checked="true"] b { color: rgb(var(--lc)); }
.vc-pair-label {
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.16em; text-transform: uppercase; color: rgba(255, 255, 255, 0.45);
  margin: 10px 0 6px;
}

.vc-own-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 4px; }
.vc-own { display: grid; justify-items: center; gap: 4px; padding: 8px 4px 6px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 6px; }
.vc-own-code { font: 500 11px/1 ${FONT_MONO}; }
.vc-own-val { font: 400 10.5px/1.25 ${FONT_MONO}; color: rgba(255, 255, 255, 0.6); text-align: center; }
.vc-own-note { margin: 0 0 10px; font-size: 12px; color: rgba(255, 255, 255, 0.4); padding: 8px 10px; border: 1px dashed rgba(255, 255, 255, 0.14); border-radius: 6px; }
/* Vertical version of a pad axis's slider grammar (--c is the strain's colour, set on .vc-own). */
.vc-vfader { position: relative; width: 26px; height: 92px; margin: 0 auto; touch-action: none; cursor: pointer; outline: none; }
.vc-vfader:focus-visible { outline: 1px solid ${SCENE_VIOLET}; outline-offset: 3px; }
.vc-vfader-track {
  position: absolute; left: 11px; width: 4px; top: 0; bottom: 0; border-radius: 2px;
  background: linear-gradient(0deg, rgba(239, 106, 106, 0.55), rgba(239, 106, 106, 0.14) 42%, rgba(255, 255, 255, 0.14) 50%, rgba(140, 230, 160, 0.14) 58%, rgba(140, 230, 160, 0.55));
}
.vc-vfader-fill { position: absolute; left: 11px; width: 4px; border-radius: 2px; background: var(--c, ${SCENE_VIOLET}); opacity: 0.7; }
.vc-vfader-thumb {
  position: absolute; left: 5px; width: 16px; height: 16px; margin: 0 0 -8px 0; border-radius: 50%;
  background: #0b0f10; border: 2px solid var(--c, ${SCENE_VIOLET}); box-shadow: 0 0 12px -2px var(--c, ${SCENE_VIOLET});
}

.vc-pair-status { min-height: 2.6em; margin: 0 0 10px; font-size: 12.5px; color: rgba(255, 255, 255, 0.6); }

.vc-pads { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; margin-bottom: 12px; }
.vc-pad { display: grid; gap: 5px; }
.vc-pad-head { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font: 400 11px/1 ${FONT_MONO}; }
.vc-pad-body { display: grid; grid-template-columns: 13px minmax(0, 1fr); gap: 3px; }
.vc-pad-xcap, .vc-pad-ycap {
  display: flex; gap: 6px; font: 400 9.5px/1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.4); white-space: nowrap; overflow: hidden;
}
.vc-pad-ycap { writing-mode: vertical-rl; transform: rotate(180deg); justify-content: space-between; }
.vc-pad-xcap { grid-column: 2; justify-content: space-between; }
.vc-pad-sign { font-size: 9.5px; line-height: 1; color: rgba(255, 255, 255, 0.55); }
.vc-pad-sq {
  position: relative; grid-column: 2; aspect-ratio: 1; border-radius: 6px; overflow: hidden; background: #000;
  border: 1px solid rgba(255, 255, 255, 0.12); touch-action: none; cursor: crosshair;
}
.vc-pad-sq:focus-visible { outline: 2px solid ${SCENE_VIOLET}; outline-offset: 2px; }
/* Letting go of a drag shows the settled result at once (pairPads.ts "Clearer pads"). */
.vc-pad-sq.vc-pad-settled { border-color: ${SCENE_VIOLET}; box-shadow: 0 0 0 1px ${SCENE_VIOLET}, 0 0 14px color-mix(in srgb, ${SCENE_VIOLET} 55%, transparent); }
@media (prefers-reduced-motion: no-preference) {
  .vc-pad-sq { transition: box-shadow 0.25s ease, border-color 0.25s ease; }
}
/* A pointer press focuses the pad/fader for its keys without the ring (pointerFocus). */
.vc-pad-sq.vc-pf:focus-visible, .vc-vfader.vc-pf:focus-visible { outline: none; }
.vc-pad-canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0.85; }
.vc-pad-sq svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.vc-pad-axis { stroke: rgba(255, 255, 255, 0.2); vector-effect: non-scaling-stroke; }
.vc-pad-tick { stroke: rgba(255, 255, 255, 0.3); vector-effect: non-scaling-stroke; }
.vc-pad-guide { stroke: rgba(255, 255, 255, 0.35); stroke-dasharray: 2 2; vector-effect: non-scaling-stroke; }
.vc-pad-corner { font: 6.2px ${FONT_MONO}; fill: rgba(255, 255, 255, 0.45); letter-spacing: 0.06em; }
.vc-pad-ring { vector-effect: non-scaling-stroke; }
.vc-pad-ring-white { stroke: rgba(255, 255, 255, 0.9); stroke-width: 1.1; vector-effect: non-scaling-stroke; }
.vc-pad-beh { color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Corner pictures on a Smell pad: HTML, not the stretched svg, to keep their
 * proportions. No z-index: DOM order keeps them over the culture, under the marker. */
.vc-pad-ic {
  position: absolute; display: flex; padding: 2px 3px; border-radius: 4px; background: rgba(0, 0, 0, 0.55);
  opacity: 0.7; pointer-events: none; transition: opacity 0.15s ease;
}
.vc-pad-ic svg { width: 22px; height: 12px; display: block; }
.vc-pad-sq:hover .vc-pad-ic { opacity: 1; }
.vc-pad-ic-tl { top: 4px; left: 4px; }
.vc-pad-ic-tr { top: 4px; right: 4px; }
.vc-pad-ic-bl { bottom: 4px; left: 4px; }
.vc-pad-ic-br { bottom: 4px; right: 4px; }

/* The cursor hint on a pad (pairPads.ts): above the panel and its tooltips. */
.vc-pad-hint {
  position: fixed; z-index: 45; pointer-events: none; max-width: 280px;
  background: rgba(8, 11, 10, 0.94); border: 1px solid rgba(255, 255, 255, 0.24); border-radius: 8px;
  padding: 7px 9px; font: 400 12px/1.5 ${FONT_MONO}; color: #fff; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
}
.vc-pad-hint[hidden] { display: none; }
.vc-pad-hint-ln { display: flex; justify-content: space-between; gap: 12px; white-space: nowrap; }
.vc-pad-hint-v { color: rgba(255, 255, 255, 0.5); }
.vc-pad-hint-note {
  margin-top: 5px; padding-top: 5px; border-top: 1px solid rgba(255, 255, 255, 0.18);
  font: 400 11.5px/1.35 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.75); white-space: normal;
}

/* Mix row (pairPads.ts, "The mix row"): Back starts disabled (empty history); Keep own
 * trails toggles via aria-pressed, violet like a pressed .vc-exp-pill below. */
.vc-mix-row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.vc-mix-row button {
  font: 400 11px/1 ${FONT_MONO}; letter-spacing: 0.05em; text-transform: uppercase; color: rgba(255, 255, 255, 0.7);
  background: transparent; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px; padding: 6px 10px; cursor: pointer;
}
.vc-mix-row button:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
.vc-mix-row button:disabled { color: rgba(255, 255, 255, 0.25); border-color: rgba(255, 255, 255, 0.1); cursor: not-allowed; }
.vc-mix-row button[aria-pressed="true"] { color: ${SCENE_VIOLET}; border-color: ${SCENE_VIOLET}; }

.vc-exp-pills { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.vc-exp-pill {
  border: 1px solid rgba(255, 255, 255, 0.18); background: transparent; border-radius: 12px; padding: 4px 10px;
  font: 500 11px/1 ${FONT_LABEL}; letter-spacing: 0.04em; color: rgba(255, 255, 255, 0.7); cursor: pointer;
}
.vc-exp-pill:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
.vc-exp-pill[aria-pressed="true"] { color: ${SCENE_VIOLET}; border-color: ${SCENE_VIOLET}; }
.vc-exp-hyp { margin: 6px 0 0; width: 100%; color: rgba(255, 255, 255, 0.4); font-size: 11.5px; }

/* Mode ladder (modeLadder.ts). --vc-ladder-name is the plate's longest figure name, in ch. */
.vc-ladder-list { position: relative; display: grid; gap: 1px; max-height: 340px; overflow-y: auto; overscroll-behavior: contain; padding-right: 2px; }
.vc-ladder-row {
  display: grid; grid-template-columns: 22px var(--vc-ladder-name, 7ch) minmax(0, 1fr) 46px; align-items: center; gap: 7px;
  width: 100%; min-width: 0; padding: 2px 4px; border: 1px solid transparent; border-radius: 5px; background: transparent;
  font: 400 11px/1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.8); text-align: left; cursor: pointer;
}
.vc-ladder-row:hover { border-color: rgba(255, 255, 255, 0.18); }
.vc-ladder-row:focus-visible { outline: 2px solid ${SCENE_VIOLET}; outline-offset: 1px; }
.vc-ladder-row canvas { width: 22px; height: 22px; display: block; border-radius: 3px; background: rgba(0, 0, 0, 0.35); }
.vc-ladder-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.vc-ladder-track { position: relative; height: 7px; border-radius: 2px; background: rgba(0, 0, 0, 0.4); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); overflow: hidden; }
.vc-ladder-fill { position: absolute; inset: 0; transform-origin: left center; transform: scaleX(0); background: rgba(255, 255, 255, 0.35); }
.vc-ladder-tag { display: flex; justify-content: flex-end; color: rgba(255, 255, 255, 0.5); white-space: nowrap; font-variant-numeric: tabular-nums; }
.vc-ladder-row[data-on="lead"] { background: ${withAlpha(SCENE_VIOLET, 0.16)}; }
.vc-ladder-row[data-on="lead"] .vc-ladder-fill { background: ${SCENE_VIOLET}; }
.vc-ladder-row[data-on="lead"] .vc-ladder-tag { color: ${SCENE_VIOLET}; }
.vc-ladder-row[data-on="on"] .vc-ladder-fill { background: ${withAlpha(SCENE_VIOLET, 0.55)}; }
.vc-ladder-row[data-on="on"] .vc-ladder-tag { color: rgba(255, 255, 255, 0.85); }
.vc-ladder-row[aria-pressed="true"] { border-color: ${SCENE_VIOLET}; }
.vc-ladder-row[aria-pressed="true"] .vc-ladder-tag { color: ${SCENE_VIOLET}; }
.vc-ladder-readout { margin-top: 6px; font: 400 11px/1.4 ${FONT_MONO}; color: rgba(255, 255, 255, 0.6); font-variant-numeric: tabular-nums; }
`;

/** Installs the panel's stylesheet once; safe to call from every creator. */
export function ensureControlsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}
