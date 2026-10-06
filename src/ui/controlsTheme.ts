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

/** Mic input gain — Sensitivity/Expansion/Smoothing and the live level wash. */
export const INPUT_GREEN = "#8ce6a0";
/** This scene's own look — its declared settings. */
export const SCENE_VIOLET = "#c3a5f9";
/** The band fader bank — how hard each part of the spectrum drives the visuals. */
export const BANDS_AMBER = "#f9b96c";
/** A fader that's been pulled all the way down to Off (spectrumStrip.ts, bandFaders.ts). */
export const FADER_OFF = "#f08a8a";
/** The global auto system — strength knob and master switch. */
export const AUTO_SKY = "#59bbfb";
/** Energy saving mode — the governor's Auto/On/Off override and its status
 *  readouts (src/ui/powerCard.ts). */
export const POWER_TEAL = "#4dd4c0";

/** Colours for a scene setting's `family` (sceneSettings.ts) — each family's
 *  rows take one in place of SCENE_VIOLET as their own accent — handed out
 *  in this order as each scene's families first appear (deviceMenu.ts's
 *  renderSceneSettings), wrapping past the end for a scene with more
 *  families than colours. Chosen to stay clear of the card accents above
 *  (SCENE_VIOLET etc.) and of the drive-source colours (driveSources.ts) —
 *  a family colour and a drive port/cable are two different things on the same
 *  row and must never be mistaken for each other. */
export const FAMILY_ACCENTS = ["#8ea2ff", "#f28bd0", "#c9e26b"] as const;

/** Spectrum strip bar tints, one step darker than the card accents they echo. */
export const STRIP_LOW = "#89e29d";
export const STRIP_MID = "#c0a2f5";
export const STRIP_HIGH = "#f6b15b";
/** The "audio is flowing" dot in the spectrum card header. */
export const LIVE_DOT = "#83dc97";
/** The warning ramp: the Input card's level wash as it nears clipping, and
 *  the meters' clip/drop flashes (src/ui/audioMeters.ts). yellow-500 / red-500. */
export const HOT_YELLOW = "#eab308";
export const HOT_RED = "#ef4444";

export const FONT_LABEL = "'Chakra Petch', system-ui, sans-serif";
export const FONT_MONO = "'Share Tech Mono', ui-monospace, monospace";
export const FONT_DIGITS = `'DSEG7-Classic', ${FONT_MONO}`;

/** In the wide layout the meters column (`.vc-spectrum-col`) docks to the
 *  screen's left edge; Power (`.vc-power-col`) sits immediately left of the
 *  settings column (`.vc-controls-col`), both anchored to the right edge —
 *  see `.vc-root`/`.vc-spectrum-col`/`.vc-controls-col` below. The visual
 *  shows in the open middle, with the patch bay's cables
 *  (src/ui/cableLayer.ts) sweeping left-to-right across it. No longer an
 *  actual CSS margin (the meters side is independently positioned, not an
 *  adjacent flex sibling of the settings side); this constant now only
 *  sizes STACK_BELOW_PX below — the minimum gap the two docked sides must
 *  keep between them before there's no room left for a cable to sweep
 *  through and the panel falls back to one stacked column. */
export const CABLE_GUTTER_PX = 56;

/** Below this viewport width the panel's columns stack into one. Sized for
 *  Power + Bands + controls side by side (~899px plus gaps) plus
 *  CABLE_GUTTER_PX as the minimum gap to preserve between the docked meters
 *  column and the docked Power+settings side in the wide layout — see the
 *  stacked media query below for how Power folds into that single column. */
export const STACK_BELOW_PX = 940 + CABLE_GUTTER_PX;

/** The folded Power card's side, in the wide layout (powerCard.ts) — a
 *  notch under a folded card's title bar (FOLDED_BAR_PX), so it reads as a
 *  button rather than a card. */
export const POWER_SQUARE_PX = 26;
/** A folded card's title-bar height; the Auto master bar (deviceMenu.ts)
 *  is set to it so it sits in the same register as the cards below it. */
export const FOLDED_BAR_PX = 32;

/** `#rrggbb` + alpha in [0,1] -> `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

// Glass: the panel's surfaces either blur the scene behind them (lighter tint,
// the default) or sit on a darker flat tint with no filter. Both are CSS
// custom properties set from the `vc-glass-blur` class on <html> (the
// stylesheet below; the preference is src/ui/glassPref.ts, which also holds
// what the blur costs): a backdrop-filter re-processes the WebGL canvas
// behind it every frame, so it is a real GPU cost.
// Every glass surface takes both properties inline — GLASS_BG for the
// `background`, GLASS_FILTER for the (-webkit-)backdrop-filter — so the
// switch is one class toggle.
export const GLASS_BG = "var(--vc-glass-bg)";
export const GLASS_FILTER = "var(--vc-glass-filter)";
export const glassCardStyle = `
  position: relative; overflow: hidden;
  background: ${GLASS_BG};
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
:root {
  --vc-glass-bg: rgba(8, 11, 10, 0.82);
  --vc-glass-filter: none;
}
:root.vc-glass-blur {
  --vc-glass-bg: rgba(8, 11, 10, 0.2);
  --vc-glass-filter: blur(20px) saturate(.6) brightness(.5) contrast(1.08);
}
@font-face {
  font-family: 'DSEG7-Classic';
  src: url(${dseg7Url}) format('woff2');
  font-weight: 400; font-style: normal; font-display: swap;
}

/* Anchored top-right — Power (.vc-power-col) then the settings column
 * (.vc-controls-col), the same flex row as always. The meters side
 * (.vc-spectrum-col) is a DOM child of .vc-cols-wrap below (so
 * deviceMenu.ts's onDocPointerDown's root.contains(target) still sees it as
 * "inside the panel") but docks itself independently to the opposite
 * (top-left) corner of the screen in the wide layout — see .vc-spectrum-col
 * below. Both sides stop short of the bottom-right chrome buttons
 * (index.html) so the gear that closes the panel stays reachable.
 *
 * pointer-events: none plus "> *" restoring auto on direct children: a flex
 * row's own box is always as tall as its tallest child (align-items can't
 * shrink the container, only stop shorter children from stretching to match
 * it), so when one side folds short next to a tall neighbor, the row's own
 * box still covers the gap beside the short side. Left catching clicks,
 * that gap would count as "inside" for deviceMenu.ts's onDocPointerDown
 * (root.contains(target)) and swallow a click meant for the scene.
 * Disabling pointer events on the row itself and re-enabling them on its
 * children (their own boxes correctly hug their real content) lets a click
 * in the gap fall through to whatever's actually behind it. Same reasoning
 * applies to .vc-cols-wrap below. (.vc-spectrum-col, being independently
 * position: fixed, contributes no box to .vc-cols-wrap's own sizing at all
 * in the wide layout, so that row ends up hugging .vc-power-col alone —
 * harmless, the mechanism still costs nothing to leave in place.) */
