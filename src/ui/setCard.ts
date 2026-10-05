import type { AutopilotConfig, AutopilotOrder, SetPad } from "../render/sceneSet.ts";
import { FONT_LABEL, FONT_MONO, LIVE_DOT, SCENE_VIOLET } from "./controlsTheme.ts";
import { chipBtnLitStyle, chipBtnStyle, createCard, createChipButton, spacer } from "./controlsKit.ts";

/**
 * The Set card — pads of saved looks from any scene, fired live, with an
 * Autopilot row that fires them on its own (src/render/sceneSet.ts owns the
 * model and the store, src/render/setAutopilot.ts the timing; app.ts wires
 * both and the 1-9 keys that fire pads 1-9).
 *
 * "+ Add" captures what is on screen now as a new pad. A pad's label is
 * "<scene name> · <its own name>"; a click fires it, a double-click on the
 * name renames it in place (the click handler skips the double-click's second
 * click, so the pad isn't fired twice), and the cross deletes it. A pad is its
 * own copy, so nothing done in the Looks card can break it.
 *
 * Two markers say where a pad is: a ring (the CUE orange of the output bar)
 * on the pad loaded in this window's preview, and a filled dot (the PLAY
 * green) on the pad that is live on the output. With no output window open
 * this window is the output, so the one pad shows the filled dot alone.
 *
 * Autopilot: Off/On, "Every" N bars (the choices come from the host, not from
 * here) and the order. It needs at least `minPads` pads and says so in words
 * when it has fewer. On a phone controller it doesn't run at all — only the
 * laptop that hears the music does — so the row there is a one-line note
 * (`autopilotRuns` false).
 *
 * Fully dependency-injected like every other card here — no store import.
 * `refresh()` is cheap to call every panel tick: it rebuilds the DOM only when
 * what it draws has changed, so a press in flight is never rebuilt under the
 * pointer (the panel's own click-loss rule), and it leaves an open rename
 * alone.
 */

export interface SetCardDeps {
  pads: () => readonly SetPad[];
  sceneName: (sceneId: string) => string;
  /** Captures the current scene's look and palette as a pad. Returns null on
   *  success, otherwise the reason it was refused, in words for the card. */
  onAddPad: () => string | null;
  onFirePad: (id: string) => void;
  onRenamePad: (id: string, name: string) => void;
  onDeletePad: (id: string) => void;
  /** The pad loaded in this window's preview, and the pad live on the output
   *  (null when neither is known). */
  previewPadId: () => string | null;
  livePadId: () => string | null;
  /** A separate output (the pop-out or the room's screens) is open, so
   *  "preview" and "live" are two different things. */
  outputOpen: () => boolean;
  autopilot: () => AutopilotConfig;
  onAutopilotChange: (change: Partial<AutopilotConfig>) => void;
  /** False on a device that doesn't run Autopilot (a phone controller). */
  autopilotRuns: () => boolean;
  everyChoices: readonly number[];
  minPads: number;
  maxPads: number;
}

export interface SetCard {
  el: HTMLElement;
  title: HTMLElement;
  refresh(): void;
}

const ORDER_LABELS: ReadonlyArray<readonly [AutopilotOrder, string]> = [
  ["inOrder", "In order"],
  ["shuffle", "Shuffle"],
];

const PREVIEW_ORANGE = "#ff9f1c";

const listStyle = `display: flex; flex-direction: column;`;
const rowStyle = `display: flex; align-items: center; gap: 5px; padding: 3px 0;`;
const keyStyle = `font: 400 10.5px/1 ${FONT_MONO}; color: rgba(255,255,255,0.4); width: 10px; text-align: center; flex-shrink: 0;`;
const markersStyle = `display: flex; gap: 3px; width: 22px; flex-shrink: 0;`;
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
const noteStyle = `font: 400 10.5px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.5); margin-top: 4px;`;
const legendStyle = `font: 400 10px/1.4 ${FONT_MONO}; color: rgba(255,255,255,0.45); margin-top: 4px;`;
const inlineInputStyle = `
  flex: 1; min-width: 0; font: 300 13.5px/1.3 ${FONT_LABEL}; color: #fff;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.25); border-radius: 4px;
  padding: 2px 6px; outline: none;
`;
const prefixStyle = `font: 300 13.5px/1.3 ${FONT_LABEL}; color: rgba(255,255,255,0.5); white-space: nowrap; flex-shrink: 1;`;
const autoRowStyle = `display: flex; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 5px;`;
const autoLabelStyle = `font: 300 13px/1.2 ${FONT_LABEL}; color: rgba(255,255,255,0.75); width: 64px; flex-shrink: 0;`;
const unitStyle = `font: 400 10px/1 ${FONT_MONO}; color: rgba(255,255,255,0.45); margin-left: 2px;`;

