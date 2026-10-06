import {
  OVERLAY_OPACITY_DEFAULT,
  OVERLAY_OPACITY_MIN,
  OVERLAY_POSITIONS,
  OVERLAY_SIZE_DEFAULT,
  OVERLAY_SIZE_MAX,
  OVERLAY_SIZE_MIN,
  OVERLAY_TEXT_MAX_CHARS,
  type OverlayPosition,
} from "../render/overlayLayout.ts";
import { FONT_LABEL, FONT_MONO, POWER_TEAL } from "./controlsTheme.ts";
import { chipBtnLitStyle, chipBtnStyle, createCard, createChipButton, percentReadout, spacer } from "./controlsKit.ts";
// Circular with deviceMenu.ts (it imports createOverlayCard below) — the same
// pattern audioMeters.ts and bandLineEditor.ts use for createControlRow; safe
// because neither side calls the other at module-eval time.
import { createControlRow } from "./deviceMenu.ts";

/**
 * The Overlay card: a line of text (an event or DJ name) and a logo drawn over
 * the visuals, on this screen, the pop-out output window and a paired TV. The
 * drawing is render/overlayLayer.ts, the saved settings are
 * render/overlayStore.ts, the rules (positions, limits, sizes) are
 * render/overlayLayout.ts. Nothing set means nothing drawn.
 *
 * Fully dependency-injected like looksCard.ts — no store import; app.ts wires
 * the callbacks. `getState()` is read on refresh() (the panel opening, or
 * after the room hands this device a look), so the fields never show stale
 * text. The text field writes as you type; Enter or Escape leaves it. Escape
 * is stopped here so it does not also leave the scene.
 *
 * A logo that was too detailed to ride in a room's look is kept on this
 * device only (the store's `device` scope): the card says so in plain words,
 * because a TV will not show it.
 */

export interface OverlayCardState {
  text: string;
  position: OverlayPosition;
  size: number;
  opacity: number;
  /** `none`: no logo; `room`: part of the look; `device`: this device only. */
  logoScope: "none" | "room" | "device";
}

export interface OverlayCardDeps {
  getState: () => OverlayCardState;
  onText: (text: string) => void;
  onPosition: (position: OverlayPosition) => void;
  onSize: (size: number) => void;
  onOpacity: (opacity: number) => void;
  /** Reads, shrinks and stores a picked file; `failed` when it is not an image
   *  the browser can read or cannot be made small enough. */
  onLogoFile: (file: File) => Promise<"room" | "device" | "failed">;
  onRemoveLogo: () => void;
}

export interface OverlayCard {
  el: HTMLElement;
  title: HTMLElement;
  refresh(): void;
}

/** What the file picker accepts. */
const LOGO_ACCEPT = "image/png,image/jpeg,image/svg+xml,image/webp";

const labelStyle = `font: 300 14.5px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.85); margin: 0 0 4px;`;
const inputStyle = `
  width: 100%; box-sizing: border-box; font: 300 13.5px/1.3 ${FONT_LABEL}; color: #fff;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
  padding: 5px 7px; outline: none;
`;
const chipRowStyle = `display: flex; flex-wrap: wrap; gap: 4px;`;
const noteStyle = `font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.5); margin-top: 4px;`;