.vc-root {
  position: fixed; top: 16px; right: 16px; z-index: 30;
  display: none; gap: 4px; align-items: flex-start;
  max-height: calc(100vh - 74px);
  color: #fff; font-family: ${FONT_LABEL};
  pointer-events: none;
}
.vc-root.vc-open { display: flex; }
.vc-root > * { pointer-events: auto; }
/* Power (src/ui/powerCard.ts): energy saving's Auto/On/Off override and its
 * status readouts — one compact card, not a scrolling stack, so this column
 * is narrower than .vc-spectrum-col. Sits inside .vc-cols-wrap immediately
 * left of the settings column (.vc-controls-col, below), on the screen's
 * right edge. Open, its card is 200px wide (the wide-layout media query
 * below); folded, the card itself shrinks to a POWER_SQUARE_PX square (see
 * that constant's own comment) and this column hugs it — width: auto in
 * that same media query, overridden below. */
.vc-power-col {
  width: 200px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 74px);
}
.vc-power-col > * { flex-shrink: 0; }
/* The power glyph button shown only while the card is folded (in the wide
 * layout — see the media query below); stacked, Power folds to a plain
 * title bar like every other card, so this never shows there. */
.vc-power-square { display: none; }
/* The meters side. In the wide layout (the base rules here) it docks to the
 * screen's own top-left corner, independently of .vc-root's top-right
 * anchor — see .vc-root's own comment above for why that's safe for
 * onDocPointerDown despite the two no longer being layout siblings. The
 * stacked media query below dissolves it into root's own single column
 * (display: contents), which also neutralizes position: fixed here since
 * a display: contents element generates no box of its own to position. The
 * bands block (deviceMenu.ts's .vc-bands-block — the column head, its
 * "Sound" heading and the Bands card, travelling together as one
 * .vc-spectrum-card) stays put; the meters (src/ui/audioMeters.ts) scroll in
 * their own strip beneath it. Its top clears index.html's #sceneNav (the
 * "‹ Gallery" chip row, 36px tall at top:16px, which shares this corner)
 * by an 8px gap rather than covering it. */
.vc-spectrum-col {
  width: 377px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 76px);
  position: fixed; top: 60px; left: 16px; z-index: 30;
}
.vc-spectrum-col > * { flex-shrink: 0; }
.vc-spectrum-col > .vc-meters { flex-shrink: 1; min-height: 0; overflow-y: auto; }
.vc-meters { display: flex; flex-direction: column; gap: 4px; }
.vc-meters > * { flex-shrink: 0; }
.vc-controls-col {
  width: 314px; flex: none; display: flex; flex-direction: column; gap: 4px;
  max-height: calc(100vh - 74px); overflow-y: auto;
}
/* Solo (deviceMenu.ts's setSolo/applySolo): the column takes its full
 * height and what's left in it sits at the bottom, just above the footer
 * (wide layout only — stacked, the whole panel is one scroller) —
 * an auto top margin rather than justify-content: flex-end, which would
 * make an overflowing pane's top unreachable by scrolling. */
@media (min-width: ${STACK_BELOW_PX + 1}px) {
  .vc-root.vc-solo .vc-controls-col { height: calc(100vh - 74px); }
  .vc-root.vc-solo .vc-controls-col > :not(.vc-solo-hidden):not(.vc-dock) { margin-top: auto; }
}
/* Cards scroll past the column's edge rather than squashing to fit it. */
.vc-controls-col > * { flex-shrink: 0; }
/* Power folds to a small square (POWER_SQUARE_PX) instead of a full-width
 * title bar, in the wide layout only (see powerCard.ts's own header for why:
 * it sits against the settings column, so growing leftward on unfold keeps
 * that column still, and the animation needs the card's content laid out at
 * full width throughout — never reflowing — so it can be clipped instead of
 * resized). .vc-power-col hugs the card rather than reserving the full 200px
 * so the square doesn't leave a blank gap next to it. */
@media (min-width: ${STACK_BELOW_PX + 1}px) {
  .vc-power-col { width: auto; align-items: flex-end; }
  /* flex-end (not stretch) means a narrower-than-200px card overflows its
   * fixed-width pad on the LEFT — clipped by the card's own overflow: hidden
   * (glassCardStyle) — so the pad's content stays exactly where it was on
   * screen instead of sliding to follow the card's shrinking left edge. */
  .vc-power-card {
    box-sizing: border-box; width: 200px;
    display: flex; justify-content: flex-end; align-items: flex-start;
  }
  /* The card's own 1px border eats into its 200px box; 198px keeps the pad's
   * padding identical to the pre-fold-square layout. flex: none so it never
   * shrinks to make room for the square button below (that button is
   * absolutely positioned and takes no flex space, but the pad must not
   * shrink to less than its own written width just because it can). */
  .vc-power-card > .vc-card-pad { flex: none; width: 198px; box-sizing: border-box; }
  .vc-power-card.vc-folded { width: ${POWER_SQUARE_PX}px; height: ${POWER_SQUARE_PX}px; }
  /* Hidden rather than removed: the pad's content stays laid out at full
   * width underneath so nothing needs to reflow when the square unfolds. */
  .vc-power-card.vc-folded > .vc-card-pad { visibility: hidden; }
  /* Pinned to the card's right edge at the folded square's own inner size
   * (inside the 1px border), not inset: 0 — so the glyph stays put while the
   * card opens and closes around it (powerCard.ts's foldTransition). */
  .vc-power-square {
    display: grid; place-items: center; position: absolute; z-index: 1;
    top: 0; right: 0; width: ${POWER_SQUARE_PX - 2}px; height: ${POWER_SQUARE_PX - 2}px;
    padding: 0; margin: 0; background: transparent; border: 0; cursor: pointer;
    color: ${POWER_TEAL}; opacity: 0; visibility: hidden; pointer-events: none;
    transition: color 0.15s ease;
  }
  .vc-power-card.vc-folded > .vc-power-square { opacity: 1; visibility: visible; pointer-events: auto; }
  .vc-power-square:hover, .vc-power-square:focus-visible { color: #fff; }
  .vc-power-square:focus-visible { outline: none; filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.7)); }
}
/* Power + the settings column travel together in .vc-root's own flex row;
 * .vc-cols-wrap here is Power's own wrapper (the meters column left it for
 * an independent dock above, leaving this holding just the fold toggle and
 * Power) — kept as a wrapper rather than flattened away so the fold-all
 * triangle below still has one place to hide/reveal both itself and Power
 * as a unit. Once every card in Power AND the (now independently docked)
 * meters column is folded, there's nothing left to show but a stack of
 * title bars, so vc-cols-folded collapses this wrapper down to one small
 * triangle that reopens everything — see refreshColumnsFold (deviceMenu.ts)
 * for why the meters column being elsewhere on screen doesn't stop it
 * counting toward that check. Scoped to this wrapper's direct children so a
 * lone folded card (the common case) never triggers it. */
