/**
 * Persisted fold state for the controls panel's cards (createCard in
 * controlsKit.ts) — which cards in the left column are collapsed to just
 * their title bar. Global per device, not per scene: like
 * src/audio/bandSplit.ts, this describes how you like to look at the panel,
 * not one scene's settings. Same in-memory-cache-over-localStorage pattern as
 * that module: the cache is the source of truth for get/set within a
 * session, seeded once from localStorage, so behavior stays correct even
 * where localStorage is unavailable (node test env, Safari private mode).
 *
 * This is panel view state, not app state — it has no reader outside
 * src/ui/, which is why it's a standalone store rather than routed through
 * DeviceMenuDeps the way every scene/audio/palette read and write is (see
 * deviceMenu.ts's header comment).
 *
 * Absent key = open (a card starts expanded the first time it's ever seen).
 */

export interface PanelFolds {
  [cardId: string]: boolean;
}

const STORAGE_KEY = "vibe.panelFolds";

function loadInitial(): PanelFolds {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next: PanelFolds = {};
    for (const [id, folded] of Object.entries(parsed)) {
      if (typeof folded === "boolean") next[id] = folded;
    }
    return next;
  } catch {
    return {};
  }
}

let cache: PanelFolds = loadInitial();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — fold state just won't persist across reloads.
  }
}

/** `defaultFolded` covers a disclosure that should start collapsed the first
 *  time it's ever seen (a scene's `advanced` settings sub-section) rather
 *  than the card convention above of starting open — still governed by the
 *  same "absent key means never explicitly toggled" rule, just with the
 *  opposite starting point. */
export function isFolded(cardId: string, defaultFolded = false): boolean {
  return cache[cardId] ?? defaultFolded;
}

export function setFolded(cardId: string, folded: boolean): void {
  if (folded) cache = { ...cache, [cardId]: true };
  else {
    if (!(cardId in cache)) return;
    const { [cardId]: _omit, ...rest } = cache;
    cache = rest;
  }
  persist();
}

/** Applies the same fold state to every id in `cardIds` — the fold-all chip. */
export function setFoldedAll(cardIds: readonly string[], folded: boolean): void {
  for (const id of cardIds) setFolded(id, folded);
}
