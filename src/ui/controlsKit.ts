import { FONT_DIGITS, FONT_LABEL, FONT_MONO, glassCardStyle, scanlineStyle } from "./controlsTheme.ts";
import { isFolded, setFolded } from "./panelFolds.ts";

/**
 * The DOM grammar the controls panel (src/ui/deviceMenu.ts) and its meters
 * (src/ui/audioMeters.ts) share: the glass card, the small bordered chip
 * button, the spacer between rows, the group heading, and the styles of a
 * row head — label · seven-segment readout + unit — that a slider row and a
 * meter row are both built on. Tokens (fonts, accents, the stylesheet) live
 * in controlsTheme.ts; this is only what's assembled from them. One owner,
 * so the meters can't drift from the panel's rows by re-typing these.
 *
 * A card opts into a persisted collapse toggle via CardSpec.foldId: a caret
 * in its header, a click anywhere on the header outside `right`, and its
 * fold state remembered in panelFolds.ts. Un-opted cards (the controls
 * column, today) are unaffected. The header's margin-bottom and the body's
 * bottom padding live in controlsTheme.ts's .vc-card-head/.vc-card-pad
 * rules rather than the inline styles below, so .vc-folded can zero them —
 * an inline style would otherwise win over that class rule.
 *
 * createAdvancedSection is the equivalent disclosure for a run of rows
 * inside a card's body rather than a whole card — see its own comment for
 * why it starts collapsed where a card's fold starts open.
 */

const cardPadStyle = `position: relative;`;
const cardHeaderStyle = `display: flex; align-items: center; gap: 8px;`;
// flex: 1 so the title takes the slack and everything after it — the
// `right` slot, then the chevron — clusters at the row's end.
const cardTitleStyle = (accent: string) =>
  `flex: 1; min-width: 0; font: 500 10.5px/1 ${FONT_MONO}; letter-spacing: 0.13em; text-transform: uppercase; color: ${accent};`;

// Small bordered text button — "Reset" in card headers, "RAW" in the
// spectrum header. Lit variant = currently active.
export const chipBtnStyle = `
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.55);
  background: transparent; border: 1px solid rgba(255,255,255,0.18); border-radius: 4px;
  padding: 2.5px 7px; cursor: pointer;
`;
export const chipBtnLitStyle = `${chipBtnStyle} color: #fff; border-color: rgba(255,255,255,0.5);`;

export const rowHeadStyle = `display: flex; align-items: center; justify-content: space-between; gap: 8px;`;
// Color lives in the .vc-label rule (controlsTheme.ts) so the hover/focus
// tint can override it — an inline color would win over the stylesheet.
export const rowLabelStyle = `
  font: 300 14.5px/1.2 ${FONT_LABEL}; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
export const rowRightStyle = `display: flex; align-items: center; gap: 7px; flex-shrink: 0;`;
export const readoutStyle = `display: flex; align-items: baseline; gap: 4px; color: #fff;`;
// Seven-segment digits; DSEG7 has no letters, so text readouts ("Off"/"On",
// "--") fall back to the mono face via digitsTextStyle.
// The transparent stroke draws nothing; it's there to widen the text's ink
// overflow. DSEG7's ink runs edge to edge (ascent = em, descent = 0), so a
// digit's top and bottom segments sit flush with the metric box a text swap
// repaints. On a fractional baseline their antialiased edge row falls just
// outside that box and survives the swap — a "7" turning into a "1" left a
// faint hairline of the old top segment above the new digit. Every engine
// folds text-stroke width into ink overflow, unlike @font-face metric
// overrides, which WebKit ignores.
export const digitsStyle = `font-family: ${FONT_DIGITS}; font-size: 11.5px; letter-spacing: 1px; -webkit-text-stroke: 1px transparent;`;
export const digitsTextStyle = `font: 400 11px/1 ${FONT_MONO};`;
export const unitStyle = `font: 400 10.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.75);`;

const rowSpacerStyle = `height: 12px;`;
// A divider-with-caption between blocks of rows — a step down from a card
// title, not a second one.
export const groupHeadingStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 14px 0 8px; padding-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.1);
`;
export const groupHeadingFirstStyle = `
  font: 400 9.5px/1 ${FONT_MONO}; letter-spacing: 0.12em; text-transform: uppercase;
  color: rgba(255,255,255,0.45); margin: 2px 0 8px;
