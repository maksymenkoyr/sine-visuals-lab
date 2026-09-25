/**
 * The patch bay's instant tooltip (the "cover everything with hints" pass):
 * a small floating label for a jack, a row's own input port, or a row's
 * own sparkline — the three affordances that live *outside* the pinned
 * patch panel, which gets its own bottom hint line instead
 * (deviceMenu.ts's buildPatchPanel). One singleton element, lazily created
 * and reused for every caller (deviceMenu.ts's onJackHover, buildDriveRow's
 * port/sparkline) rather than one per control, since only one can ever be
 * shown at a time. Shown with no delay and hidden the instant the pointer
 * leaves or focus moves on — never rebuilt on a timer, matching this
 * panel's own carried rule against per-tick DOM work: `show`/`hide` only
 * ever run from a pointerenter/focus/pointerleave/blur handler, never from
 * update() or the ~10 Hz refreshAuto pass.
 *
 * Positioning reads the target's own `getBoundingClientRect()` — a
 * one-shot read on the hover/focus event that triggered it, not a per-tick
 * layout read — then places the tooltip above the target (or below, if
 * there's no room), clamped to the viewport.
 */

export interface Tooltip {
  el: HTMLElement;
  /** Positions and fills the tooltip near `target`, in `color`'s left
   *  rule. `lines` are stacked as separate rows — a jack's own two-line
   *  "<Source> — <description>" / "Click to plug into <X>" shape, or a
   *  single line elsewhere (a row port, a row's own sparkline). */
  show(target: HTMLElement, color: string, lines: readonly string[]): void;
  hide(): void;
}

function createTooltipEl(): Tooltip {
  const el = document.createElement("div");
  el.className = "vc-tooltip";
  el.setAttribute("role", "tooltip");
  el.style.display = "none";

  function show(target: HTMLElement, color: string, lines: readonly string[]): void {
    el.style.setProperty("--c", color);
    el.replaceChildren(...lines.map((line) => Object.assign(document.createElement("div"), { textContent: line })));
    // Shown (off-screen-safe: display:none has no box, so measure only
    // after it's visible) before reading its own size, so offsetWidth/
    // Height reflect the real content rather than a stale previous show.
    el.style.left = "0px";
    el.style.top = "0px";
    el.style.display = "block";
    const r = target.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(6, Math.min(window.innerWidth - tw - 6, left));
    let top = r.top - th - 8;
    if (top < 4) top = r.bottom + 8;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  function hide(): void {
    el.style.display = "none";
  }

  return { el, show, hide };
}

let singleton: Tooltip | null = null;
function tooltip(): Tooltip {
  if (!singleton) {
    singleton = createTooltipEl();
    document.body.appendChild(singleton.el);
  }
  return singleton;
}

/** Shows the shared tooltip near `target` — see this file's header. Safe to
 *  call from any module; there's only ever one tooltip on screen. */
export function showTooltip(target: HTMLElement, color: string, lines: readonly string[]): void {
  tooltip().show(target, color, lines);
}

export function hideTooltip(): void {
  singleton?.hide();
}
