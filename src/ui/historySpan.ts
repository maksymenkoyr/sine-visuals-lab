/**
 * How much time each meter card's traces span — the span chip in a meter
 * card's header (audioMeters.ts) cycles through HISTORY_SPANS, and the
 * choice is remembered per card. Global per device, not per scene, like
 * panelFolds.ts: it's how you like to look at the panel, not one scene's
 * settings, and it changes nothing a scene draws, so it's one of
 * src/net/syncedStores.ts's PRIVATE_KEYS. Same in-memory-cache-over-localStorage
 * pattern as panelFolds.ts, so it keeps working where localStorage is
 * unavailable.
 *
 * Absent key = the first entry in HISTORY_SPANS.
 */

/** Seconds, shortest first. The first is every card's default; the last is
 *  how much history a meter trace keeps (createColumnRing's own capacity). */
export const HISTORY_SPANS: readonly number[] = [10, 30, 60, 300];
export const HISTORY_SPAN_DEFAULT = HISTORY_SPANS[0];
export const HISTORY_SPAN_MAX = HISTORY_SPANS[HISTORY_SPANS.length - 1];

const STORAGE_KEY = "vibe.historySpans";

function loadInitial(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const next: Record<string, number> = {};
    for (const [id, sec] of Object.entries(parsed)) {
      if (typeof sec === "number" && HISTORY_SPANS.includes(sec)) next[id] = sec;
    }
    return next;
  } catch {
    return {};
  }
}

let cache: Record<string, number> = loadInitial();

export function getHistorySpan(cardId: string): number {
  return cache[cardId] ?? HISTORY_SPAN_DEFAULT;
}

/** Advances `cardId` to the next entry in HISTORY_SPANS, wrapping to the
 *  first, and returns it. */
export function cycleHistorySpan(cardId: string): number {
  const i = HISTORY_SPANS.indexOf(getHistorySpan(cardId));
  const next = HISTORY_SPANS[(i + 1) % HISTORY_SPANS.length];
  cache = { ...cache, [cardId]: next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // Not fatal — the span just won't persist across reloads.
  }
  return next;
}

/** "10s", "60s", "5m" — the chip's own label. */
export function formatHistorySpan(sec: number): string {
  return sec >= 120 && sec % 60 === 0 ? `${sec / 60}m` : `${sec}s`;
}
