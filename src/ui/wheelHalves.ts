/**
 * A wheel turned anywhere on the screen's left half scrolls the meters column,
 * anywhere on the right half the settings column — over the scene, over a card
 * that doesn't scroll, over the gap between columns. deviceMenu.ts adds it
 * while the panel is open, wide layout only (stacked, the page itself scrolls).
 *
 * A wheel over anything that scrolls on its own (a column, the scene list, a
 * long dropdown) is left to the browser, even at that scroller's end, so the
 * wheel never jumps to a column the pointer isn't on.
 */

const LINE_PX = 16;

export function routeWheelByHalves(cols: { left: HTMLElement; right: HTMLElement; enabled: () => boolean }): () => void {
  const onWheel = (e: WheelEvent) => {
    if (!cols.enabled()) return;
    if (e.ctrlKey || e.deltaY === 0) return; // ctrl+wheel and trackpad pinch are page zoom
    if (e.target instanceof Element && insideScroller(e.target)) return;
    const col = e.clientX < window.innerWidth / 2 ? cols.left : cols.right;
    if (col.getClientRects().length === 0) return;
    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? LINE_PX : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? col.clientHeight : 1;
    col.scrollTop += e.deltaY * unit;
  };
  document.addEventListener("wheel", onWheel, { passive: true });
  return () => document.removeEventListener("wheel", onWheel);
}

function insideScroller(el: Element): boolean {
  for (let n: Element | null = el; n && n !== document.documentElement && n !== document.body; n = n.parentElement) {
    if (n.scrollHeight <= n.clientHeight) continue;
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return true;
  }
  return false;
}