`;

export function createChipButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.title = title;
  btn.style.cssText = chipBtnStyle;
  btn.addEventListener("click", onClick);
  return btn;
}

export interface CardSpec {
  title: string;
  accent: string;
  /** Right-hand header slot — a Reset chip, a readout, … */
  right?: HTMLElement;
  /** Opts this card into a persisted collapse toggle (panelFolds.ts): a
   *  chevron in the header, and a click anywhere on the header outside
   *  `right`. Unique per mounted card ("bands", "scope", "signal", …). */
  foldId?: string;
}

export interface CardFold {
  isFolded(): boolean;
}

/** A glass card: scanline overlay, header row (title + optional right slot),
 *  and a body the caller fills. Returns `title` too, so a caller that's also
 *  a keyboard block (deviceMenu.ts's markBlock) can badge it, and `fold`
 *  when `spec.foldId` is set, so a caller can read whether it's currently
 *  folded (audioMeters.ts skips a folded card's per-frame work). */
export function createCard(
  spec: CardSpec,
): { el: HTMLDivElement; body: HTMLDivElement; title: HTMLDivElement; fold?: CardFold } {
  const el = document.createElement("div");
  el.className = "vc-card";
  el.style.cssText = glassCardStyle;
  const scanlines = document.createElement("div");
  scanlines.style.cssText = scanlineStyle;
  const pad = document.createElement("div");
  pad.className = "vc-card-pad";
  pad.style.cssText = cardPadStyle;

  const header = document.createElement("div");
  header.className = "vc-card-head";
  header.style.cssText = cardHeaderStyle;
  const title = document.createElement("div");
  title.textContent = spec.title;
  title.style.cssText = cardTitleStyle(spec.accent);
  header.appendChild(title);
  if (spec.right) {
    spec.right.classList.add("vc-card-right");
    header.appendChild(spec.right);
  }

  const body = document.createElement("div");
  body.className = "vc-card-body";

  let fold: CardFold | undefined;
  if (spec.foldId) {
    const foldId = spec.foldId;
    body.id = `vc-card-${foldId}`;
    // The chevron itself is drawn by the .vc-fold rule (controlsTheme.ts)
    // and turned by .vc-folded — no glyph, so it's crisp at any size.
    const foldBtn = document.createElement("button");
    foldBtn.type = "button";
    foldBtn.className = "vc-fold";
    foldBtn.setAttribute("aria-controls", body.id);
    header.appendChild(foldBtn);
    header.style.cursor = "pointer";

    const apply = (folded: boolean): void => {
      el.classList.toggle("vc-folded", folded);
      foldBtn.setAttribute("aria-expanded", String(!folded));
      foldBtn.title = folded ? `Expand ${spec.title}` : `Collapse ${spec.title}`;
    };
    apply(isFolded(foldId));

    const toggle = (): void => {
      const next = !el.classList.contains("vc-folded");
      apply(next);
      setFolded(foldId, next);
    };
    // stopPropagation so a chevron click doesn't also fire the header's own
    // click-to-toggle listener below and double-toggle.
    foldBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggle();
    });
    header.addEventListener("click", (e) => {
      if (spec.right?.contains(e.target as Node)) return;
      toggle();
    });

    fold = { isFolded: () => el.classList.contains("vc-folded") };
  }

  pad.append(header, body);
  el.append(scanlines, pad);
  return { el, body, title, fold };
}

export function spacer(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = rowSpacerStyle;
  return el;
}

export function groupHeading(text: string, first = false): HTMLElement {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = first ? groupHeadingFirstStyle : groupHeadingStyle;
  return el;
}

// A trace's colour key: a short line swatch (these are lines on the canvas,
// not points) beside a caption in the same small-mono voice as tickLabelStyle
// and tempoCaptionStyle. Always visible — unlike .vc-hint, a legend that
// hides on hover isn't doing a legend's job.
const traceLegendStyle = `display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 6px;`;
const traceLegendEntryStyle = `display: flex; align-items: center; gap: 5px; transition: opacity 0.2s ease;`;
const traceLegendSwatchStyle = (color: string) =>
  `width: 10px; height: 2px; border-radius: 1px; background: ${color};`;
const traceLegendLabelStyle = `font: 400 8.5px/1 ${FONT_MONO}; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(255,255,255,0.55);`;
const traceLegendNoteStyle = `font: 400 8.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.4);`;

export interface TraceLegendSpec {
  color: string;
  label: string;
  /** Short non-uppercase aside after the label, e.g. what the line means —
   *  for a legend standing in for a hover hint a lone trace has no room for. */
  note?: string;
}

/** Builds a legend from traceLegendStyle; entries stay in the order given.
 *  setEntryEnabled dims an entry (e.g. a reference line the source can't
 *  supply right now) without removing it, keyed so a per-frame call is free. */
export function createTraceLegend(entries: TraceLegendSpec[]) {
  const el = document.createElement("div");
  el.style.cssText = traceLegendStyle;
  const rows = entries.map((spec) => {
    const row = document.createElement("div");
    row.style.cssText = traceLegendEntryStyle;
    const swatch = document.createElement("div");
    swatch.style.cssText = traceLegendSwatchStyle(spec.color);
    const label = document.createElement("div");
    label.textContent = spec.label;
    label.style.cssText = traceLegendLabelStyle;
    row.append(swatch, label);
    if (spec.note) {
      const note = document.createElement("div");
      note.textContent = spec.note;
      note.style.cssText = traceLegendNoteStyle;
      row.appendChild(note);
    }
    el.appendChild(row);
    return row;
  });
  const lastEnabled: boolean[] = entries.map(() => true);
  return {
    el,
    setEntryEnabled(i: number, enabled: boolean): void {
      if (lastEnabled[i] === enabled) return;
      lastEnabled[i] = enabled;
      rows[i].style.opacity = enabled ? "1" : "0.35";
    },
  };
}

const advancedToggleStyle = `
  display: block; width: 100%; text-align: left; margin: 4px 0 2px; padding: 4px 0;
  font: 400 10px/1.3 ${FONT_MONO}; letter-spacing: 0.04em; color: rgba(255,255,255,0.45);
  background: transparent; border: none; cursor: pointer;
