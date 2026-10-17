/**
 * Row hints, shown beside the panel instead of unfolding inside it.
 *
 * Every panel row (`.vc-row`) carries its description in a `.vc-hint` child,
 * built by controlsKit.ts, deviceMenu.ts, audioMeters.ts, powerCard.ts and
 * the scene widgets, and some of them rewrite it while it shows (a compact
 * picker names the hovered chip; a slider adds the auto takeover line). That
 * element no longer unfolds (controlsTheme.ts's `.vc-hint` keeps it out of
 * sight but readable to a screen reader). This module shows a copy of it in
 * one floating layer next to the row's column, level with the row, over the
 * picture. Nothing in the panel changes size, so nothing slides under the
 * cursor. Unfolding in place pushed the rows below down, and going down the
 * list the row you left closed above you, sliding the next row up under a
 * still cursor, often far enough to open the one after it. Cards keeping
 * their size also spares the cable layer a recompute on every hover.
 *
 * Which side: the one facing the middle of the screen, past any other panel
 * column the layer would cover (Power sits against the settings column),
 * else the other side. With less than MIN_SIDE_PX free on both sides (the
 * stacked layout below STACK_BELOW_PX, where the panel is one full-width
 * column) it floats over the rows under the row instead, or above the row
 * near the bottom of the screen, still without moving anything.
 * `placeRowHint` is that geometry alone, tested in tests/rowHints.test.ts.
 *
 * When: hover with a mouse or pen, and focus from the keyboard or a tap.
 * On touch, hover isn't real, and an iPad tap that makes something appear
 * through hover loses its click (controlsTheme.ts's `.vc-hint` comment), so
 * a finger gets the hint through focus only. The mouse moves focus too (a
 * click on a slider, and deviceMenu.ts's wireHoverFocus focuses the hovered
 * row's control so its keys apply), so a focus while the mouse was the last
 * input counts only while the mouse is still on that row: the hint never
 * stays up beside the panel after the pointer has moved onto the picture.
 *
 * Like tooltip.ts it never runs on a timer or per tick: it fills and places
 * itself on the pointer/focus event, then again only when the source hint
 * changes (a MutationObserver on that one element while it shows) or
 * something scrolls or resizes.
 */

/** Space between the column and the layer, and between the layer and any
 *  other panel column it steps past. */
const GAP_PX = 10;
/** Kept clear of the viewport's edges. */
const EDGE_PX = 6;
/** Narrower than this beside the column and the layer floats over the rows. */
const MIN_SIDE_PX = 180;
const MAX_WIDTH_PX = 280;
/** Between the row and the layer when it floats over the rows. */
const OVER_GAP_PX = 2;
const COLUMN_SELECTOR = ".vc-spectrum-col, .vc-power-col, .vc-controls-col";

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface HintSlot {
  left: number;
  top: number;
  width: number;
  /** True beside the column, false floating over the rows. */
  beside: boolean;
}

const overlaps = (a: Box, b: Box): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Where the layer goes for a row: see this file's header. `column` is the
 *  row's own panel column (null when it has no box, as in the stacked
 *  layout), `others` the other panel columns on screen, and `measure`
 *  returns the layer's height at a given width. */
export function placeRowHint(
  row: Box,
  column: Box | null,
  others: readonly Box[],
  viewport: { width: number; height: number },
  measure: (width: number) => number,
): HintSlot {
  const vw = viewport.width, vh = viewport.height;
  const clampTop = (top: number, height: number): number =>
    Math.max(EDGE_PX, Math.min(vh - EDGE_PX - height, top));

  const beside = (side: "left" | "right", col: Box): HintSlot | null => {
    let edge = side === "right" ? col.right + GAP_PX : col.left - GAP_PX;
    // Each pass steps past one column in the way; there are only a few.
    for (let pass = 0; pass <= others.length; pass++) {
      const room = side === "right" ? vw - EDGE_PX - edge : edge - EDGE_PX;
      if (room < MIN_SIDE_PX) return null;
      const width = Math.min(MAX_WIDTH_PX, room);
      const height = measure(width);
      const top = clampTop(row.top, height);
      const left = side === "right" ? edge : edge - width;
      const box = { left, top, right: left + width, bottom: top + height };
      const inTheWay = others.find((o) => overlaps(box, o));
      if (!inTheWay) return { left, top, width, beside: true };
      edge = side === "right" ? inTheWay.right + GAP_PX : inTheWay.left - GAP_PX;
    }
    return null;
  };

  if (column) {
    const towardRight = (column.left + column.right) / 2 < vw / 2;
    const order: ("left" | "right")[] = towardRight ? ["right", "left"] : ["left", "right"];
    for (const side of order) {
      const slot = beside(side, column);
      if (slot) return slot;
    }
  }

  const width = row.right - row.left;
  const height = measure(width);
  let top = row.bottom + OVER_GAP_PX;
  const above = row.top - OVER_GAP_PX - height;
  if (top + height > vh - EDGE_PX && above >= EDGE_PX) top = above;
  return { left: row.left, top: clampTop(top, height), width, beside: false };
}

let layerEl: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let installed = false;
let hoverRow: HTMLElement | null = null;
let focusRow: HTMLElement | null = null;
/** Whether focusRow got focus while the mouse was the last input (see the
 *  header). */
