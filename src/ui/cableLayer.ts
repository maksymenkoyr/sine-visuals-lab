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
 * The hit stroke answers only in the open gap between the cable's jack card
 * and its port card (pressBandFor; a `<clipPath>` per cable): the layer
 * paints over every card, so a cable crossing a card (Bass level's runs
 * straight over Mid and Treble) would otherwise take a press meant for the
 * jack, fader or slider under it and unplug itself instead.
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
 * A pinned source with a knot (CableSourceSpec.knot, cableKnots.ts) and a
 * press band is drawn in two halves: jack to the knot's left edge, and the
 * knot's right edge to the port, each through cablePathD so each keeps its
 * stubs (and the second its detour under Power). The knot rests on the whole
 * cable's bend (cablePointAt), one setting's knots spread along their cables
 * (KNOT_SPREAD_T) since those cables all meet at one port and would stack
 * their knots at the middle; it is HTML in its own layer (knotEl), so
 * it can grow into a panel; as it springs between sizes, tick() rewrites the
 * halves' `d` to follow its sides. The first half's flow rides the wire's
 * input, the second's its output, so the knot visibly changes the signal.
 * Both halves keep the press stroke: a press still unplugs, and hovering
 * either half peeks the knot (setPeek). A knot opens from its own click or
 * from deviceMenu.ts's summary chip (openKnot). A source without a knot draws
 * as one path.
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
 * then one batch of writes (the `<path>` elements it builds, and the knots'
 * sync()). tick() is the only per-frame entry point, and it only ever writes
 * — the pinned group's `stroke-dashoffset`, the knots' styles, a split
 * cable's `d` when its knot moved — never reads, so it can run every rAF
 * tick for free; the preview group never animates, so it never needs a tick
 * write either.
 *
 * A jack being dragged (deviceMenu.ts's jack drag) draws one temporary
 * dashed `.vc-cable-drag` path from its own jack to the pointer (setDrag).
 * It belongs to no group, so recompute() re-appends it after its rebuild.
 */

import { createCableKnotLayer, type CableKnotGeometry, type CableKnotPlacement, type CableKnotSpec } from "./cableKnots.ts";

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
  /** A knot in this cable (cableKnots.ts) — see this file's header. Only
   *  drawn for a pinned source that also has a press band. */
  knot?: CableKnotSpec;
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
  /** The cable a jack drag pulls (deviceMenu.ts): from `from`'s jack to the pointer at (x, y), dashed, drawn over every other cable; null removes it. Survives recompute(). */
  setDrag(drag: { from: HTMLElement; x: number; y: number; color: string } | null): void;
  /** The knot layer (cableKnots.ts), its own element for `document.body`. */
  knotEl: HTMLElement;
  /** Opens the knot in a pinned source's cable, by its CableSourceSpec key. */
  openKnot(sourceKey: string): void;
  closeKnot(): void;
  knotOpen(): boolean;
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
 *     `.vc-controls-col`) — the cable ends at the column's
 *     visible edge;
 *   - otherwise, the element's own centre. */