`;

export interface AdvancedSection {
  el: HTMLElement;
  /** Append rows here — hidden via `display: none` while collapsed. */
  body: HTMLElement;
}

/** A per-group disclosure for rows a scene marked SceneSetting.advanced —
 *  real settings, rarely touched (the constants a macro's sub-params
 *  redistribute, say), that would otherwise double a group's row count for
 *  everyone. Same idea as a card's foldId (panelFolds.ts persists it the
 *  same way) but starts collapsed on first render rather than open — nobody
 *  needs to see these before they've reached for the group's main slider.
 *
 *  Uses `display: none`, not a height animation: deviceMenu.ts's Tab ring
 *  filters controls by getClientRects(), so a collapsed body's rows drop out
 *  of the tab order for free. Deliberately not a markBlock() target either —
 *  block digit badges stop at nine, and a scene's own group headings already
 *  spend most of that budget. */
export function createAdvancedSection(id: string, label: string): AdvancedSection {
  const wrap = document.createElement("div");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.style.cssText = advancedToggleStyle;
  const body = document.createElement("div");

  const apply = (open: boolean): void => {
    body.style.display = open ? "" : "none";
    toggle.textContent = `${open ? "▾ Hide" : "▸ Show"} ${label}`;
  };
  apply(!isFolded(id, true));

  toggle.addEventListener("click", () => {
    const next = body.style.display === "none";
    apply(next);
    setFolded(id, !next);
  });

  wrap.append(toggle, body);
  return { el: wrap, body };
}

// The "reacts to" strip (a setting row) and its always-visible head chip —
// src/render/signals.ts's descriptive link from a setting to the live
// signals that drive it. Deliberately dumb: this file only draws pills and
// reports clicks; deviceMenu.ts owns resolving a SignalLink, reading it each
// tick, and what a click on a pill with a monitor anchor actually does
// (unfold/scroll/flash a meters row) — the same "shared grammar, no domain
// knowledge" split as the rest of this file.
const signalChipStyle = (accent: string) => `
  font: 400 9px/1.2 ${FONT_MONO}; letter-spacing: 0.02em; color: ${accent};
  background: color-mix(in srgb, ${accent} 12%, transparent);
  border: 1px solid color-mix(in srgb, ${accent} 45%, transparent); border-radius: 4px;
  padding: 2.5px 6px; cursor: pointer; display: flex; align-items: center; gap: 2px;
