import type { SceneLook } from "../render/sceneLooks.ts";
import { FONT_LABEL, FONT_MONO, SCENE_VIOLET } from "./controlsTheme.ts";
import { chipBtnStyle, createCard, createChipButton, spacer } from "./controlsKit.ts";
import { createLookIcon } from "./lookIcon.ts";
import { bindHint, hideTooltip } from "./tooltip.ts";

/**
 * The Looks card — named, shareable snapshots of the Scene card's own
 * sliders (src/render/sceneLooks.ts owns the model: non-auto-only storage,
 * authoritative apply, the share-code format). Mounted next to sceneCard in
 * deviceMenu.ts and hidden the same way when the active scene has no
 * settings to snapshot.
 *
 * Fully dependency-injected like every other card here — no store import.
 * app.ts is the one place that wires these callbacks to sceneLooks.ts.
 *
 * "Save look" saves in one click: app.ts names the look (lookNames.ts makes
 * up a silly one) and the new row opens straight in rename, the made-up name
 * filled in and selected — type over it, or press Enter or leave the field
 * (or clear it) to keep the made-up name. Pressing any look's name renames it
 * the same way; pressing the look's icon (tinted from its name, lookIcon.ts)
 * applies it. A look carries the palette it was saved under; app.ts applies
 * both.
 *
 * Every row button gets tooltip.ts's instant hint rather than a `title`,
 * which shows late on a mouse and never on touch. The copy button copies a
 * link; "Paste a look" takes that link, or the bare code inside it.
 *
 * Renaming and "Paste a look" use an inline <input> rather than
 * prompt(): this panel runs over a fullscreen canvas on a phone or TV, and a
 * modal prompt can drop fullscreen on some browsers.
 */

export interface LooksCardDeps {
  currentSceneId: () => string;
  listLooks: (sceneId: string) => SceneLook[];
  /** Saves the current tuning under a generated name and returns it. */
  onSaveLook: (sceneId: string) => string;
  /** False when the new name is blank or another look of the scene has it. */
  onRenameLook: (sceneId: string, from: string, to: string) => boolean;
  onApplyLook: (look: SceneLook) => void;
  onDeleteLook: (sceneId: string, name: string) => void;
  decodeLook: (code: string) => SceneLook | null;
  /** The full share URL for a Look — app.ts owns the query-before-hash shape
   *  the boot()-time decode side expects. */
  buildShareLink: (look: SceneLook) => string;
  hasUndo: (sceneId: string) => boolean;
  onUndoLook: (sceneId: string) => void;
}

export interface LooksCard {
  el: HTMLElement;
  title: HTMLElement;
  refresh(): void;
}

const listStyle = `display: flex; flex-direction: column;`;
const rowStyle = `display: flex; align-items: center; gap: 4px; padding: 3px 0;`;
const nameBtnStyle = `
  flex: 1; min-width: 0; text-align: left; background: none; border: none; cursor: pointer;
  font: 300 13.5px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,0.85); padding: 3px 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const applyBtnStyle = `display: flex; background: none; border: none; padding: 2px; cursor: pointer; flex-shrink: 0;`;
const iconBtnStyle = `
  display: flex; color: rgba(255,255,255,0.55); background: none; border: none;
  padding: 3px 4px; cursor: pointer; flex-shrink: 0;
`;
const emptyStyle = `font: 400 11px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.4); padding: 2px 0 4px;`;
const actionRowStyle = `display: flex; margin-top: 4px;`;
const inlineFormStyle = `display: flex; gap: 5px; margin-top: 6px;`;
const inlineInputStyle = `
  flex: 1; min-width: 0; font: 300 13.5px/1.3 ${FONT_LABEL}; color: #fff;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
  padding: 5px 7px; outline: none;
`;
const feedbackStyle = `font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.5); margin-top: 4px;`;

/** A glyph on a 16-unit grid, in the stroke style of the panel's others. */
function svgIcon(paths: string): string {
  return `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
/** Two chain links: copy a link. */
const LINK_ICON = svgIcon(
  '<path d="M6.6 9.4l2.8-2.8"/>' +
    '<path d="M7.3 4.9l1.4-1.4a2.6 2.6 0 0 1 3.8 3.8l-1.4 1.4"/>' +
    '<path d="M8.7 11.1l-1.4 1.4a2.6 2.6 0 0 1-3.8-3.8l1.4-1.4"/>',
);
const DELETE_ICON = svgIcon('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/>');

/** The code in a pasted look link, or the text itself when it isn't one. */
function lookCodeFrom(text: string): string {
  try {
    return new URL(text).searchParams.get("look") ?? text;
  } catch {
    return text;
  }
}

/** One row of "Paste a look" style: a chip that reveals an inline input
 *  on click, confirms on Enter, and dismisses on Escape or blur. */
function createInlineAction(chipText: string, chipTitle: string, placeholder: string, onConfirm: (value: string) => void) {
  const row = document.createElement("div");
  row.style.cssText = actionRowStyle;
  const chip = createChipButton(chipText, chipTitle, () => {
    row.style.display = "none";
    form.style.display = "flex";
    input.value = "";
    input.focus();
  });
  chip.style.cssText = `${chipBtnStyle} flex: 1; text-align: center;`;
  row.appendChild(chip);

  const form = document.createElement("div");
  form.style.cssText = inlineFormStyle;
  form.style.display = "none";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.style.cssText = inlineInputStyle;
  form.appendChild(input);

  function dismiss(): void {
    form.style.display = "none";
    row.style.display = "";
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss();
    } else if (e.key === "Enter") {
      const value = input.value.trim();
      if (value) {
        dismiss();
        onConfirm(value);
      }
    }
  });
  input.addEventListener("blur", dismiss);

  return { el: [row, form] as const };
}