let focusByMouse = false;
/** "mouse" (a mouse or pen), "touch" or "keyboard": whichever was used last. */
let lastInput = "mouse";
let shownHint: HTMLElement | null = null;
let shownRow: HTMLElement | null = null;

function layer(): HTMLElement {
  if (!layerEl) {
    layerEl = document.createElement("div");
    layerEl.className = "vc-row-hint";
    // The row's own hint stays readable to a screen reader; this copy would
    // only read it twice.
    layerEl.setAttribute("aria-hidden", "true");
    layerEl.style.display = "none";
    document.body.appendChild(layerEl);
  }
  return layerEl;
}

const rowOf = (node: EventTarget | null): HTMLElement | null =>
  node instanceof Element ? node.closest<HTMLElement>(".vc-row") : null;

/** The row's own hint, not one inside a row nested in it, when it has
 *  anything to say right now. */
function ownHint(row: HTMLElement): HTMLElement | null {
  for (const hint of row.querySelectorAll<HTMLElement>(".vc-hint")) {
    if (hint.closest(".vc-row") !== row) continue;
    if (hint.hidden || hint.style.display === "none" || !hint.textContent?.trim()) return null;
    return hint;
  }
  return null;
}

/** From the innermost row out, the first one with a hint to show. */
function rowWithHint(row: HTMLElement | null): { row: HTMLElement; hint: HTMLElement } | null {
  for (let r = row; r; r = rowOf(r.parentElement)) {
    const hint = ownHint(r);
    if (hint) return { row: r, hint };
  }
  return null;
}

function hide(): void {
  observer?.disconnect();
  shownHint = null;
  shownRow = null;
  if (layerEl) layerEl.style.display = "none";
}

function fill(): void {
  const el = layer();
  el.replaceChildren(...Array.from(shownHint!.childNodes, (n) => n.cloneNode(true)));
  const accent = getComputedStyle(shownRow!).getPropertyValue("--vc-accent").trim();
  el.style.setProperty("--c", accent || "#fff");
}

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
const hasBox = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function place(): void {
  const row = shownRow!;
  if (!row.isConnected || !hasBox(row)) {
    hide();
    return;
  }
  const el = layer();
  el.style.display = "block";
  const column = row.closest<HTMLElement>(COLUMN_SELECTOR);
  const others = Array.from(document.querySelectorAll<HTMLElement>(COLUMN_SELECTOR))
    .filter((c) => c !== column && !c.contains(row) && hasBox(c))
    .map((c) => boxOf(c.getBoundingClientRect()));
  const slot = placeRowHint(
    boxOf(row.getBoundingClientRect()),
    column && hasBox(column) ? boxOf(column.getBoundingClientRect()) : null,
    others,
    { width: window.innerWidth, height: window.innerHeight },
    (width) => {
      el.style.width = `${width}px`;
      return el.offsetHeight;
    },
  );
  el.style.width = `${slot.width}px`;
  el.style.left = `${slot.left}px`;
  el.style.top = `${slot.top}px`;
  el.classList.toggle("vc-row-hint-over", !slot.beside);
}

function update(): void {
  const focused = focusRow?.isConnected && (!focusByMouse || hoverRow === focusRow) ? focusRow : null;
  const target = rowWithHint(hoverRow?.isConnected ? hoverRow : focused);
  if (!target) {
    hide();
    return;
  }
  if (target.hint !== shownHint) {
    shownHint = target.hint;
    shownRow = target.row;
    observer ??= new MutationObserver(() => {
      if (!shownHint) return;
      if (!rowWithHint(shownRow)) hide();
      else {
        fill();
        place();
      }
    });
    observer.disconnect();
    observer.observe(target.hint, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  fill();
  place();
}

/** Starts the floating row hints for the whole page; later calls do
 *  nothing. deviceMenu.ts calls it when it builds the panel. */
export function installRowHints(): void {
  if (installed) return;
  installed = true;
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const row = rowOf(e.target);
    if (row === hoverRow) return;
    hoverRow = row;
    update();
  });
  document.addEventListener("pointerout", (e) => {
    // Leaving the window: no pointerover follows.
    if (e.pointerType === "touch" || e.relatedTarget) return;
    hoverRow = null;
    update();
  });
  const inputOf = (e: PointerEvent): string => (e.pointerType === "touch" ? "touch" : "mouse");
  document.addEventListener(
    "pointermove",
    (e) => {
      lastInput = inputOf(e);
    },
    { capture: true, passive: true },
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      lastInput = inputOf(e);
      // A tap anywhere else drops the tapped row's hint, whether or not the
      // tap moves focus (a tap on the picture focuses nothing).
      if (e.pointerType === "touch" && rowOf(e.target) !== focusRow) {
        focusRow = null;
        update();
      }
    },
    true,
  );
  document.addEventListener("focusin", (e) => {
    focusRow = rowOf(e.target);
    focusByMouse = lastInput === "mouse";
    update();
  });
  document.addEventListener("focusout", (e) => {
    if (rowOf(e.relatedTarget) === focusRow) return;
    focusRow = null;
    update();
  });
  document.addEventListener(
    "keydown",
    () => {
      lastInput = "keyboard";
    },
    true,
  );
  const reposition = (): void => {
    if (shownRow) place();
  };
  document.addEventListener("scroll", reposition, { capture: true, passive: true });
  window.addEventListener("resize", reposition);
}
