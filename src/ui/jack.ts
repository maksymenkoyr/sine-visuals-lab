/**
 * The patch bay's jack (src/ui/deviceMenu.ts's own plan doc): a small round
 * button mounted beside a meter row or a hits lane that a live signal can
 * feed into a pinned setting. One module because the identical button
 * mounts wherever a reactive row/lane lives — the Bands card's own level
 * rows and its Frequencies corner (deviceMenu.ts), and every meter row
 * audioMeters.ts owns (Hits/Tempo/Signal/Character) — and every one of them
 * needs to look and behave the same way.
 *
 * This file only ever draws visual state; it never touches a DriveSetting.
 * The click/hover behaviour and every jack's fill/pressed/usage state is
 * decided by deviceMenu.ts (the only place with enough state — pinned/
 * preview, every scene setting's own patch — to answer "does this feed the
 * shown setting"), passed in as plain callbacks/booleans and refreshed only
 * on a genuine selection or patch change, never per frame — the same
 * carried rule as the rest of the patch bay.
 *
 * setRowFed is the row-level half of the same contract: the glow a fed
 * meter row grows, and the dim every other row takes on while
 * `.vc-patching` is set on an ancestor (controlsTheme.ts's own rules) —
 * shared so deviceMenu.ts's own Bands-card jacks (built directly, not
 * through audioMeters.ts) and audioMeters.ts's own rows apply the exact
 * same class logic rather than two hand-rolled copies drifting apart.
 */

export interface JackHandle {
  el: HTMLButtonElement;
  /** Rings and fills solid in the jack's own colour — feeds the currently
   *  shown (preview ?? pinned) setting. Independent of setPressed: a jack
   *  can be filled while hovering a *different* row than the pinned one. */
  setFilled(on: boolean): void;
  /** aria-pressed — a source of the *pinned* setting specifically, i.e.
   *  what a click on this jack would toggle off. */
  setPressed(on: boolean): void;
  /** Tiny dots around the ring — one per setting of this scene that uses
   *  this source right now. They step clockwise from 12 o'clock at a fixed
   *  pitch, so a count still reads at a glance; once a full turn is
   *  taken they spread evenly and shrink instead, so a busy source never
   *  spills past its ring (useDotLayout below). */
  setUses(n: number): void;
  setLabel(ariaLabel: string, title: string): void;
}

/** The dots' own ring, in px from the jack's centre — just outside its
 *  13px ring and 1.5px border (controlsTheme.ts's .vc-jack). */
const USE_DOT_RADIUS_PX = 9;
/** A dot's size and step while they fit within one turn. */
const USE_DOT_PX = 1.8;
const USE_DOT_STEP_DEG = 30;

/** Where `n` usage dots sit and how big they are — see setUses. Past one
 *  full turn the step becomes 360/n and the dot shrinks with it, keeping
 *  the same dot-to-gap ratio as the full-size pitch, down to a floor
 *  where neighbouring dots simply merge into a solid ring. */
export function useDotLayout(n: number): { stepDeg: number; sizePx: number } {
  const perTurn = 360 / USE_DOT_STEP_DEG;
  if (n <= perTurn) return { stepDeg: USE_DOT_STEP_DEG, sizePx: USE_DOT_PX };
  return { stepDeg: 360 / n, sizePx: Math.max(0.8, (USE_DOT_PX * perTurn) / n) };
}

/** A round button-like span — see this file's own header. `onClick`/`onHover`
 *  are called with no argument: the caller already knows which source this
 *  jack is (it built the closure), so there's nothing for this module to
 *  thread through. */
export function createJack(color: string, onClick: () => void, onHover: (on: boolean) => void): JackHandle {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "vc-jack";
  el.style.setProperty("--c", color);
  const uses = document.createElement("span");
  uses.className = "vc-jack-uses";
  el.appendChild(uses);
  // A mouse press must not move focus onto the jack. Focus opens its row's
  // hint (controlsTheme.ts's `.vc-row:focus-within .vc-hint`) and closes the
  // one it left, so pressing a jack below the last-focused row slid this
  // jack up out from under the held button (the 0.18s hint collapse) — the
  // release landed on the row, no click fired, and every other plug/unplug
  // went dead. Tab still reaches the jack; only the mouse's focus is dropped.
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  el.addEventListener("pointerenter", () => onHover(true));
  el.addEventListener("pointerleave", () => onHover(false));
  el.addEventListener("focus", () => onHover(true));
  el.addEventListener("blur", () => onHover(false));

  return {
    el,
    setFilled(on) {
      el.classList.toggle("vc-jack-filled", on);
    },
    setPressed(on) {
      el.setAttribute("aria-pressed", String(on));
    },
    setUses(n) {
      const count = Math.max(0, Math.floor(n));
      while (uses.children.length < count) uses.appendChild(document.createElement("i"));
      while (uses.children.length > count) uses.lastElementChild?.remove();
      const { stepDeg, sizePx } = useDotLayout(count);
      uses.style.setProperty("--s", `${sizePx}px`);
      uses.style.setProperty("--r", `${USE_DOT_RADIUS_PX}px`);
      Array.from(uses.children as HTMLCollectionOf<HTMLElement>).forEach((dot, i) => {
        dot.style.setProperty("--a", `${i * stepDeg}deg`);
      });
    },
    setLabel(ariaLabel, title) {
      el.setAttribute("aria-label", ariaLabel);
      el.title = title;
    },
  };
}

/** Toggles a meter row's (or a hit lane's shared row's) fed glow — `kind`/
 *  `color` are already resolved by the caller (deviceMenu.ts's
 *  refreshBandsJacks, audioMeters.ts's refreshPatchView), this only writes
 *  the DOM:
 *   - "full": the row feeds the pinned setting and nothing else is being
 *     previewed right now — the strong glow.
 *   - "soft": the row feeds the *previewed* setting (a hover/focus short of
 *     a click), or is named in a `"scene"` setting's own display-only
 *     `drive.sceneSources` — a dimmer glow. A preview always takes this
 *     over a competing pinned feed on the same row (see the caller).
 *   - "faint": the row feeds the pinned setting, but a *different* setting
 *     is simultaneously being previewed elsewhere — a bare mark so the
 *     pinned patch doesn't vanish from view while it's not what's shown.
 *   - "none": dims under `.vc-patching` like any other unfed row.
 *  Call only on a selection/patch change, never per frame. */
export function setRowFed(rowEl: HTMLElement, kind: "full" | "soft" | "faint" | "none", color: string): void {
  rowEl.classList.toggle("vc-row-fed", kind === "full");
  rowEl.classList.toggle("vc-row-fed-soft", kind === "soft");
  rowEl.classList.toggle("vc-row-fed-faint", kind === "faint");
  if (kind !== "none") rowEl.style.setProperty("--vc-hl", color);
}