function endpointFor(el: HTMLElement): { x: number; y: number } | null {
  if (el.getClientRects().length === 0) {
    const header = el.closest<HTMLElement>(".vc-card")?.querySelector<HTMLElement>(".vc-card-head");
    // The header has no box either when the whole column is hidden (M, or
    // every card folded away) — its rect would be all zeros and the cable
    // would run to the viewport's top-left corner, so draw nothing instead.
    if (!header || header.getClientRects().length === 0) {
      return null;
    }
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

/** The point at `t` along the cubic from (x0, y0) to (x3, y3) whose control
 *  points share the ends' y, as every cubic in cablePathD does. */
function flatCubicAt(x0: number, y0: number, x1: number, x2: number, x3: number, y3: number, t: number): { x: number; y: number } {
  const u = 1 - t;
  const x = u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3;
  return { x, y: y0 + (y3 - y0) * t * t * (3 - 2 * t) };
}

/** The point at `t` (0..1) along cablePathD's own bend, its stubs left out:
 *  one cubic, or the two halves of the detour under Power. A knot's rest
 *  point. */
function cablePointAt(
  pt: { x: number; y: number },
  port: { x: number; y: number },
  avoidBand: { top: number; bottom: number } | null,
  t: number,
): { x: number; y: number } {
  const dir = port.x >= pt.x ? 1 : -1;
  const jackStubX = pt.x + dir * CABLE_STUB_PX;
  const portStubX = port.x - dir * CABLE_STUB_PX;
  if (avoidBand && port.y >= avoidBand.top && port.y <= avoidBand.bottom) {
    const wpX = (jackStubX + portStubX) / 2;
    const wpY = avoidBand.bottom;
    if (t < 0.5) {
      const dx1 = Math.max(30, Math.abs(wpX - jackStubX) * 0.6);
      return flatCubicAt(jackStubX, pt.y, jackStubX + dir * dx1, wpX - dir * dx1, wpX, wpY, t * 2);
    }
    const dx2 = Math.max(30, Math.abs(portStubX - wpX) * 0.6);
    return flatCubicAt(wpX, wpY, wpX + dir * dx2, portStubX - dir * dx2, portStubX, port.y, t * 2 - 1);
  }
  const dx = Math.max(40, Math.abs(portStubX - jackStubX) * 0.55);
  return flatCubicAt(jackStubX, pt.y, jackStubX + dir * dx, portStubX - dir * dx, portStubX, port.y, t);
}

/** How far apart, along their cables, one setting's knots rest. Its cables
 *  all meet at one port, so at the same `t` the knots of neighbouring jacks
 *  would stack; spread along the cables they sit apart. */
const KNOT_SPREAD_T = 0.12;
const KNOT_T_MIN = 0.25;
const KNOT_T_MAX = 0.75;
/** Room kept between a resting knot and the gap's edge. */
const KNOT_GAP_INSET_PX = 16;

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
  clipId: string | null,
  onHover?: (on: boolean) => void,
): SVGPathElement | null {
  if (!onPress || clipId === null) return null;
  const hit = pathEl("vc-cable-hit", d, "transparent");
  if (onHover) {
    hit.addEventListener("pointerenter", (e) => {
      if (e.pointerType !== "touch") onHover(true);
    });
    hit.addEventListener("pointerleave", () => onHover(false));
  }
  hit.addEventListener("mousedown", (e) => e.preventDefault());
  hit.setAttribute("clip-path", `url(#${clipId})`);
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
  return hit;
}

/** A pinned cable drawn in two halves around its knot: the paths of each
 *  half (strands and hit stroke) and the knot geometry they were last
 *  written for. */
interface Split {
  key: string;
  pt: { x: number; y: number };
  portPt: { x: number; y: number };
  avoidBand: { top: number; bottom: number } | null;
  a: SVGPathElement[];
  b: SVGPathElement[];
  geom: CableKnotGeometry | null;
}

interface Resolved {
  src: CableSourceSpec;
  pt: { x: number; y: number };
  /** Where this cable may answer a press: the open gap between its jack's
   *  card and its port's card, or null when they leave none. */
  pressBand: { left: number; right: number } | null;
}

/** The open gap between two ends' own cards — see this file's header for
 *  why a cable answers the pointer only there. */
function pressBandFor(jackEl: HTMLElement, portEl: HTMLElement): { left: number; right: number } | null {
  const jackCard = jackEl.closest<HTMLElement>(".vc-card");
  const portCard = portEl.closest<HTMLElement>(".vc-card");
  if (!jackCard || !portCard) return null;
  const j = jackCard.getBoundingClientRect();
  const p = portCard.getBoundingClientRect();
  if (j.right < p.left) return { left: j.right, right: p.left };
  if (p.right < j.left) return { left: p.right, right: j.left };
  return null;
}

function resolveGroup(group: CableGroupSpec): { portPt: { x: number; y: number }; resolved: Resolved[] } | null {
  if (!group.portEl || !group.sources.length) return null;
  const portEl = group.portEl;
  const portPt = endpointFor(portEl);
  if (!portPt) return null;
  const resolved: Resolved[] = [];
  for (const src of group.sources) {
    const pt = endpointFor(src.jackEl);
    if (!pt) continue;
    resolved.push({ src, pt, pressBand: src.onPress ? pressBandFor(src.jackEl, portEl) : null });
  }
  return { portPt, resolved };
}

export function createCableLayer(): CableLayer {
  const svg = document.createElementNS(NS, "svg") as unknown as SVGSVGElement;
  svg.setAttribute("class", "vc-cable-layer");
  svg.setAttribute("aria-hidden", "true");

  let flows: { el: SVGPathElement; key: string; getValue: () => number }[] = [];
  // The jack drag's own cable (setDrag) — kept across recompute(), which
  // clears every child of svg, so the path is re-appended after each rebuild.
  let dragPath: SVGPathElement | null = null;
  let dragSpec: { from: HTMLElement; x: number; y: number; color: string } | null = null;
  // Keyed by source key (namespaced per group — see this file's header) so
  // a rebuild (a patch edit, a scroll) doesn't snap a still-connected
  // cable's flow back to 0 — only a cable that stops existing loses its
  // offset.
  const offsets = new Map<string, number>();
  const reveal: RevealState = { timer: 0, x: 0, y: 0 };
  const knots = createCableKnotLayer();
  let splits: Split[] = [];

  /** Rewrites a split cable's two halves to the knot's current sides, only
   *  when they moved since the last write. Writes only. */
  function writeSplit(sp: Split): void {
    const g = knots.geometry(sp.key);
    if (!g) return;
    const last = sp.geom;
    if (last && last.left === g.left && last.right === g.right && last.entryY === g.entryY) return;
    sp.geom = g;
    // The first half ends at the knot, which sits in the open gap, so only
    // the second half can need the detour under Power.
    const dA = cablePathD(sp.pt, { x: g.left, y: g.entryY }, null);
    const dB = cablePathD({ x: g.right, y: g.entryY }, sp.portPt, sp.avoidBand);
    for (const p of sp.a) p.setAttribute("d", dA);
    for (const p of sp.b) p.setAttribute("d", dB);
  }

  function recompute(pinnedGroup: CableGroupSpec, previewGroup: CableGroupSpec, fanGroups: readonly CableGroupSpec[] = []): void {
    // Pass 1 — every getBoundingClientRect() read (resolveGroup,
    // powerAvoidBand), none of it interleaved with a DOM write (this
    // file's own header, and the carried rule against layout thrashing),
    // for both groups, before a single path element is built.
    const pinnedResolved = resolveGroup(pinnedGroup);
    const previewResolved = resolveGroup(previewGroup);
    const fanResolved = fanGroups.map(resolveGroup).filter((g) => g !== null);
    const avoidBand = pinnedResolved || previewResolved || fanResolved.length ? powerAvoidBand() : null;
    const viewport = { w: window.innerWidth, h: window.innerHeight };

    // Pass 2 — every write: clear the old cables, build and append the new
    // ones, forget any carried flow offset nothing still uses.
    svg.textContent = "";
    flows = [];
    splits = [];
    const defs = document.createElementNS(NS, "defs");
    svg.append(defs);
    let clipCount = 0;
    /** One cable's press band as a clip for its hit stroke (attachPress):
     *  the band's full height, so only x limits where it answers. */
    const pressClip = (band: { left: number; right: number }): string => {
      const id = `vc-cable-press-${clipCount++}`;
      const clip = document.createElementNS(NS, "clipPath");
      clip.id = id;
      clip.setAttribute("clipPathUnits", "userSpaceOnUse");
      const rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", band.left.toFixed(1));
      rect.setAttribute("y", "0");
      rect.setAttribute("width", (band.right - band.left).toFixed(1));
      rect.setAttribute("height", "100%");
      clip.append(rect);
      defs.append(clip);
      return id;
    };
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
    const knotPlacements: CableKnotPlacement[] = [];
    if (pinnedResolved) {
      const { portPt, resolved } = pinnedResolved;
      // resolveGroup only resolves a group that has a port.
      const portEl = pinnedGroup.portEl!;
      const ends = (src: CableSourceSpec) => ({ jackEl: src.jackEl, portEl });
      /** One cable's (or one half's) strands into `g`: flat for a muted
       *  source — no glow/flow layer, no offset to carry, overriding
       *  cond/soft outright (CableSourceSpec.muted) — else glow/core/flow,
       *  the flow carrying its offset under `key`. */
      const strands = (g: SVGGElement, src: CableSourceSpec, d: string, key: string, getValue: () => number): SVGPathElement[] => {
        if (src.muted) {
          const p = pathEl("vc-cable-muted", d, src.color);
          g.append(p);
          return [p];
        }
        liveKeys.add(key);
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
        flow.setAttribute("stroke-dashoffset", (offsets.get(key) ?? 0).toFixed(2));
        g.append(glow, core, flow);
        flows.push({ el: flow, key, getValue });
        return [glow, core, flow];
      };
      // Top jack first, so the spread runs the same way down the meters.
      const knotted = resolved.filter((r) => r.src.knot && r.pressBand).sort((a, b) => a.pt.y - b.pt.y);
      const knotT = new Map(
        knotted.map((r, i) => [r.src.key, Math.min(KNOT_T_MAX, Math.max(KNOT_T_MIN, 0.5 + (i - (knotted.length - 1) / 2) * KNOT_SPREAD_T))]),
      );
      for (const { src, pt, pressBand } of resolved) {
        const key = `pinned:${src.key}`;
        const clipId = pressBand ? pressClip(pressBand) : null;
        const g = groupEl(src.color);
        const knot = src.knot;
        if (!knot || !pressBand) {
          const d = cablePathD(pt, portPt, avoidBand);
          strands(g, src, d, key, src.getValue);
          attachPress(g, src.onPress, d, ends(src), reveal, clipId);
          svg.append(g);
          continue;
        }
        const rest = cablePointAt(pt, portPt, avoidBand, knotT.get(src.key) ?? 0.5);
        const restX = Math.min(pressBand.right - KNOT_GAP_INSET_PX, Math.max(pressBand.left + KNOT_GAP_INSET_PX, rest.x));
        knotPlacements.push({ key: src.key, color: src.color, anchor: { x: restX, y: rest.y }, gap: pressBand, spec: knot });
        // The halves' `d` waits for the knot's geometry, which sync() below
        // settles; writeSplit fills it in.
        const split: Split = { key: src.key, pt, portPt, avoidBand, a: [], b: [], geom: null };
        splits.push(split);
        const hover = (on: boolean) => knots.setPeek(src.key, on);
        split.a = strands(g, src, "", `${key}:a`, () => knot.read()?.input ?? src.getValue());
        split.b = strands(g, src, "", `${key}:b`, () => knot.read()?.output ?? src.getValue());
        const hitA = attachPress(g, src.onPress, "", ends(src), reveal, clipId, hover);
        const hitB = attachPress(g, src.onPress, "", ends(src), reveal, clipId, hover);
        if (hitA) split.a.push(hitA);
        if (hitB) split.b.push(hitB);
        svg.append(g);
      }
    }
    // Runs even with nothing pinned, so a knot whose cable went away goes too.
    knots.sync(knotPlacements, viewport);
    for (const sp of splits) writeSplit(sp);
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
    // recompute() cleared svg's children, drag cable included — put it back
    // on top, where setDrag keeps it.
    if (dragSpec && dragPath) svg.append(dragPath);
  }

  function setDrag(drag: { from: HTMLElement; x: number; y: number; color: string } | null): void {
    if (!drag) {
      dragPath?.remove();
      dragPath = null;
      dragSpec = null;
      return;
    }
    dragSpec = drag;
    const pt = endpointFor(drag.from);
    if (!pt) {
      dragPath?.remove();
      dragPath = null;
      return;
    }
    const d = cablePathD(pt, { x: drag.x, y: drag.y }, null);
    if (!dragPath) {
      dragPath = pathEl("vc-cable-drag", d, drag.color);
    } else {
      dragPath.setAttribute("d", d);
      dragPath.setAttribute("stroke", drag.color);
    }
    if (svg.lastChild !== dragPath) svg.append(dragPath);
  }

  return {
    el: svg,
    recompute,
    tick(dtSec) {
      knots.tick(dtSec);
      for (const sp of splits) writeSplit(sp);
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
      knots.setVisible(v);
    },
    setDrag,
    knotEl: knots.el,
    openKnot: (sourceKey) => knots.open(sourceKey),
    closeKnot: () => knots.close(),
    knotOpen: () => knots.openKey() !== null,
  };
}