export function createLooksCard(deps: LooksCardDeps): LooksCard {
  const undoChip = createChipButton("Undo", "Restore the tuning from before the last Look was applied", () => {
    deps.onUndoLook(deps.currentSceneId());
    refresh();
  });
  const card = createCard({ title: "Looks", accent: SCENE_VIOLET, right: undoChip });

  const list = document.createElement("div");
  list.style.cssText = listStyle;

  const feedback = document.createElement("div");
  feedback.style.cssText = feedbackStyle;
  feedback.style.display = "none";
  function showFeedback(text: string): void {
    feedback.textContent = text;
    feedback.style.display = "";
  }

  const saveRow = document.createElement("div");
  saveRow.style.cssText = actionRowStyle;
  const saveChip = createChipButton("Save look", "Save this scene's current tuning and palette as a new look", () => {
    const name = deps.onSaveLook(deps.currentSceneId());
    feedback.style.display = "none";
    renderList(name);
    refreshUndo();
  });
  saveChip.style.cssText = `${chipBtnStyle} flex: 1; text-align: center;`;
  saveRow.appendChild(saveChip);

  const pasteAction = createInlineAction("Paste a look", "Apply a look someone shared as a link", "Paste a look link", (text) => {
    const look = deps.decodeLook(lookCodeFrom(text));
    if (!look) {
      showFeedback("That link didn't parse.");
      return;
    }
    if (look.sceneId !== deps.currentSceneId()) {
      showFeedback(`That look is for a different scene (${look.sceneId}).`);
      return;
    }
    feedback.style.display = "none";
    deps.onApplyLook(look);
    refresh();
  });

  card.body.append(list, spacer(), saveRow, ...pasteAction.el, feedback);

  /** Swaps a look's name button for an input holding its name, selected.
   *  Enter or leaving the field keeps the new name; Escape, or a blank
   *  field, keeps the old one. */
  function startRename(sceneId: string, look: SceneLook, nameBtn: HTMLButtonElement): void {
    const input = document.createElement("input");
    input.type = "text";
    input.value = look.name;
    input.style.cssText = `${inlineInputStyle} padding: 2px 6px;`;
    let done = false;
    function finish(keep: boolean): void {
      if (done) return;
      done = true;
      const to = input.value.trim();
      if (keep && to && to !== look.name) {
        if (deps.onRenameLook(sceneId, look.name, to)) feedback.style.display = "none";
        else showFeedback(`There's already a look called "${to}".`);
      }
      refresh();
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        finish(false);
      } else if (e.key === "Enter") {
        finish(true);
      }
    });
    input.addEventListener("blur", () => finish(true));
    hideTooltip();
    nameBtn.replaceWith(input);
    input.focus();
    input.select();
  }

  /** A row button with an instant hint; `lines` start with what it does.
   *  A string `content` is one of this file's own SVG glyphs. */
  function rowButton(content: Node | string, style: string, lines: readonly string[], onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    if (typeof content === "string") btn.innerHTML = content;
    else btn.appendChild(content);
    btn.setAttribute("aria-label", lines[0]!);
    btn.style.cssText = style;
    bindHint(btn, SCENE_VIOLET, lines);
    btn.addEventListener("click", onClick);
    return btn;
  }

  /** `renameName` is a look to open in rename as soon as it's drawn. */
  function renderList(renameName?: string): void {
    const sceneId = deps.currentSceneId();
    const looks = deps.listLooks(sceneId);
    // A hint left up over a button about to go would stay: no pointerleave
    // ever comes from a removed element.
    hideTooltip();
    list.innerHTML = "";
    if (looks.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No saved looks for this scene yet.";
      empty.style.cssText = emptyStyle;
      list.appendChild(empty);
      return;
    }
    for (const look of looks) {
      const row = document.createElement("div");
      row.style.cssText = rowStyle;

      const iconBtn = rowButton(createLookIcon(look.name), applyBtnStyle, [`Apply "${look.name}"`], () => {
        deps.onApplyLook(look);
        refresh();
      });

      // A text node, never markup: a shared look names itself.
      const nameBtn = rowButton(document.createTextNode(look.name), nameBtnStyle, [`Rename "${look.name}"`], () =>
        startRename(sceneId, look, nameBtn),
      );

      const copyBtn = rowButton(LINK_ICON, iconBtnStyle, ["Copy link", "Whoever opens it gets this look and its palette"], () =>
        void copyLink(look),
      );

      const deleteBtn = rowButton(DELETE_ICON, iconBtnStyle, [`Delete "${look.name}"`], () => {
        deps.onDeleteLook(sceneId, look.name);
        refresh();
      });

      row.append(iconBtn, nameBtn, copyBtn, deleteBtn);
      list.appendChild(row);
      if (look.name === renameName) startRename(sceneId, look, nameBtn);
    }
  }

  /** Copies the look's share link and says so. */
  async function copyLink(look: SceneLook): Promise<void> {
    const text = deps.buildShareLink(look);
    try {
      await navigator.clipboard.writeText(text);
      showFeedback(`Copied a link to "${look.name}".`);
    } catch {
      // Clipboard access can be unavailable (permissions, insecure
      // context) — fall back to a selectable field instead of failing
      // silently.
      const fallback = document.createElement("input");
      fallback.type = "text";
      fallback.readOnly = true;
      fallback.value = text;
      fallback.style.cssText = inlineInputStyle;
      feedback.textContent = "";
      feedback.style.display = "";
      feedback.appendChild(fallback);
      fallback.focus();
      fallback.select();
    }
  }

  function refreshUndo(): void {
    const canUndo = deps.hasUndo(deps.currentSceneId());
    undoChip.style.visibility = canUndo ? "visible" : "hidden";
  }
  function refresh(): void {
    renderList();
    refreshUndo();
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
