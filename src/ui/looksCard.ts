import type { SceneLook } from "../render/sceneLooks.ts";
import { FONT_LABEL, FONT_MONO, SCENE_VIOLET } from "./controlsTheme.ts";
import { chipBtnStyle, createCard, createChipButton, spacer } from "./controlsKit.ts";

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
 * up a silly one) and the card says what it was called. A double-click on a
 * look's name renames it in place; the click handler skips the double-click's
 * second click, which would otherwise apply the look again and overwrite its
 * Undo snapshot with the look itself.
 *
 * Renaming and "Paste a look code" use an inline <input> rather than
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
const iconBtnStyle = `
  font: 400 11px/1 ${FONT_MONO}; color: rgba(255,255,255,0.5); background: none; border: none;
  padding: 3px 5px; cursor: pointer; flex-shrink: 0;
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

/** One row of "Paste a look code" style: a chip that reveals an inline input
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
  const saveChip = createChipButton("Save look", "Save this scene's current tuning as a new look", () => {
    const name = deps.onSaveLook(deps.currentSceneId());
    refresh();
    showFeedback(`Saved as "${name}". Double-click a name to rename it.`);
  });
  saveChip.style.cssText = `${chipBtnStyle} flex: 1; text-align: center;`;
  saveRow.appendChild(saveChip);

  const pasteAction = createInlineAction("Paste a look code", "Apply a look shared as a code", "Paste a look code", (code) => {
    const look = deps.decodeLook(code);
    if (!look) {
      showFeedback("That code didn't parse.");
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

  /** Swaps a look's name button for an input holding its name. Enter or
   *  leaving the field keeps the new name, Escape keeps the old one. */
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
    nameBtn.replaceWith(input);
    input.focus();
    input.select();
  }

  function renderList(): void {
    const sceneId = deps.currentSceneId();
    const looks = deps.listLooks(sceneId);
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

      const nameBtn = document.createElement("button");
      nameBtn.textContent = look.name;
      nameBtn.title = `Apply "${look.name}" (double-click to rename)`;
      nameBtn.style.cssText = nameBtnStyle;
      nameBtn.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        deps.onApplyLook(look);
        refresh();
      });
      nameBtn.addEventListener("dblclick", () => startRename(sceneId, look, nameBtn));

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "⧉";
      copyBtn.title = "Copy a share link for this look";
      copyBtn.style.cssText = iconBtnStyle;
      copyBtn.addEventListener("click", async () => {
        const link = deps.buildShareLink(look);
        try {
          await navigator.clipboard.writeText(link);
          showFeedback(`Copied a link for "${look.name}".`);
        } catch {
          // Clipboard access can be unavailable (permissions, insecure
          // context) — fall back to a selectable field instead of failing
          // silently.
          const fallback = document.createElement("input");
          fallback.type = "text";
          fallback.readOnly = true;
          fallback.value = link;
          fallback.style.cssText = inlineInputStyle;
          feedback.textContent = "";
          feedback.style.display = "";
          feedback.appendChild(fallback);
          fallback.focus();
          fallback.select();
        }
      });

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "✕";
      deleteBtn.title = `Delete "${look.name}"`;
      deleteBtn.style.cssText = iconBtnStyle;
      deleteBtn.addEventListener("click", () => {
        deps.onDeleteLook(sceneId, look.name);
        refresh();
      });

      row.append(nameBtn, copyBtn, deleteBtn);
      list.appendChild(row);
    }
  }

  function refresh(): void {
    renderList();
    const canUndo = deps.hasUndo(deps.currentSceneId());
    undoChip.style.visibility = canUndo ? "visible" : "hidden";
  }
  refresh();

  return { el: card.el, title: card.title, refresh };
}