/* align-items: flex-start keeps a folded (short) column from stretching to
 * match its taller neighbor; pointer-events here follows .vc-root's rule
 * above, for the same reason — this row's own box is still as tall as
 * whichever column is tallest, so it needs to let clicks in the gap beside
 * a short column pass through rather than swallowing them as "inside". */
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
  /* pointer-events: auto here undoes the base rule's none. Stacked, every
   * child is width: 100%, so the root's box has no gap beside a short child
   * for a click to fall through — and the root is now the element that
   * scrolls. iOS WebKit won't touch-scroll a scroller whose own box has
   * pointer-events: none, even when the finger lands on an auto child, so
   * leaving the base rule in place made the whole panel unscrollable on
   * iPhone. 100dvh follows Safari's collapsing toolbar (a plain 100vh is
   * the taller, toolbar-hidden height, so the panel's tail — and the end of
   * its scroll range — hid under the toolbar); browsers without dvh keep
   * the vh line. */
  .vc-root {
    flex-direction: column; width: min(320px, 88vw); overflow-y: auto;
    pointer-events: auto;
    max-height: calc(100vh - 74px);
    max-height: calc(100dvh - 74px);
  }
  .vc-root > *, .vc-spectrum-col > * { flex-shrink: 0; }
  /* Dissolve the spectrum column so its bands block (.vc-spectrum-card —
   * see the comment above .vc-spectrum-col) and the meters become root
   * items in their own right: spectrum, then the controls, then the meters
   * last — a phone shouldn't have to scroll past a screen of readouts to
   * reach a slider. */
  .vc-spectrum-col { display: contents; }
  .vc-power-col, .vc-spectrum-card, .vc-controls-col { width: 100%; max-height: none; overflow: visible; }
  .vc-spectrum-col > .vc-meters { width: 100%; order: 1; max-height: none; overflow: visible; }
  /* The horizontal triangle-collapse only makes sense beside other columns;
   * a single stacked mobile column has nothing to shrink next to, so
   * dissolve the wrapper the same way .vc-spectrum-col dissolves above and
   * undo vc-cols-folded's hiding — per-card folding still applies normally.
   * Same selectors and specificity as the base rules above, so this wins
   * only because it comes later in the stylesheet while the media query
   * is active. */
  .vc-cols-wrap { display: contents; }
  .vc-cols-wrap.vc-cols-folded > .vc-power-col { display: block; }
  .vc-cols-wrap.vc-cols-folded > .vc-spectrum-col { display: contents; }
  .vc-cols-wrap.vc-cols-folded > .vc-cols-toggle { display: none; }
}

/* A card's header/body split (controlsKit.ts's createCard): the header's
 * margin-bottom and the pad's padding live here, not in the inline cssText
 * the pad/header otherwise carry, so .vc-folded below can tighten them — an
 * inline style would win over a class rule and the collapse would leave a
 * gap. Folded, the pad is padded evenly top and bottom so the title bar
 * sits centred in what's left, and the right-hand slot (a Reset/RAW chip,
 * with nothing to act on) goes with the body. */
.vc-card-head { margin-bottom: 9px; }
.vc-card-pad { padding: 10px 12px 12px; }
.vc-card.vc-folded .vc-card-head { margin-bottom: 0; }
.vc-card.vc-folded .vc-card-pad { padding: 9px 12px; }
.vc-card.vc-folded .vc-card-body { display: none; }
/* !important: the slot arrives with an inline display (rowRightStyle's
 * flex) that would otherwise win over this rule. */
.vc-card.vc-folded .vc-card-right { display: none !important; }

/* The collapse chevron at the end of a foldId'd card's header: a bordered
 * corner turned to point down (open) or right (folded), drawn rather than a
 * glyph so it's the same crisp stroke as the chip borders around it. The
 * button box is bigger than the stroke for a comfortable target. */
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

/* The whole meters column (Bands + the meters strip) hidden by the footer's
 * "Hide left" button / M (deviceMenu.ts). Outranks the stacked layout's
 * display: contents below on specificity, so it holds there too. */
.vc-root.vc-meters-hidden .vc-spectrum-col { display: none; }
/* Solo (deviceMenu.ts's applySolo): everything off the paths from the
 * Scene card and the dock up to the root. !important to beat the inline
 * and display: contents rules those elements carry in either layout. */
.vc-solo-hidden { display: none !important; }

/* The footer and the keys list above it, stuck to the bottom of the
 * controls column so its buttons never scroll out of sight — in the stacked
 * layout, to the bottom of the screen for as long as the controls last. */
.vc-dock { position: sticky; bottom: 0; z-index: 2; display: flex; flex-direction: column; }

/* keyHints.ts's hover badge, hold-to-reveal keycaps, and the interactive
 * keys list below (deviceMenu.ts's keysCard, one row per keyHints.ts's
 * SHORTCUTS entry).
 *
 * A keys-list row's hover/click echo on every live control it names
 * (deviceMenu.ts's flashOn/clearFlash) — an outline plus one short pulse;
 * no pointer-events rule needed since this only ever adds a class, never
 * touches display or position. */
