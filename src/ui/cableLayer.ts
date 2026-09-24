/**
 * The patch bay's cables (src/ui/deviceMenu.ts's own plan doc): one `<svg>`
 * fixed over the whole viewport, appended to `document.body` above
 * `.vc-root` (controlsTheme.ts's z-index), drawing a soft bezier from each
 * of the shown (preview ?? pinned) setting's own sources to that setting's
 * row port. Lives outside `.vc-root` on purpose — every card is
 * `overflow: hidden` (controlsTheme.ts), and a cable has to cross from a
 * meter jack, through the gutter between the two columns, to a scene row's
 * port, which a card's own clipping would cut.
 *
 * Geometry (every `getBoundingClientRect` read) only happens in recompute(),
 * called by deviceMenu.ts on a selection/patch change and on its own list
 * of layout triggers (scroll, resize, fold, ResizeObserver, a Scene-card
 * rebuild) — never per frame. Each call is one batch of reads (endpointFor)
 * then one batch of writes (the `<path>` elements it builds). tick() is the
 * only per-frame entry point, and it only ever writes `stroke-dashoffset` —
 * no reads, so it can run every rAF tick for free.
 */

export interface CableSourceSpec {
  /** Unique per cable within one recompute() call — carries a flowing
   *  dash's offset across a rebuild so a patch edit elsewhere doesn't
   *  visibly restart this cable's flow. */
  key: string;
  color: string;
  /** A scene-mix source (drives.ts's sceneSources) — dashed, dimmer, no
   *  "just plugged" draw-on. */
  soft: boolean;
  jackEl: HTMLElement;
  /** Read every tick — flow speed rides this source's own live value. */
  getValue: () => number;
  /** This source was just toggled on — draws on over ~250ms
   *  (controlsTheme.ts's vc-cable-new rule) instead of appearing instantly. */
  isNew?: boolean;
}

export interface CableLayer {
  el: SVGSVGElement;
  /** Full rebuild — see this file's header. Call with `sources: []` or
   *  `portEl: null` to clear every cable (nothing shown). */
  recompute(sources: readonly CableSourceSpec[], portEl: HTMLElement | null): void;
  /** Per-tick dash-offset advance, speed ∝ each cable's own live value —
   *  no DOM reads. A no-op under prefers-reduced-motion. */
  tick(dtSec: number): void;
  setVisible(v: boolean): void;
}

const NS = "http://www.w3.org/2000/svg";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A jack or port's own centre in viewport coordinates — matching the
 *  `<svg>`'s own fixed, unscaled coordinate space (see createCableLayer's
 *  own element, `position: fixed; inset: 0`, no viewBox). In the plan's own
 *  words:
 *   - a jack inside a folded card has no layout box at all
 *     (`.vc-card-body{display:none}`) — same "no client rects" probe
 *     ringElements() (deviceMenu.ts) already uses — so the cable ends at
 *     that card's own header instead;
 *   - a jack scrolled outside its column's own visible band (`.vc-meters`/
 *     `.vc-controls-col`) — the cable ends at the column's visible edge;
 *   - otherwise, the element's own centre. */
function endpointFor(el: HTMLElement): { x: number; y: number } | null {
  if (el.getClientRects().length === 0) {
    const header = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head");
    if (!header) return null;
    const r = header.getBoundingClientRect();
    return { x: r.right - 8, y: r.top + r.height / 2 };
  }
  const r = el.getBoundingClientRect();
  let y = r.top + r.height / 2;
  const scroller = el.closest<HTMLElement>(".vc-meters, .vc-controls-col");
  if (scroller) {
    const sr = scroller.getBoundingClientRect();
    if (y < sr.top) y = sr.top + 2;
    else if (y > sr.bottom) y = sr.bottom - 2;
  }
  return { x: r.left + r.width / 2, y };
}

function pathEl(cls: string, d: string, color: string): SVGPathElement {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", cls);
  p.setAttribute("d", d);
  p.setAttribute("stroke", color);
  return p;
}

export function createCableLayer(): CableLayer {
  const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("class", "vc-cable-layer");
  svg.setAttribute("aria-hidden", "true");

  let flows: { el: SVGPathElement; key: string; getValue: () => number }[] = [];
  // Keyed by source key so a rebuild (a patch edit, a scroll) doesn't snap
  // a still-connected cable's flow back to 0 — only a cable that stops
  // existing loses its offset.
  const offsets = new Map<string, number>();

  function recompute(sources: readonly CableSourceSpec[], portEl: HTMLElement | null): void {
    // Pass 1 — every getBoundingClientRect() read, none of it interleaved
    // with a DOM write (this file's own header, and the carried rule
    // against layout thrashing): the port's own endpoint, then each
    // source's, before a single path element is built.
    if (!portEl || !sources.length) {
      svg.textContent = "";
      flows = [];
      return;
    }
    const portPt = endpointFor(portEl);
    if (!portPt) {
      svg.textContent = "";
      flows = [];
      return;
    }
    const resolved = sources
      .map((src) => ({ src, pt: endpointFor(src.jackEl) }))
      .filter((r): r is { src: CableSourceSpec; pt: { x: number; y: number } } => r.pt !== null);

    // Pass 2 — every write: clear the old cables, build and append the new
    // ones, forget any carried flow offset nothing still uses.
    svg.textContent = "";
    flows = [];
    const { x: x2, y: y2 } = portPt;
    const liveKeys = new Set<string>();
    for (const { src, pt } of resolved) {
      liveKeys.add(src.key);
      const dx = Math.max(40, (x2 - pt.x) * 0.55);
      const d = `M${pt.x},${pt.y} C${pt.x + dx},${pt.y} ${x2 - dx},${y2} ${x2},${y2}`;
      const soft = src.soft ? " vc-cable-soft" : "";
      const isNew = !!src.isNew && !reduceMotion();
      const newCls = isNew ? " vc-cable-new" : "";
      const glow = pathEl(`vc-cable-glow${soft}${newCls}`, d, src.color);
      const core = pathEl(`vc-cable-core${soft}${newCls}`, d, src.color);
      core.setAttribute("pathLength", "100");
      const flow = pathEl(`vc-cable-flow${soft}${newCls}`, d, src.color);
      if (isNew) {
        glow.style.setProperty("--o", "0.13");
        flow.style.setProperty("--o", src.soft ? "0.4" : "0.9");
      }
      const off = offsets.get(src.key) ?? 0;
      flow.setAttribute("stroke-dashoffset", off.toFixed(2));
      svg.append(glow, core, flow);
      flows.push({ el: flow, key: src.key, getValue: src.getValue });
    }
    // Forget any source's carried offset that no longer has a cable —
    // otherwise a long session leaks one Map entry per source ever shown.
    for (const k of [...offsets.keys()]) if (!liveKeys.has(k)) offsets.delete(k);
  }

  return {
    el: svg,
    recompute,
    tick(dtSec) {
      if (!flows.length || reduceMotion()) return;
      for (const f of flows) {
        const v = Math.max(0, Math.min(1.5, f.getValue()));
        const next = (offsets.get(f.key) ?? 0) - (6 + 70 * v) * dtSec;
        offsets.set(f.key, next);
        f.el.setAttribute("stroke-dashoffset", next.toFixed(2));
      }
    },
    setVisible(v) {
      svg.style.display = v ? "" : "none";
    },
  };
}