export function createOverlayCard(deps: OverlayCardDeps): OverlayCard {
  const card = createCard({ title: "Overlay", accent: POWER_TEAL, foldId: "overlay" });

  // Text
  const textLabel = document.createElement("div");
  textLabel.textContent = "Text";
  textLabel.style.cssText = labelStyle;
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.maxLength = OVERLAY_TEXT_MAX_CHARS;
  textInput.placeholder = "Event or DJ name";
  textInput.title = "One line shown over the visuals. Leave empty for none.";
  textInput.style.cssText = inputStyle;
  textInput.addEventListener("input", () => deps.onText(textInput.value));
  textInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      textInput.blur();
    } else if (e.key === "Enter") textInput.blur();
  });

  // Logo
  const logoLabel = document.createElement("div");
  logoLabel.textContent = "Logo";
  logoLabel.style.cssText = labelStyle;
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = LOGO_ACCEPT;
  fileInput.style.display = "none";
  const chooseBtn = createChipButton("Choose image…", "Pick a PNG, JPEG, SVG or WebP image", () => fileInput.click());
  const removeBtn = createChipButton("Remove", "Take the logo off", () => {
    deps.onRemoveLogo();
    setNote("");
    refresh();
  });
  const logoRow = document.createElement("div");
  logoRow.style.cssText = chipRowStyle;
  logoRow.append(chooseBtn, removeBtn, fileInput);
  const note = document.createElement("div");
  note.style.cssText = noteStyle;
  note.style.display = "none";
  function setNote(text: string): void {
    note.textContent = text;
    note.style.display = text ? "" : "none";
  }
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // so picking the same file again still fires
    if (!file) return;
    setNote("Reading the image…");
    const result = await deps.onLogoFile(file);
    if (result === "failed") setNote("That image couldn't be used. Try a PNG, JPEG, SVG or WebP.");
    else setNote("");
    refresh();
  });

  // Position
  const positionLabel = document.createElement("div");
  positionLabel.textContent = "Position";
  positionLabel.style.cssText = labelStyle;
  const positionRow = document.createElement("div");
  positionRow.style.cssText = chipRowStyle;
  const positionChips = new Map<OverlayPosition, HTMLButtonElement>();
  for (const p of OVERLAY_POSITIONS) {
    const chip = createChipButton(p.label, `Show it at: ${p.label.toLowerCase()}`, () => {
      deps.onPosition(p.id);
      refresh();
    });
    positionChips.set(p.id, chip);
    positionRow.appendChild(chip);
  }

  // Size and opacity: the panel's own slider row.
  const sizeRow = createControlRow({
    label: "Size",
    accent: POWER_TEAL,
    min: OVERLAY_SIZE_MIN,
    max: OVERLAY_SIZE_MAX,
    step: 0.05,
    defaultValue: OVERLAY_SIZE_DEFAULT,
    mapping: "linear",
    unit: "×",
    format: (v) => v.toFixed(2),
    description: "How big the text and logo are. They scale with the screen's height, so a TV looks like a laptop.",
  });
  sizeRow.onChange((v) => deps.onSize(v));
  const opacityRow = createControlRow({
    label: "Opacity",
    accent: POWER_TEAL,
    min: OVERLAY_OPACITY_MIN,
    max: 1,
    step: 0.05,
    defaultValue: OVERLAY_OPACITY_DEFAULT,
    mapping: "linear",
    ...percentReadout,
    description: "How solid the text and logo are over the picture.",
  });
  opacityRow.onChange((v) => deps.onOpacity(v));

  card.body.append(
    textLabel,
    textInput,
    spacer(),
    logoLabel,
    logoRow,
    note,
    spacer(),
    positionLabel,
    positionRow,
    spacer(),
    sizeRow.el,
    opacityRow.el,
  );

  function refresh(): void {
    const s = deps.getState();
    // Never overwrite what is being typed.
    if (document.activeElement !== textInput) textInput.value = s.text;
    removeBtn.style.display = s.logoScope === "none" ? "none" : "";
    chooseBtn.textContent = s.logoScope === "none" ? "Choose image…" : "Change image…";
    if (s.logoScope === "device") {
      setNote("This logo is too detailed to send to a TV, so it shows on this screen and the output window only.");
    } else if (note.textContent && note.textContent.startsWith("This logo")) setNote("");
    for (const [id, chip] of positionChips) chip.style.cssText = id === s.position ? chipBtnLitStyle : chipBtnStyle;
    sizeRow.setValue(s.size);
    opacityRow.setValue(s.opacity);
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