.vc-key-flash { outline: 1px solid #fff; animation: vc-key-flash-pulse 0.5s ease-out; }
@keyframes vc-key-flash-pulse {
  from { box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.35); }
  to { box-shadow: 0 0 0 5px rgba(255, 255, 255, 0); }
}

/* Holding Shift (keyHints.ts's hold-to-reveal) shows every tagged
 * control's own keycap at once — content is the key itself (data-keycap),
 * so nothing here needs to know what any of them say. .vc-keycap-anchor
 * opts a normally-static control (a footer button, a row's A/T/↺ chip)
 * into being its own keycap's positioning context; a control that's
 * already positioned (index.html's #menuBtn/#fsBtn, both position: fixed)
 * skips that class — adding position: relative there would fight the
 * fixed rule via this rule's own higher specificity (two classes beat one),
 * and fixed already anchors an ::after just fine on its own. The
 * .vc-block digit badge (deviceMenu.ts's markBlock) carries data-key but
 * never data-keycap — see keyHints.ts's header — so it never grows one. */
.vc-keycap-anchor { position: relative; }
body.vc-keys-reveal [data-keycap]::after {
  content: attr(data-keycap); position: absolute; top: -7px; right: -7px;
  min-width: 14px; height: 13px; padding: 0 2px; border-radius: 3px;
  background: rgba(8, 11, 10, 0.94); border: 1px solid rgba(255, 255, 255, 0.75);
  color: #fff; font: 600 8.5px/13px ${FONT_MONO}; text-align: center;
  pointer-events: none; z-index: 41;
}

/* The keys list itself. Each keyHints.ts SHORTCUTS entry is a full-width
 * row button (key cap + hint), not a plain two-column definition list, so
 * it can double as deviceMenu.ts's own click/hover target — the row either
 * performs its shortcut directly or just flashes every control it names,
 * depending on whether that's a single action (wireKeysRow). */
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
/* MIDI learn (midiCard.ts): while a session is on, every row a controller can
 * be mapped to shows a dashed edge and a pointing cursor, and the row picked
 * for the next knob keeps a solid one. */
.vc-midi-learning [data-midi-row] { outline: 1px dashed color-mix(in srgb, var(--vc-accent) 70%, transparent); outline-offset: 1px; cursor: crosshair; }
.vc-midi-learning [data-midi-row] * { cursor: crosshair; }
.vc-midi-learning [data-midi-row].vc-midi-picked { outline: 2px solid var(--vc-accent); }
.vc-row:hover, .vc-row:focus-within {
  background-color: color-mix(in srgb, var(--vc-accent) 6%, transparent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--vc-accent) 45%, transparent),
    0 0 14px color-mix(in srgb, var(--vc-accent) 22%, transparent);
}
/* One input in the Source row's list (deviceMenu.ts's buildRow) lights up
 * under the pointer, inside the whole row's own glow above. Box-shadow and
 * filter only: the input's border and background are inline styles its
 * refresh() rewrites per state (live, dashed, hidden), and an inline style
 * beats any rule here. Off where hover can't be meant (touch: it would stick
 * after a tap). */
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
.vc-hint {
  max-height: 0; opacity: 0; overflow: hidden; margin-top: 0;
  transition: max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
  font: 400 11px/1.5 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.65);
}
.vc-row:hover .vc-hint, .vc-row:focus-within .vc-hint { max-height: 120px; opacity: 1; margin-top: 5px; }
/* The auto takeover line under a slider's description (deviceMenu.ts,
 * AUTO_HOLDING_HINT) — a second line in the auto system's colour, shown only
 * while auto holds the row, so the description above it stays readable. */
.vc-hint-auto { color: ${withAlpha(AUTO_SKY, 0.85)}; }
/* The short line before a colour word in any hint (hintSwatches.ts),
 * drawn like a meter trace: a thin stroke in the colour (set as its color on
 * the element) with a soft glow of itself. The word and its line never
 * wrap apart; the faint ring keeps a black line visible on the dark panel. */
.vc-swatch-word { white-space: nowrap; }
.vc-swatch {
  display: inline-block; width: 1.1em; height: 2px; margin-right: 0.3em;
  border-radius: 1px; vertical-align: 0.3em; background: currentColor;
  box-shadow: 0 0 4px currentColor, 0 0 0 0.5px rgba(255, 255, 255, 0.25);
}
.vc-swatch-bare .vc-swatch { margin: 0 0.1em; }

/* A row's "reacts to" strip (controlsKit.ts's createSignalStrip) — a sibling
 * of .vc-hint above, not nested inside it, so the two reveal independently:
 * while auto owns the row, deviceMenu.ts adds its takeover line inside the
 * hint (AUTO_HOLDING_HINT) but never touches this element, so the pills stay put.
 * Reveals on hover/focus like the hint, or pinned open by its own head chip
 * (.vc-reads-open, toggled on click) regardless of hover state. */
.vc-reads {
  max-height: 0; opacity: 0; overflow: hidden; margin-top: 0;
  transition: max-height 0.18s ease, opacity 0.18s ease, margin-top 0.18s ease;
}
.vc-row:hover .vc-reads, .vc-row:focus-within .vc-reads, .vc-reads.vc-reads-open {
  max-height: 60px; opacity: 1; margin-top: 6px;
}

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
/* A .vc-slider outside a .vc-row (the patch bay's own weight controls,
 * deviceMenu.ts's buildWeightSlider) has no :focus-within ancestor to
 * supply the scale/glow above, so give it a plain ring directly instead —
 * keyboard focus stays visible wherever a .vc-slider lives. Harmless
 * layered on top of a .vc-row slider's own effect too. */
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

/* A row muted by its T chip (deviceMenu.ts's createControlRow): the thumb
 * stays on the value a second T restores, so the track greys out and the
 * thumb turns FADER_OFF — "off, and this is where it comes back to" — while
 * an auto-held row keeps its accent. */
.vc-row-off .vc-slider { --vc-accent: rgba(255, 255, 255, 0.28); }
.vc-row-off .vc-slider::-webkit-slider-thumb { background: ${FADER_OFF}; }
.vc-row-off .vc-slider::-moz-range-thumb { background: ${FADER_OFF}; }

