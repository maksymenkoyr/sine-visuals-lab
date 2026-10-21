/**
 * The Play column's list (issue #620): one row per difference between NEXT
 * (this window's look) and LIVE (what the output holds). A row has ▸ to send
 * only that change and × to drop it (NEXT takes LIVE's value back). The
 * differences come from net/lookDiff.ts; the words from rowWords.ts.
 *
 * The list is rebuilt only when the rows themselves change, so a button under
 * the pointer is not replaced between its press and its release.
 */
import { diffLooks, dropRowText, takeRow, type LookRow } from "../../net/lookDiff.ts";
import type { OutputState } from "../../net/outputSync.ts";

export interface PlayListDeps {
  listEl: HTMLElement;
  countEl: HTMLElement;
  /** bridge.looks(); both null while no output is open. */
  looks(): { next: OutputState | null; live: OutputState | null };
  /** bridge.sendState(state, glideMs). */
  send(state: OutputState, glideMs?: number): void;
  /** How long a sent change takes to land, from the PLAY LANDS chips; 0 for Cut. */
  landMs(): number;
  /** A row in plain words: what it is, LIVE's value, NEXT's value. */
  describe(row: LookRow): { name: string; from: string; to: string };
  /** Puts LIVE's value back into NEXT for a storage row: text null removes the key. */
  dropStorage(key: string, text: string | null): void;
  dropPalette(paletteId: string): void;
  /** A scene row: NEXT takes LIVE's whole look. */
  dropScene(live: OutputState): void;
}

/** How often the two looks are read while the desk is shown. */
const READ_MS = 200;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createPlayList(deps: PlayListDeps): { tick(nowMs: number): void; rows(): readonly LookRow[] } {
  let lastReadMs = -Infinity;
  let looks: { next: OutputState | null; live: OutputState | null } = { next: null, live: null };
  let rows: LookRow[] = [];
  let shownKey = "";

  /** Makes the next tick read the looks again, after this list changed them. */
  function forceRead(): void {
    lastReadMs = -Infinity;
  }

  function send(row: LookRow): void {
    const { next, live } = looks;
    if (!next || !live) return;
    deps.send(takeRow(live, next, row), deps.landMs());
    forceRead();
  }

  function drop(row: LookRow): void {
    const { next, live } = looks;
    if (!next || !live) return;
    if (row.kind === "scene") deps.dropScene(live);
    else if (row.kind === "palette") deps.dropPalette(live.palette);
    else deps.dropStorage(row.storageKey, dropRowText(next, live, row) ?? null);
    forceRead();
  }

  function rowEl(row: LookRow): HTMLElement {
    const li = el("li", "desk-row");
    const words = deps.describe(row);
    li.appendChild(el("span", "desk-row-name", words.name));
    const vals = el("span", "desk-row-vals");
    vals.appendChild(el("s", undefined, words.from));
    vals.appendChild(document.createTextNode(" → "));
    vals.appendChild(el("b", undefined, words.to));
    li.appendChild(vals);
    const one = el("button", "desk-row-one", "▸");
    one.type = "button";
    one.title = "Send only this change";
    one.addEventListener("click", () => send(row));
    const x = el("button", "desk-row-x", "×");
    x.type = "button";
    x.title = "Drop this change: NEXT goes back to LIVE";
    x.addEventListener("click", () => drop(row));
    li.append(one, x);
    return li;
  }

  function show(): void {
    deps.listEl.replaceChildren();
    if (rows.length === 0) {
      deps.listEl.appendChild(el("li", "desk-empty", "LIVE shows NEXT. Move a fader below and it lands here."));
    } else {
      for (const row of rows) deps.listEl.appendChild(rowEl(row));
    }
    deps.countEl.textContent = rows.length > 0 ? String(rows.length) : "";
    deps.countEl.classList.toggle("some", rows.length > 0);
  }

  return {
    tick(nowMs) {
      if (nowMs - lastReadMs < READ_MS) return;
      lastReadMs = nowMs;
      looks = deps.looks();
      rows = looks.next && looks.live ? diffLooks(looks.next, looks.live) : [];
      const key = JSON.stringify(rows);
      if (key === shownKey) return;
      shownKey = key;
      show();
    },
    rows: () => rows,
  };
}