function marker(kind: "preview" | "live"): HTMLElement {
  const dot = document.createElement("span");
  const live = kind === "live";
  dot.style.cssText = `width: 8px; height: 8px; border-radius: 50%; box-sizing: border-box; flex-shrink: 0;
    ${live ? `background: ${LIVE_DOT}; box-shadow: 0 0 6px ${LIVE_DOT};` : `border: 2px solid ${PREVIEW_ORANGE};`}`;
  dot.title = live ? "Live on the output" : "In this window's preview";
  dot.dataset.marker = kind;
  return dot;
}

export function createSetCard(deps: SetCardDeps): SetCard {
  const addChip = createChipButton("+ Add", "Add what's on screen now as a pad", () => {
    const refused = deps.onAddPad();
    note = refused ?? "";
    refresh(true);
  });
  const card = createCard({ title: "Set", accent: SCENE_VIOLET, right: addChip });

  const list = document.createElement("div");
  list.style.cssText = listStyle;
  const legend = document.createElement("div");
  legend.style.cssText = legendStyle;
  const autopilotHost = document.createElement("div");
  const noteEl = document.createElement("div");
  noteEl.style.cssText = noteStyle;
  card.body.append(list, legend, noteEl, spacer(), autopilotHost);

  /** The last thing worth saying in words (a refused Add). */
  let note = "";
  let renaming = false;
  let shown = "";

  function startRename(pad: SetPad, nameBtn: HTMLButtonElement): void {
    const input = document.createElement("input");
    input.type = "text";
    input.value = pad.name;
    input.style.cssText = inlineInputStyle;
    const prefix = document.createElement("span");
    prefix.textContent = `${deps.sceneName(pad.look.sceneId)} ·`;
    prefix.style.cssText = prefixStyle;
    let done = false;
    function finish(keep: boolean): void {
      if (done) return;
      done = true;
      renaming = false;
      const to = input.value.trim();
      if (keep && to && to !== pad.name) deps.onRenamePad(pad.id, to);
      refresh(true);
    }
    input.addEventListener("keydown", (e) => {
      // Typing a name must not fire pads (digits) or reach the panel's keys.
      e.stopPropagation();
      if (e.key === "Escape") finish(false);
      else if (e.key === "Enter") finish(true);
    });
    input.addEventListener("blur", () => finish(true));
    renaming = true;
    nameBtn.replaceWith(prefix, input);
    input.focus();
    input.select();
  }

  function chipGroup<T>(
    label: string,
    options: ReadonlyArray<readonly [T, string]>,
    current: T,
    enabled: boolean,
    onPick: (value: T) => void,
    unit?: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText = autoRowStyle;
    const l = document.createElement("div");
    l.textContent = label;
    l.style.cssText = autoLabelStyle;
    row.appendChild(l);
    for (const [value, text] of options) {
      const btn = createChipButton(text, `${label}: ${text}`, () => {
        if (!enabled) return;
        onPick(value);
        refresh();
      });
      btn.style.cssText = value === current ? chipBtnLitStyle : chipBtnStyle;
      btn.setAttribute("aria-pressed", String(value === current));
      if (!enabled) btn.style.opacity = "0.45";
      row.appendChild(btn);
    }
    if (unit) {
      const u = document.createElement("span");
      u.textContent = unit;
      u.style.cssText = unitStyle;
      row.appendChild(u);
    }
    return row;
  }

  function renderAutopilot(pads: number): void {
    autopilotHost.innerHTML = "";
    if (!deps.autopilotRuns()) {
      const msg = document.createElement("div");
      msg.textContent = "Autopilot runs on the laptop that hears the music.";
      msg.style.cssText = noteStyle;
      autopilotHost.appendChild(msg);
      return;
    }
    const cfg = deps.autopilot();
    const enough = pads >= deps.minPads;
    autopilotHost.appendChild(
      chipGroup<boolean>(
        "Autopilot",
        [
          [false, "Off"],
          [true, "On"],
        ],
        cfg.on,
        true,
        (on) => deps.onAutopilotChange({ on }),
      ),
    );
    autopilotHost.appendChild(
      chipGroup<number>(
        "Every",
        deps.everyChoices.map((n) => [n, String(n)] as const),
        cfg.everyBars,
        true,
        (everyBars) => deps.onAutopilotChange({ everyBars }),
        "bars",
      ),
    );
    autopilotHost.appendChild(chipGroup<AutopilotOrder>("Order", ORDER_LABELS, cfg.order, true, (order) => deps.onAutopilotChange({ order })));
    if (!enough) {
      const msg = document.createElement("div");
      msg.textContent = `Autopilot needs at least ${deps.minPads} pads.`;
      msg.style.cssText = noteStyle;
      autopilotHost.appendChild(msg);
    }
  }

  function renderList(pads: readonly SetPad[], preview: string | null, live: string | null, split: boolean): void {
    list.innerHTML = "";
    if (pads.length === 0) {
      const empty = document.createElement("div");
      empty.textContent = "No pads yet. Set up a scene, then press + Add.";
      empty.style.cssText = emptyStyle;
      list.appendChild(empty);
      return;
    }
    pads.forEach((pad, i) => {
      const row = document.createElement("div");
      row.style.cssText = rowStyle;
      row.dataset.pad = pad.id;

      const key = document.createElement("span");
      key.textContent = String(i + 1);
      key.style.cssText = keyStyle;

      const markers = document.createElement("span");
      markers.style.cssText = markersStyle;
      if (split && pad.id === preview) markers.appendChild(marker("preview"));
      if (pad.id === live) markers.appendChild(marker("live"));

      const label = `${deps.sceneName(pad.look.sceneId)} · ${pad.name}`;
      const nameBtn = document.createElement("button");
      nameBtn.textContent = label;
      nameBtn.title = `Fire "${label}" (key ${i + 1}) — double-click to rename`;
      nameBtn.style.cssText = nameBtnStyle;
      // The control that performs the 1-9 shortcut (ui/keyHints.ts): the hover
      // badge and the keys list's flash find it by these.
      nameBtn.dataset.key = "pad";
      nameBtn.dataset.padKey = String(i + 1);
      nameBtn.addEventListener("click", (e) => {
        if (e.detail > 1) return;
        deps.onFirePad(pad.id);
        refresh(true);
      });
      nameBtn.addEventListener("dblclick", () => startRename(pad, nameBtn));

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "✕";
      deleteBtn.title = `Delete "${label}"`;
      deleteBtn.style.cssText = iconBtnStyle;
      deleteBtn.addEventListener("click", () => {
        deps.onDeletePad(pad.id);
        refresh(true);
      });

      row.append(key, markers, nameBtn, deleteBtn);
      list.appendChild(row);
    });
  }

  function refresh(force = false): void {
    if (renaming) return;
    const pads = deps.pads();
    const split = deps.outputOpen();
    const preview = deps.previewPadId();
    // With no separate output this window is the output: the preview pad is the live one.
    const live = split ? deps.livePadId() : preview;
    const runs = deps.autopilotRuns();
    const cfg = deps.autopilot();
    const sig = JSON.stringify([
      pads.map((p) => [p.id, p.name, p.look.sceneId, deps.sceneName(p.look.sceneId)]),
      preview,
      live,
      split,
      runs,
      cfg,
      note,
      pads.length >= deps.minPads,
    ]);
    if (!force && sig === shown) return;
    shown = sig;
    renderList(pads, preview, live, split);
    legend.style.display = split && pads.length > 0 ? "" : "none";
    legend.textContent = "ring = in this preview · dot = live on the output";
    noteEl.style.display = note ? "" : "none";
    noteEl.textContent = note;
    addChip.style.opacity = pads.length >= deps.maxPads ? "0.45" : "";
    renderAutopilot(pads.length);
  }
  refresh(true);

  return { el: card.el, title: card.title, refresh: () => refresh() };
}