/* A linked-item divergent-value tick (deviceMenu.ts's createControlRow,
 * ControlRowSpec.linkedTicks — itemBoxes.ts's multi-selection, 2026-09-27):
 * the wrapper sits directly around the slider it belongs to (sized to it
 * exactly, nothing else in that box), so a tick's own left-offset percentage
 * (createControlRow's valueToPercent) lands at the same spot on the track a
 * drag to that value would. Pointer-events: none throughout — a tick is a
 * readout, never a second handle. */
.vc-slider-ticks { position: absolute; inset: 0; pointer-events: none; }
.vc-slider-tick {
  position: absolute; top: 50%; width: 2px; height: 12px;
  transform: translate(-50%, -50%); border-radius: 1px;
  background: var(--c, rgba(255, 255, 255, 0.85));
  box-shadow: 0 0 3px var(--c, rgba(255, 255, 255, 0.6));
}

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

/* An enum setting's chip strip (deviceMenu.ts createPickerRow): the strip is
 * the focusable ring stop, so it rings as a whole rather than chip by chip. */
.vc-picker { outline: none; border-radius: 4px; margin-top: 6px; }
.vc-picker:focus-visible {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vc-accent) 70%, transparent);
}

/* The patch bay (deviceMenu.ts): a drive row's input port and the row's own
 * pinned/preview highlight.
 *
 * The port's position (a 10px ring tucked into the row's top-left corner —
 * the pinned outline's — inset evenly from both edges, on the side facing
 * the meters column, which docks to the screen's own left edge — see
 * .vc-spectrum-col above) is a plain class rule rather than deviceMenu.ts's
 * own inline cssText, since drivePortStyle() (deviceMenu.ts) only ever
 * writes colour/border/box-shadow inline — the setting's own plugged
 * sources, and the ring that marks it pinned (solid, glowing) vs merely
 * previewed (a bare outline) — never anything this rule already owns.
 * left is positive, not hanging past the row into the card's
 * own padding: .vc-row's padding/negative-margin pair (below) means a more
 * negative offset here lands outside .vc-card's own overflow: hidden and
 * gets clipped invisible.
 *
 * --vc-pin-color (set by deviceMenu.ts's refreshMeta, on the row) is the
 * setting's own first plugged source's colour, or SCENE_VIOLET for a
 * "scene" mix with nothing plugged in — the same colour drivePortStyle
 * uses for the port's own glow, so a pinned/previewed row's border always
 * matches what its port is showing. Pinned gets a solid border and stays
 * visually "open"; previewed (hover/focus short of a click) gets only the
 * background tint, no border — see the row grammar in this file's own
 * header for why a click is what actually expands the patch panel. */
.vc-drive-port {
  position: absolute; left: 6px; top: 6px; width: 10px; height: 10px; border-radius: 50%;
  padding: 0; cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.vc-drive-port:hover { transform: scale(1.25); }
.vc-drive-port:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
/* The port sits tucked into the row's top-left corner (the pinned
 * outline's), inset evenly from both edges — the label and its summary
 * start just clear of it. */
.vc-drive-row-left { padding-left: 14px; }
.vc-row.vc-drive-pinned {
  background-color: color-mix(in srgb, var(--vc-pin-color, ${SCENE_VIOLET}) 8%, transparent);
  box-shadow: 0 0 0 1.5px var(--vc-pin-color, ${SCENE_VIOLET});
}
/* Solo's eye (deviceMenu.ts's positionSoloEye): fixed on <body> just
 * outside the pinned row's left edge, under its port, in the pin's colour —
 * a carved tile with an eye-shaped hole. Shut while everything shows (two
 * lids meet at a seam, shaded darker toward the hole's edge so together they
 * read as one rounded bump), lids drawn back (the pupil down in the dark,
 * the tile glowing) while this setting is the only thing shown — opening
 * and closing on click only. Very dim at rest so it doesn't compete with
 * the row; full strength on hover. Each lid scales toward its own edge of the hole — the
 * upper up, the lower down — so toggling reads as an eye opening and
 * blinking shut. */
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

/* A row's readout digits, typable in place (deviceMenu.ts's createControlRow
 * typed entry). They look as they always have — at rest, on hover and while
 * typing — bar the text cursor, a caret in the row's --vc-accent, and the
 * highlight on what's selected: never an input box, an underline or a
 * background. */
.vc-digits-typable { cursor: text; }
.vc-digits-edit { outline: none; caret-color: var(--vc-accent); min-width: 0.6em; }
.vc-digits-edit::selection {
  color: #fff; background: color-mix(in srgb, var(--vc-accent) 45%, transparent);
}

/* The ⚠ left of a row's number while it holds a custom value (deviceMenu.ts's
 * createControlRow, render/customValues.ts), in the row's --vc-accent. Its
 * faint glow is a blurred, thicker copy under the crisp icon, and only that
 * copy's opacity pulses: an opacity animation runs on the compositor, so it
 * repaints nothing, and it only exists while a custom value does. Reduced
 * motion holds the glow still. */
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

/* Phase 2b's jacks (src/ui/jack.ts) — a small ring a meter row or hits lane
 * mounts beside itself, coloured in its own source (driveSources.ts). Solid
 * fill when it feeds the shown (preview ?? pinned) setting; the usage dots
 * (.vc-jack-uses), around the ring, count this scene's settings that use it, always on
 * regardless of selection — see jack.ts's own header for the full split
 * between this file's classes and deviceMenu.ts's own state. */
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
/* The usage dots ring the jack itself (jack.ts's setUses/useDotLayout):
 * each dot sits at its own --a around the centre, --r out, sized --s. */
.vc-jack-uses { position: absolute; left: 50%; top: 50%; width: 0; height: 0; pointer-events: none; }
.vc-jack-uses i {
  position: absolute; left: calc(var(--s) / -2); top: calc(var(--s) / -2);
  width: var(--s); height: var(--s); border-radius: 50%; background: var(--c); opacity: 0.75;
  transform: rotate(var(--a)) translateY(calc(-1 * var(--r)));
}

/* Highlighting while a setting is previewed/pinned (deviceMenu.ts's own
 * refreshPatchHighlight/refreshBandsJacks, audioMeters.ts's
 * refreshPatchView): every meter row in the Bands+meters column dims,
 * except a row jack.ts's setRowFed marks as feeding something —
 *  - .vc-row-fed ("full"): feeds the pinned setting, and nothing else is
 *    being previewed right now. The strong glow.
 *  - .vc-row-fed-soft ("soft"): feeds the setting being previewed (a
 *    hover/focus short of a click) — always wins this glow over a
 *    competing pinned feed on the same row — or is named in a "scene"
 *    setting's own display-only sceneSources (drives.ts), never a
 *    togglable jack.
 *  - .vc-row-fed-faint ("faint"): feeds the pinned setting, but a
 *    *different* setting is being previewed elsewhere, so the pinned feed
 *    steps back to a bare mark rather than competing with what's shown.
 * A hit lane also gets its own thin glow bar (audioMeters.ts) rather than
 * relying on the whole Hits row dimming, since HITS_LANES' own lanes can
 * each feed a different setting. */
/* .vc-row-keep (the Bands card's own faders row) opts out — it's the
 * primary spectrum display, not a peripheral meter, and gets its own
 * band-range dimming instead (spectrumStrip.ts's setHighlight, wired from
 * refreshSpectrumDriveHighlight) rather than a flat opacity drop. */
.vc-spectrum-col.vc-patching .vc-row:not(.vc-row-fed):not(.vc-row-fed-soft):not(.vc-row-fed-faint):not(.vc-row-keep) { opacity: 0.45; }
.vc-row-fed, .vc-row-fed-soft, .vc-row-fed-faint {
  box-shadow: inset 0 0 0 1px var(--vc-hl, transparent), 0 0 16px color-mix(in srgb, var(--vc-hl, transparent) 20%, transparent);
}
.vc-row-fed-soft { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-hl, transparent) 45%, transparent); }
.vc-row-fed-faint { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--vc-hl, transparent) 25%, transparent); }
.vc-lane-glow {
  position: absolute; left: 0; right: 20px; pointer-events: none; border-radius: 2px;
  background: color-mix(in srgb, var(--c) 22%, transparent); opacity: 0; transition: opacity 0.15s ease;
}
.vc-lane-glow.on { opacity: 1; }

