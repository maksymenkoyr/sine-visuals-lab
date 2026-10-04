/**
 * The patch bay's cables (src/ui/deviceMenu.ts's own plan doc): one `<svg>`
 * fixed over the whole viewport, appended to `document.body` above
 * `.vc-root` (controlsTheme.ts's z-index), drawing a soft bezier from a
 * source's own jack to a setting's row port. Lives outside `.vc-root` on
 * purpose — every card is `overflow: hidden` (controlsTheme.ts), and a
 * cable has to cross from a meter jack, over the open middle between the
 * docked settings/meters columns, to a scene row's port, which a card's own
 * clipping would cut.
 *
 * recompute() takes two independent groups — pinned and preview — rather
 * than one "shown" set, so both can be on screen together: hovering a
 * different setting than whatever's pinned draws both at once (see
 * deviceMenu.ts's refreshMeta/togglePin/previewDrive for how "pinned" vs
 * "the active preview" are told apart, and controlsTheme.ts's
 * `.vc-drive-pinned`/`.vc-drive-preview` for the matching row treatment).
 * The pinned group keeps this file's full glow/core/flow structure, dimmed
 * to `.vc-cable-dimmed` while a preview is also live so it doesn't compete
 * with it; the preview group is a single thin dashed `.vc-cable-preview`
 * path per source — no glow layer, no flow dash, so a transient hover never
 * costs the tick loop anything and never looks as "committed" as a pinned
 * patch. A source key is namespaced per group (`pinned:`/`preview:`) so the
 * same physical jack can carry both a pinned and a preview cable at once
 * without their flow offsets colliding.
 *
 * A third group, `fan`, answers "where does this signal go": while a
 * signal's row is lit (deviceMenu.ts's own lit-row tracking — the same
 * hover/focus glow controlsTheme.ts's `.vc-row:hover/:focus-within` draws),
 * every wire that leaves its jack is drawn to every port it reaches in the
 * scene — one jack fanning out, where pinned/preview are many jacks into
 * one port. It is drawn under the other two, flat and static like a
 * preview (`.vc-cable-fan`, solid where a preview is dashed), so it costs
 * the tick loop nothing.
 *
 * A source carrying its own onPress (CableSourceSpec below) is pressable:
 * it's drawn inside a `.vc-cable-g` group with a transparent hit stroke
 * over it (controlsTheme.ts's .vc-cable-hit — the layer itself stays
 * pointer-events:none, so only that stroke answers the pointer, and its
 * width is what makes a thin cable easy to press), and a click on the
 * stroke calls onPress — deviceMenu.ts wires it to the same patch toggle
 * the source line's own × button takes, so pressing a cable unplugs it.
 * The group also carries the hover lift (controlsTheme.ts's
 * .vc-cable-g:hover rules — a neon-ish bloom in the cable's own colour,
 * a thicker core, a brighter glow, and the flow beads lightened so the
 * signal still visibly runs inside it) and holds that colour as its CSS
 * `color` so the bloom's currentColor resolves per cable.
 * deviceMenu.ts only ever sets onPress on the pinned group's real patch
 * sources: a preview cable and a display-only scene mix are decoration,
 * not something a press should edit.
 *
 * Resting the pointer on a pressable cable — still, for REVEAL_REST_MS —
 * scrolls its two ends into view (revealEnds): the signal's jack in the
 * meters column and the setting's port in the settings column, each only
 * if it's out of its column's visible band (where endpointFor clamps it).
 * The pointer is never moved; a move of more than REVEAL_STILL_PX restarts
 * the wait, and one rest reveals once. The wait lives in the layer, not on
 * the elements, because the scroll's own recompute() rebuilds every path —
 * including the one under the pointer.
 *
 * Every cable leaves its jack and enters its port through a short straight
 * CABLE_STUB_PX run before the bezier takes over (cablePathD) — a real
 * patch cable doesn't leave a socket at an angle. The bezier's own travel
 * direction (and so which way each stub points) is derived from the
 * resolved endpoints' actual x positions, not assumed left-to-right: the
 * meters column docks left of the settings column in the ordinary case
 * (controlsTheme.ts's wide layout), but a jack's own endpoint can still
 * clamp to the right of its port in an edge case (endpointFor below, e.g. a
 * jack scrolled past its column's visible band) — deriving the direction
 * keeps the stub/bend leaving "outward" (toward the port) and arriving
 * "inward" (from the jack's side) with no kink either way, rather than
 * assuming the common case always holds.
 *
 * Power (.vc-power-col) sits fixed in the screen's own top-right corner,
 * right beside the settings column, while the settings column scrolls
 * independently underneath/past it — so a port can end up rendered at any
 * y a user scrolls it to, including right behind Power's own card. Since
 * the cable layer paints above every card (its whole reason for living
 * outside .vc-root — see this file's header), a straight bezier into such
 * a port would visibly run across Power's glass rather than the open
 * middle. cablePathD detours a cable whose *port* end falls in Power's own
 * vertical band (with a small margin) down under its bottom edge first —
 * a jack's own end is never checked, since Power sits beside the settings
 * column, nowhere near the meters side a jack lives on.
 *
 * Geometry (every `getBoundingClientRect` read) only happens in recompute(),
 * called by deviceMenu.ts on a selection/patch change and on its own list
 * of layout triggers (scroll, resize, fold, ResizeObserver, a Scene-card
 * rebuild) — never per frame. Each call is one batch of reads (endpointFor)
 * then one batch of writes (the `<path>` elements it builds). tick() is the
 * only per-frame entry point, and it only ever writes `stroke-dashoffset` on
 * the pinned group's own flow paths — no reads, so it can run every rAF
 * tick for free; the preview group never animates, so it never needs a tick
 * write either.
 */