`;
const signalStripPillsStyle = `display: flex; flex-wrap: wrap; gap: 6px;`;
const signalPillStyle = (accent: string, clickable: boolean) => `
  display: inline-flex; align-items: center; gap: 5px;
  font: 400 9.5px/1.2 ${FONT_MONO}; letter-spacing: 0.02em; color: rgba(255,255,255,0.75);
  padding: 2px 7px; border-radius: 9px; cursor: ${clickable ? "pointer" : "default"};
  border: 1px solid color-mix(in srgb, ${accent} 35%, transparent);
  background: color-mix(in srgb, ${accent} 7%, transparent);
  transition: opacity 0.18s ease;
`;
const signalPillTrackStyle = `position: relative; width: 20px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18);`;
const signalPillFillStyle = (accent: string) =>
  `position: absolute; top: 0; left: 0; height: 100%; width: 0; border-radius: 2px; background-color: ${accent};`;

export interface SignalPillSpec {
  label: string;
  description: string;
  /** Present only when the underlying SignalSpec has a `monitor` anchor —
   *  see signals.ts. Omit to render the pill inert (no cursor, no click). */
  onReveal?: () => void;
}

export interface SignalStrip {
  /** The always-visible head-cluster indicator — caller places it in the
   *  row's own `right` slot, beside A/T/↺. */
  chip: HTMLElement;
  /** The pill row — caller places it as a sibling of `.vc-hint`, not inside
   *  it, so the two reveal independently (see the .vc-reads rule,
   *  controlsTheme.ts) and the pills survive the hint's own text being
   *  replaced wholesale while auto owns the row. */
  strip: HTMLElement;
  /** Per-pill live value in [0,1] and whether its link is currently active
   *  (SignalLink.activeWhen) — same order as the specs passed in. */
  update(states: { value: number; active: boolean }[]): void;
}

/** One setting row's audio-driven links, rendered as a small always-on chip
 *  plus a hover-revealed pill strip. Order of `specs` is fixed for the
 *  strip's lifetime — a scene's `reads` array doesn't change at runtime, so
 *  update() takes a plain parallel array rather than a keyed one. */
export function createSignalStrip(specs: SignalPillSpec[], accent: string): SignalStrip {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.style.cssText = signalChipStyle(accent);
  chip.textContent = `∿${specs.length}`;
  chip.title = `Reacts to ${specs.length} live signal${specs.length === 1 ? "" : "s"} — hover for detail`;

  const strip = document.createElement("div");
  strip.className = "vc-reads";
  const pillsWrap = document.createElement("div");
  pillsWrap.style.cssText = signalStripPillsStyle;
  strip.appendChild(pillsWrap);

  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    strip.classList.toggle("vc-reads-open");
  });

  const pills = specs.map((spec) => {
    const pill = document.createElement("div");
    pill.style.cssText = signalPillStyle(accent, !!spec.onReveal);
    pill.title = spec.description;
    const label = document.createElement("span");
    label.textContent = spec.label;
    const track = document.createElement("div");
    track.style.cssText = signalPillTrackStyle;
    const fill = document.createElement("div");
    fill.style.cssText = signalPillFillStyle(accent);
    track.appendChild(fill);
    pill.append(label, track);
    if (spec.onReveal) {
      const reveal = spec.onReveal;
      pill.addEventListener("click", (e) => {
        e.stopPropagation();
        reveal();
      });
    }
    pillsWrap.appendChild(pill);
    return { pill, fill };
  });

  return {
    chip,
    strip,
    update(states): void {
      for (let i = 0; i < pills.length; i++) {
        const s = states[i];
        pills[i].fill.style.width = `${Math.max(0, Math.min(1, s.value)) * 100}%`;
        pills[i].pill.style.opacity = s.active ? "1" : "0.4";
      }
    },
  };
}