/* Hovering a jack (not a preview/pin) highlights every scene row it feeds —
 * a lighter-weight, purely transient echo of .vc-row-fed above, keyed to
 * the jack itself rather than the shown setting (deviceMenu.ts's
 * onJackHover). */
.vc-row.vc-drive-hl {
  box-shadow: 0 0 0 1px var(--vc-hl2, transparent), 0 0 14px color-mix(in srgb, var(--vc-hl2, transparent) 22%, transparent);
}

/* The cable layer (src/ui/cableLayer.ts): one fixed SVG above .vc-root
 * (z-index), covering the viewport so a cable can cross from a meter jack
 * to a scene row's port without any card's own overflow:hidden clipping
 * it. Each cable's own glow/core/flow path structure and the
 * draw-on/fade-in for a freshly plugged source are ported from the
 * prototype's own patch-bay.src.html almost verbatim.
 *
 * cableLayer.ts draws two independent groups (see its own header): the
 * pinned setting's cables, in the structure below, and the setting being
 * previewed (hover/focus short of a click)'s cables, in the flatter
 * .vc-cable-preview style further down — thin, dashed, no glow layer, no
 * flow dash of its own, since a preview never animates. .vc-cable-dimmed
 * pulls the pinned group back to a fixed opacity while a preview is also
 * on screen, so the two never visually compete for attention. */
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
/* The whole pinned group (glow+core+flow) while a preview is also drawn —
 * !important because it has to win regardless of which other cable classes
 * (.vc-cable-soft, .vc-cable-new) happen to be combined on the same path. */
.vc-cable-glow.vc-cable-dimmed, .vc-cable-core.vc-cable-dimmed, .vc-cable-flow.vc-cable-dimmed { opacity: 0.35 !important; }
/* The previewed setting's own cables — flat and quiet on purpose, so a
 * transient hover never reads as "committed" the way a pinned patch does. */
.vc-cable-preview { fill: none; stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.5; }
/* A lit signal's wires to every port it reaches (cableLayer.ts's fan
 * group) — solid where a preview is dashed, and quieter than a pinned
 * cable, since it shows where a signal goes rather than one patch. */
.vc-cable-fan { fill: none; stroke-width: 1; opacity: 0.55; animation: vc-cable-fan-in 0.15s ease-out; }
@keyframes vc-cable-fan-in { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .vc-cable-fan { animation: none; } }
/* Every one of an Only when patch's own condition sources (there can be more
 * than one now — src/render/drives.ts's own header) — a longer dash than
 * .vc-cable-soft's fine 3/3 (a scene-mix cable) and than .vc-cable-preview's
 * own 3/3, so a gate's condition reads distinctly in the cables too
 * (src/ui/deviceMenu.ts's cableGroupFor). Core only — the flow layer keeps
 * its own short running dash regardless, and the glow layer stays solid. */
.vc-cable-core.vc-cable-cond { stroke-dasharray: 9 6; }
/* A muted source's own cable (src/render/drives.ts's DriveSource.off) — one
 * flat path, no glow/flow layer at all (src/ui/cableLayer.ts's own recompute
 * skips those for a muted source outright), a longer dash still than either
 * .vc-cable-cond's 9/6 or .vc-cable-preview's 3/3 so it reads as its own,
 * quieter thing rather than a variant of either. */
.vc-cable-muted { fill: none; stroke-width: 1; stroke-dasharray: 14 8; opacity: 0.3; }
/* Pressing a cable unplugs it (src/ui/cableLayer.ts's onPress, wired by
 * src/ui/deviceMenu.ts's cableGroupFor). The layer above stays
 * pointer-events:none, so this transparent hit stroke over the cable's own
 * .vc-cable-g group is the only part that answers the pointer — its width,
 * not the visible core's, is what makes a thin cable easy to press — and
 * pressing is jack.ts-style click (its mousedown never moves focus). The
 * same stroke carries the hover lift: a neon-ish glow in the cable's own
 * colour (the group carries that colour as its CSS "color", so the
 * drop-shadow below resolves per cable via currentColor — a tight bloom
 * plus a wider halo, eased in on both), the core thicker and at full
 * opacity, the glow layer brighter and wider, the flow beads lifted
 * toward white and just wider than that core — at the resting width and
 * colour they'd sink into the thicker core and the bloom, and the cable
 * would stop showing its signal flowing exactly while it's being looked
 * at — the muted flat path brighter still. The bead lift is motion-only:
 * under reduced motion the flow layer is a solid line (see above), and
 * whitening it would just recolour the cable. Preview/scene-mix cables
 * never grow a hit stroke (no per-source press), so they stay purely
 * decorative and never light up like this. */
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