export interface CableSourceSpec {
  /** Unique per cable within one recompute() call — carries a flowing
   *  dash's offset across a rebuild so a patch edit elsewhere doesn't
   *  visibly restart this cable's flow. */
  key: string;
  color: string;
  /** A scene-mix source (drives.ts's sceneSources) — dashed, dimmer, no
   *  "just plugged" draw-on. Only meaningful on the pinned group; a preview
   *  cable is always drawn in its own flat style regardless. */
  soft: boolean;
  /** This is one of an Only when patch's own gate conditions (drives.ts's
   *  gateConditionIndices — there can be more than one now) — a longer dash
   *  on the core than `soft`'s, so the gate reads distinctly in the cables
   *  too (controlsTheme.ts's .vc-cable-cond). Mutually exclusive with `soft`
   *  in practice (a scene mix has no patch sources to gate —
   *  deviceMenu.ts's cableGroupFor). */
  cond?: boolean;
  /** This source is muted (drives.ts's `DriveSource.off`) — draws in the
   *  flat, dashed `.vc-cable-muted` style instead of the usual glow/core/
   *  flow structure (no glow, no flow animation), overriding `cond`/`soft`
   *  outright: mute is the more specific fact about this cable right now.
   *  Only ever true on the pinned group — deviceMenu.ts's cableGroupFor
   *  only builds this from a real patch's own sources, never a preview's
   *  flat style (which has no mute concept of its own). */
  muted?: boolean;
  jackEl: HTMLElement;
  /** Read every tick — flow speed rides this source's own live value.
   *  Unused for a preview cable (it never animates). */
  getValue: () => number;
  /** Pressing this cable's hit stroke unplugs the source — see this
   *  file's header. When set, the cable is wrapped in a `.vc-cable-g`
   *  group with a `.vc-cable-hit` stroke over it that answers the
   *  pointer; when absent the paths stay plain and click-transparent.
   *  deviceMenu.ts's cableGroupFor only ever sets it on the pinned
   *  group's real patch sources. */
  onPress?: () => void;
  /** This source was just toggled on — draws on over ~250ms
   *  (controlsTheme.ts's vc-cable-new rule) instead of appearing instantly.
   *  Only ever true on the pinned group — a preview is never mid-edit. */
  isNew?: boolean;
}

