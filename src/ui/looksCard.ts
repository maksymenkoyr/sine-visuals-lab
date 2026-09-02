import type { SceneLook } from "../render/sceneLooks.ts";
import { FONT_LABEL, FONT_MONO, SCENE_VIOLET } from "./controlsTheme.ts";
import { chipBtnStyle, createCard, createChipButton, spacer } from "./controlsKit.ts";

/**
 * The Looks card — named, shareable snapshots of the Scene card's own
 * sliders (src/render/sceneLooks.ts owns the model: exceptions-only storage,
 * authoritative apply, the share-code format). Mounted next to sceneCard in
 * deviceMenu.ts and hidden the same way when the active scene has no
 * settings to snapshot.
 *
 * Fully dependency-injected like every other card here — no store import.
 * app.ts is the one place that wires these callbacks to sceneLooks.ts.
 *
 * "Save current as…" and "Paste a look code" reveal an inline <input>
 * rather than using prompt(): this panel runs over a fullscreen canvas on a
 * phone or TV, and a modal prompt can drop fullscreen on some browsers.
 */

export interface LooksCardDeps {
  currentSceneId: () => string;
  listLooks: (sceneId: string) => SceneLook[];
  onSaveLook: (sceneId: string, name: string) => void;
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

/** One row of "Save current as…" style: a chip that reveals an inline input
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

  const saveAction = createInlineAction("Save current as…", "Save this scene's current tuning under a name", "Name this look", (name) => {
    deps.onSaveLook(deps.currentSceneId(), name);
    feedback.style.display = "none";
    refresh();
  });

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

  card.body.append(list, spacer(), ...saveAction.el, ...pasteAction.el, feedback);

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
      nameBtn.title = `Apply "${look.name}"`;
      nameBtn.style.cssText = nameBtnStyle;
      nameBtn.addEventListener("click", () => {
        deps.onApplyLook(look);
        refresh();
      });

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