/* "Pick a setting first" — a jack clicked with nothing pinned and nothing
 * ever previewed (deviceMenu.ts's showToast). */
.vc-toast {
  position: fixed; left: 50%; bottom: 84px; transform: translate(-50%, 6px);
  background: rgba(8, 11, 10, 0.92); border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 6px;
  padding: 8px 14px; font: 400 12px/1.3 ${FONT_LABEL}; color: #fff; z-index: 32;
  opacity: 0; pointer-events: none; transition: opacity 0.18s ease, transform 0.18s ease;
}
.vc-toast-show { opacity: 1; transform: translate(-50%, 0); }

/* The instant tooltip (src/ui/tooltip.ts) for a jack, a row's own input
 * port, or a row's own sparkline — everything *outside* the pinned patch
 * panel (which gets .vc-drive-bottom-hint below instead). Styled like the
 * panel itself: small mono type, dark glass, a left rule in the hovered
 * thing's own source colour (--c, set by tooltip.ts). z-index above the
 * cable layer (31) and the toast (32) — it has to read over both. */
.vc-tooltip {
  position: fixed; z-index: 40; pointer-events: none; max-width: 230px;
  background: rgba(8, 11, 10, 0.94); border-left: 2px solid var(--c, #fff);
  border-radius: 3px; padding: 5px 8px 6px;
  font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255, 255, 255, 0.85);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}
.vc-tooltip div + div { color: rgba(255, 255, 255, 0.55); margin-top: 2px; }

/* The pinned patch panel's own bottom hint line (deviceMenu.ts's
 * buildPatchPanel) — a fixed two-line-tall strip so the panel never
 * reflows as the hint text changes length while hovering/tabbing between
 * controls. Text is written by a single delegated pointerover/pointerout/
 * focusin/focusout pair on the panel root, keyed off each control's own
 * data-hint attribute — never per-tick, never rebuilt. */
.vc-drive-bottom-hint {
  min-height: 2.6em; font: 400 11px/1.3 ${FONT_LABEL}; color: rgba(255, 255, 255, 0.6);
  padding-top: 2px; border-top: 1px solid rgba(255, 255, 255, 0.07);
}

/* The Only when patch's own condition marker (deviceMenu.ts's buildSourceLine)
 * lives in every source line's own left gutter column (driveSrcGutterStyle) —
 * a fixed-width span every line reserves whether or not it's a condition, so
 * the dashed rule never shifts a line's dots/names/controls the way a
 * border+padding on the whole line used to. Lit only on a condition line,
 * echoing the dashed condition trace in the output graph and the
 * dashed-long condition cable above. */
.vc-drive-gutter-cond { border-right: 2px dashed rgba(255, 255, 255, 0.45); }

/* The source line's own on/off switch (deviceMenu.ts's buildMuteSwitch) — a
 * compact copy of .vc-toggle's own track/knob look, deliberately not that
 * same class: .vc-toggle is this file's Tab-ring selector (deviceMenu.ts's
 * ringElements()), and a mute switch inside the pinned patch panel isn't
 * meant to join that ring. The --c custom property (the source's own
 * colour, set by buildMuteSwitch) lights the track while the source is on;
 * off falls back to a plain, unlit grey. */
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

/* A muted source line (src/render/drives.ts's DriveSource.off) dims to read
 * as "off" at a glance — except the switch itself, which stays legible so
 * it's obvious what to click to bring the source back (deviceMenu.ts's own
 * header's Muting paragraph). */
.vc-drive-src-muted > *:not(.vc-mute-switch) { opacity: 0.45; }

/* Chrome buttons (index.html) ring while their thing is active: the gear
 * while this panel is open, fullscreen while immersed. */