/** One end of a cable group: its sources and the port they all point at.
 *  Empty `sources` or a null `portEl` draws nothing for that group. */
export interface CableGroupSpec {
  sources: readonly CableSourceSpec[];
  portEl: HTMLElement | null;
}

export interface CableLayer {
  el: SVGSVGElement;
  /** Full rebuild — see this file's header. `preview` is drawn on top of
   *  `pinned`, and `fan` (a lit signal's wires, one group per port it
   *  reaches) under both; pass an empty-sources group (or no fan groups)
   *  to draw only the others (or none). */
  recompute(pinned: CableGroupSpec, preview: CableGroupSpec, fan?: readonly CableGroupSpec[]): void;
  /** Per-tick dash-offset advance for the pinned group's own flow, speed ∝
   *  each source's own live value — no DOM reads. A no-op under
   *  prefers-reduced-motion. */
  tick(dtSec: number): void;
  setVisible(v: boolean): void;
}

const NS = "http://www.w3.org/2000/svg";
// One MediaQueryList for the file, made on first use (matchMedia() parses the
// query and allocates a list per call, and tick() asks every frame). `.matches`
// on a held list is live, so an OS setting change is still picked up; the lazy
// init keeps `window` untouched at import time.
let reduceMotionMQ: MediaQueryList | null = null;
const reduceMotion = () => (reduceMotionMQ ??= window.matchMedia("(prefers-reduced-motion: reduce)")).matches;

/** How far a cable runs straight out of its jack (and straight into its
 *  port) before the bezier bend starts — see this file's header. */
const CABLE_STUB_PX = 14;

/** How long the pointer must rest on a pressable cable before its ends
 *  scroll into view, and how far it may drift and still count as resting —
 *  see this file's header. */
const REVEAL_REST_MS = 350;
const REVEAL_STILL_PX = 3;
/** Room kept between a revealed end and its column's edge, so the jack or
 *  port lands clear of the edge rather than flush against it. */
const REVEAL_MARGIN_PX = 40;

/** Extra clearance kept above/below Power's own card before a port counts
 *  as "in its band" (cablePathD's own detour) — enough that the detoured
 *  cable's curve doesn't itself brush the card it's avoiding. */
const CABLE_AVOID_MARGIN_PX = 14;

/** Power's own current screen band, or null while it isn't rendered (a
 *  folded panel) — read once per recompute() alongside every other
 *  endpoint, not per cable. See this file's header for why cablePathD
 *  needs it at all. */
function powerAvoidBand(): { top: number; bottom: number } | null {
  const el = document.querySelector<HTMLElement>(".vc-power-col");
  if (!el || el.getClientRects().length === 0) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top - CABLE_AVOID_MARGIN_PX, bottom: r.bottom + CABLE_AVOID_MARGIN_PX };
}

/** A jack or port's own centre in viewport coordinates — matching the
 *  `<svg>`'s own fixed, unscaled coordinate space (see createCableLayer's
 *  own element, `position: fixed; inset: 0`, no viewBox). In the plan's own
 *  words:
 *   - a jack inside a folded card has no layout box at all
 *     (`.vc-card-body{display:none}`) — same "no client rects" probe
 *     ringElements() (deviceMenu.ts) already uses — so the cable ends at
 *     that card's own header instead (and, if the header has no box either
 *     — the column itself is hidden — there is no endpoint and no cable);
 *   - a jack scrolled outside its column's own visible band (`.vc-meters`/
 *     `.vc-controls-col`) — the cable ends at the column's visible edge;
 *   - otherwise, the element's own centre. */