.iconBtn[aria-pressed="true"] { border-color: rgba(255, 255, 255, 0.5); color: #fff; }

/* The Source row's (deviceMenu.ts's createSourceRow) "nothing picked yet"
 * status line — the panel's echo of the gallery masthead's animated hint
 * (src/ui/gallery.ts's .gal-source-hint-text): a shimmer sweep instead of
 * flat dim text, so a first-time visitor gets the same nudge in both places.
 * Base colour lives here rather than in the row's own inline cssText so this
 * rule can override it — an inline color would win over any class rule. Only
 * the text shimmers, no arrow: these chips sit above the line, not beside
 * it, so there's no single direction to point. */
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

/* The Source row's status line while src/audio/inputHealth.ts reads
 * anything but ok (deviceMenu.ts's inputHealthText) — the same warning ramp
 * HOT_YELLOW/HOT_RED already stand for elsewhere (the Input card's level
 * wash as it nears clipping, the meters' clip/drop flashes). Never set at
 * the same time as [data-prompting] above — that only applies while nothing
 * is live, and a health reading only exists once something is. */
.vc-src-status[data-warn="amber"] { color: ${HOT_YELLOW}; }
.vc-src-status[data-warn="red"] { color: ${HOT_RED}; }

/* ---- src/ui/widgets/itemBoxes.ts + strainConsole.ts + pairPads.ts ----
 * A scene-declared item widget's own boxes, its Strain Console (lanes)
 * and (for a pairwise family) the Pairs pads — styled with this file's own tokens/fonts rather than a
 * widget-local stylesheet, same convention as every other panel piece.
 * Always a two-column grid, regardless of item count or panel width, so a
 * box stays wide enough for its code + placeholder swatch even in the narrow
 * (phone) stacked layout — see itemBoxes.ts's header on why Phase 3's live
 * preview lands in .vc-item-preview without a layout change. */
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
/* A live preview (Phase 3) is a <canvas> in this same slot; an item family
 * with no preview source keeps the plain sized placeholder <div> — either
 * way the box's layout is untouched. */
.vc-item-preview {
  display: block; width: 100%; aspect-ratio: 1; border-radius: 4px;
  background: color-mix(in srgb, var(--c, #fff) 10%, rgba(0, 0, 0, 0.35));
  border: 1px solid rgba(255, 255, 255, 0.08);
}
/* Phase 3's per-box readouts (POP/TERR/VIG) and the population bar +
 * Rebalance/Pipette row beneath the boxes — src/ui/widgets/itemBoxes.ts. */
.vc-item-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px; margin-top: 4px; }
.vc-item-stat { display: grid; justify-items: center; gap: 1px; font: 400 9px/1.1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.45); letter-spacing: 0.04em; }
.vc-item-stat b { color: #fff; font-weight: 400; font-size: 10.5px; font-variant-numeric: tabular-nums; }

.vc-pop-wrap { display: grid; gap: 6px; justify-items: center; margin: 4px 0 10px; }
.vc-popbar { display: flex; height: 10px; width: 100%; border-radius: 3px; overflow: hidden; background: rgba(255, 255, 255, 0.08); }
.vc-popbar span { display: block; height: 100%; transition: width 0.2s ease; }
.vc-poplabels { display: flex; flex-wrap: wrap; gap: 5px 12px; justify-content: center; font: 400 10px/1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.65); }
.vc-poplabels i { width: 7px; height: 7px; border-radius: 50%; display: inline-block; margin-right: 4px; box-shadow: 0 0 5px currentColor; }
.vc-pop-actions { display: flex; gap: 8px; }

/* The one Random under the boxes (itemBoxes.ts's header, "One Random"): a
 * full-width violet button whose die spins once per roll. */
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

/* ---- src/ui/widgets/strainConsole.ts ----
 * The Strain settings card: one row per setting with a group port, a lane
 * per strain with its own port, and a Link chip, the real setting row mounted
 * under the lanes for the last lane touched, and Stain Synergy with its hue
 * wheel. */
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
/* A lane's port and a row's group port: a stand-in with the real port's look
 * until the row is mounted, then the row's own port, moved in. */
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
/* A hue lane's rail is the strain's own hue across the Stain range. */
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
/* The console's mix row (Back / presets) and its colour row under
 * the wheel — strainConsole.ts's own header; the buttons reuse the Pairs mix
 * row's .vc-mix-row and .vc-exp-pill styles below. */
.vc-sc-mix { margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.1); }
.vc-sc-mix .vc-mix-row { margin-bottom: 8px; }
.vc-sc-syn > .vc-mix-row { grid-column: 1 / -1; margin-bottom: 0; }
.vc-sc-harmony { font: 400 9px/1.1 ${FONT_MONO}; color: rgba(255, 255, 255, 0.5); min-height: 10px; text-align: center; }
@media (prefers-reduced-motion: reduce) {
  .vc-sc-row { transition: none; }
}

/* The pipette's tap-point flash — position/left/top set inline per tap
 * (document-body-absolute so it isn't clipped by the panel's own scroll
 * container); everything else lives here so the keyframes can too. */
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
 * The Pairs widget: the Smell/Touch switch, the own-trail strip's vertical
 * faders, the six pads (a live culture canvas under an SVG overlay) and the
 * mix row/presets below them, one plain .vc-row (this file's own wake-on-
 * hover/focus + .vc-drive-pinned grammar) per section since 2026-09-28's own
 * card mount (pairPads.ts's file header, "Its own card, four rows") — no
 * rules of its own needed for that part, since every row already gets it for
 * free. Replaces the old .vc-relweb*/.vc-relrow* rules above this comment's
 * own predecessor (relationWeb.ts/relationRows.ts, deleted the same day this
 * widget landed). */
.vc-pair-layers { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin-bottom: 8px; }
.vc-pair-layer {
  display: grid; gap: 2px; text-align: left; padding: 8px 10px; cursor: pointer; font: inherit; color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px; background: rgba(255, 255, 255, 0.02);
}
.vc-pair-layer b { font: 600 13px/1.2 ${FONT_LABEL}; letter-spacing: 0.02em; }
.vc-pair-layer span { font-size: 11.5px; line-height: 1.3; color: rgba(255, 255, 255, 0.4); }
/* --lc (the layer's own accent) comes from PAIR_LOOK's smell/touch pos
 * colour, set once per button since it never changes after mount. */
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
/* The own-trail fader — a vertical version of the same slider grammar a pad
 * axis draws with (--c is the strain's own colour, set on .vc-own). */
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

/* gap 18px, up from the original 12px — the user asked for "gaps" between
 * the pads once they saw them next to the Signal/Gate cards' own airier row
 * spacing (2026-09-28). */
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
/* Letting go of a drag shows the settled result at once (pairPads.ts's
 * "Clearer pads" header): a violet ring and soft glow for a moment. */
.vc-pad-sq.vc-pad-settled { border-color: ${SCENE_VIOLET}; box-shadow: 0 0 0 1px ${SCENE_VIOLET}, 0 0 14px color-mix(in srgb, ${SCENE_VIOLET} 55%, transparent); }
@media (prefers-reduced-motion: no-preference) {
  .vc-pad-sq { transition: box-shadow 0.25s ease, border-color 0.25s ease; }
}
/* A pointer press focuses the pad/fader for its keys without the ring (pairPads.ts's pointerFocus). */
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

/* The four corner pictures on a Smell pad (apart / together / who chases whom),
 * HTML rather than part of the stretched svg so they keep their proportions.
 * No z-index: DOM order (canvas, pictures, svg) keeps them over the culture
 * and under the marker. */
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

/* The sentence by the cursor while a pad is hovered or dragged (pairPads.ts's
 * cursor hint): what each direction is set to, and the numbers. Above the
 * panel and its tooltips (z-index 40). */
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

/* Nudge / Keep own trails / Back (pairPads.ts's own header, "The mix
 * row"). Back starts disabled (an empty history) via the plain disabled
 * state; Keep own trails toggles via aria-pressed, styled the same violet
 * as a pressed .vc-exp-pill below. */
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
`;

/** Installs the panel's stylesheet once; safe to call from every creator. */
export function ensureControlsStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = stylesheet;
  document.head.appendChild(style);
}