function endpointFor(el: HTMLElement): { x: number; y: number } | null {
  if (el.getClientRects().length === 0) {
    const header = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head");
    // The header has no box either when the whole column is hidden (M, or
    // every card folded away) — its rect would be all zeros and the cable
    // would run to the viewport's top-left corner, so draw nothing instead.
    if (!header || header.getClientRects().length === 0) return null;
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

/** The jack->port path, stub-out, bend, stub-in — see this file's header.
 *  `dir` (+1 rightward, -1 leftward) is which way the cable actually
 *  travels between these two *resolved* endpoints, so a cable still gets a
 *  stub that leaves the jack outward and a matching tangent into the port
 *  rather than a kink even when clamping (endpointFor) puts one on the
 *  "wrong" side of the other. */
function cablePathD(
  pt: { x: number; y: number },
  port: { x: number; y: number },
  avoidBand: { top: number; bottom: number } | null,
): string {
  const dir = port.x >= pt.x ? 1 : -1;
  const jackStubX = pt.x + dir * CABLE_STUB_PX;
  const portStubX = port.x - dir * CABLE_STUB_PX;
  if (avoidBand && port.y >= avoidBand.top && port.y <= avoidBand.bottom) {
    // Two smooth cubics via a waypoint under Power's own bottom edge,
    // rather than one straight bezier into the port — see this file's
    // header. Horizontal tangents at the waypoint (both control points
    // share its y) keep the dip-then-rise seamless, the same C1-continuity
    // trick the single-cubic path below gets for free from its own stubs.
    const wpX = (jackStubX + portStubX) / 2;
    const wpY = avoidBand.bottom;
    const dx1 = Math.max(30, Math.abs(wpX - jackStubX) * 0.6);
    const dx2 = Math.max(30, Math.abs(portStubX - wpX) * 0.6);
    return (
      `M${pt.x},${pt.y} H${jackStubX} ` +
      `C${jackStubX + dir * dx1},${pt.y} ${wpX - dir * dx1},${wpY} ${wpX},${wpY} ` +
      `C${wpX + dir * dx2},${wpY} ${portStubX - dir * dx2},${port.y} ${portStubX},${port.y} ` +
      `H${port.x}`
    );
  }
  const dx = Math.max(40, Math.abs(portStubX - jackStubX) * 0.55);
  const cp1x = jackStubX + dir * dx;
  const cp2x = portStubX - dir * dx;
  return `M${pt.x},${pt.y} H${jackStubX} C${cp1x},${pt.y} ${cp2x},${port.y} ${portStubX},${port.y} H${port.x}`;
}

function pathEl(cls: string, d: string, color: string): SVGPathElement {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", cls);
  p.setAttribute("d", d);
  p.setAttribute("stroke", color);
  return p;
}

/** One drawn cable's own wrapper group — see this file's header. Holds
 *  the glow/core/flow (or flat) paths and, for a pressable source, the
 *  hit stroke that answers the pointer; `.vc-cable-g:hover` (the hover
 *  lift) keys off the group being hovered, which the hit stroke's own
 *  hit-testing propagates to. The cable's own colour also rides the
 *  group as CSS `color`, so the hover bloom's currentColor drop-shadow
 *  (controlsTheme.ts) resolves per cable without that rule ever naming
 *  a colour. */
function groupEl(color: string): SVGGElement {
  const g = document.createElementNS(NS, "g");
  g.setAttribute("class", "vc-cable-g");
  g.style.color = color;
  return g;
}

/** Scrolls one cable end (a jack or a port) into its column's visible band
 *  if it's outside it — see this file's header. An end inside a folded card
 *  has no box, so its card's header stands in, as in endpointFor. */
function revealEnd(el: HTMLElement): void {
  let target: HTMLElement | null = el;
  if (el.getClientRects().length === 0) {
    target = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head") ?? null;
    if (!target || target.getClientRects().length === 0) return;
  }
  const scroller = target.closest<HTMLElement>(".vc-meters, .vc-controls-col");
  if (!scroller) return;
  const r = target.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  let dy = 0;
  if (r.top < sr.top + REVEAL_MARGIN_PX) dy = r.top - sr.top - REVEAL_MARGIN_PX;
  else if (r.bottom > sr.bottom - REVEAL_MARGIN_PX) dy = r.bottom - sr.bottom + REVEAL_MARGIN_PX;
  if (Math.abs(dy) < 1) return;
  // scrollTo per column rather than scrollIntoView: two smooth
  // scrollIntoView calls in one frame can cancel each other in Chromium.
  scroller.scrollTo({ top: scroller.scrollTop + dy, behavior: reduceMotion() ? "auto" : "smooth" });
}

/** Shared by every pressable cable in one layer — see this file's header
 *  for why the rest wait can't live on a cable's own elements. */
interface RevealState {
  timer: number;
  /** Where the pointer last started resting, or last revealed from. */
  x: number;
  y: number;
}

/** The transparent press target over one pressable cable — see this
 *  file's header. mousedown is dropped like jack.ts does its own, so a
 *  press never moves focus off whatever row was focused (focus opening/
 *  closing a row's hint would slide the port out from under the held
 *  button); Tab still never reaches the layer (aria-hidden). Resting on
 *  it scrolls the cable's ends into view (revealEnd). */
function attachPress(
  g: SVGGElement,
  onPress: (() => void) | undefined,
  d: string,
  ends: { jackEl: HTMLElement; portEl: HTMLElement },
  reveal: RevealState,
): void {
  if (!onPress) return;
  const hit = pathEl("vc-cable-hit", d, "transparent");
  hit.addEventListener("mousedown", (e) => e.preventDefault());
  hit.addEventListener("click", (e) => {
    e.stopPropagation();
    onPress();
  });
  const rest = (e: PointerEvent): void => {
    if (e.pointerType === "touch") return;
    // A rebuilt cable under a still pointer, or a sub-pixel jitter, isn't
    // a move — only a real move restarts the wait.
    if (reveal.timer && Math.hypot(e.clientX - reveal.x, e.clientY - reveal.y) <= REVEAL_STILL_PX) return;
    window.clearTimeout(reveal.timer);
    reveal.x = e.clientX;
    reveal.y = e.clientY;
    reveal.timer = window.setTimeout(() => {
      if (!ends.jackEl.isConnected || !ends.portEl.isConnected) return;
      revealEnd(ends.jackEl);
      revealEnd(ends.portEl);
    }, REVEAL_REST_MS);
  };
  hit.addEventListener("pointerenter", rest);
  hit.addEventListener("pointermove", rest);
  hit.addEventListener("pointerleave", (e) => {
    // The scroll this wait starts slides the cable away; that leave must
    // not undo a reveal already under way, only a wait still pending.
    if (Math.hypot(e.clientX - reveal.x, e.clientY - reveal.y) > REVEAL_STILL_PX) {
      window.clearTimeout(reveal.timer);
      reveal.timer = 0;
    }
  });
  g.append(hit);
}

interface Resolved {
  src: CableSourceSpec;
  pt: { x: number; y: number };
}

function resolveGroup(group: CableGroupSpec): { portPt: { x: number; y: number }; resolved: Resolved[] } | null {
  if (!group.portEl || !group.sources.length) return null;
  const portPt = endpointFor(group.portEl);
  if (!portPt) return null;
  const resolved = group.sources
    .map((src) => ({ src, pt: endpointFor(src.jackEl) }))
    .filter((r): r is Resolved => r.pt !== null);
  return { portPt, resolved };
}

export function createCableLayer(): CableLayer {
  const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("class", "vc-cable-layer");
  svg.setAttribute("aria-hidden", "true");

  let flows: { el: SVGPathElement; key: string; getValue: () => number }[] = [];
  // Keyed by source key (namespaced per group — see this file's header) so
  // a rebuild (a patch edit, a scroll) doesn't snap a still-connected
  // cable's flow back to 0 — only a cable that stops existing loses its
  // offset.
  const offsets = new Map<string, number>();
  const reveal: RevealState = { timer: 0, x: 0, y: 0 };

  function recompute(pinnedGroup: CableGroupSpec, previewGroup: CableGroupSpec, fanGroups: readonly CableGroupSpec[] = []): void {
    // Pass 1 — every getBoundingClientRect() read (resolveGroup,
    // powerAvoidBand), none of it interleaved with a DOM write (this
    // file's own header, and the carried rule against layout thrashing),
    // for both groups, before a single path element is built.
    const pinnedResolved = resolveGroup(pinnedGroup);
    const previewResolved = resolveGroup(previewGroup);
    const fanResolved = fanGroups.map(resolveGroup).filter((g) => g !== null);
    const avoidBand = pinnedResolved || previewResolved || fanResolved.length ? powerAvoidBand() : null;

    // Pass 2 — every write: clear the old cables, build and append the new
    // ones, forget any carried flow offset nothing still uses.
    svg.textContent = "";
    flows = [];
    const liveKeys = new Set<string>();

    // The lit signal's fan first, so the pinned/preview cables it may
    // share a jack and port with draw over it — see this file's header.
    for (const { portPt, resolved } of fanResolved) {
      for (const { src, pt } of resolved) svg.append(pathEl("vc-cable-fan", cablePathD(pt, portPt, avoidBand), src.color));
    }

    // The pinned group dims once a preview is also on screen, so it never
    // competes with the cable that's actually being previewed right now —
    // see controlsTheme.ts's .vc-cable-dimmed.
    const dimmed = pinnedResolved !== null && previewResolved !== null;
    if (pinnedResolved) {
      const { portPt, resolved } = pinnedResolved;
      // resolveGroup only resolves a group that has a port.
      const portEl = pinnedGroup.portEl!;
      for (const { src, pt } of resolved) {
        const key = `pinned:${src.key}`;
        liveKeys.add(key);
        const d = cablePathD(pt, portPt, avoidBand);
        // A muted source draws once, flat — no glow/flow layer, no offset
        // to carry — overriding cond/soft outright (this file's own
        // CableSourceSpec.muted doc).
        if (src.muted) {
          const g = groupEl(src.color);
          g.append(pathEl("vc-cable-muted", d, src.color));
          attachPress(g, src.onPress, d, { jackEl: src.jackEl, portEl }, reveal);
          svg.append(g);
          continue;
        }
        const soft = src.soft ? " vc-cable-soft" : "";
        const cond = src.cond ? " vc-cable-cond" : "";
        const dimCls = dimmed ? " vc-cable-dimmed" : "";
        const isNew = !!src.isNew && !reduceMotion();
        const newCls = isNew ? " vc-cable-new" : "";
        const glow = pathEl(`vc-cable-glow${soft}${dimCls}${newCls}`, d, src.color);
        const core = pathEl(`vc-cable-core${soft}${cond}${dimCls}${newCls}`, d, src.color);
        core.setAttribute("pathLength", "100");
        const flow = pathEl(`vc-cable-flow${soft}${dimCls}${newCls}`, d, src.color);
        if (isNew) {
          glow.style.setProperty("--o", "0.13");
          flow.style.setProperty("--o", src.soft ? "0.4" : "0.9");
        }
        const off = offsets.get(key) ?? 0;
        flow.setAttribute("stroke-dashoffset", off.toFixed(2));
        const g = groupEl(src.color);
        g.append(glow, core, flow);
        attachPress(g, src.onPress, d, { jackEl: src.jackEl, portEl }, reveal);
        svg.append(g);
        flows.push({ el: flow, key, getValue: src.getValue });
      }
    }
    // The preview group: one flat, static path per source — see this
    // file's header for why it carries no glow/flow layer of its own.
    if (previewResolved) {
      const { portPt, resolved } = previewResolved;
      for (const { src, pt } of resolved) {
        liveKeys.add(`preview:${src.key}`);
        const d = cablePathD(pt, portPt, avoidBand);
        svg.append(pathEl("vc-cable-preview", d, src.color));
      }
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
