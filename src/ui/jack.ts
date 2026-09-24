/**
 * The patch bay's jack (src/ui/deviceMenu.ts's own plan doc): a small round
 * button mounted beside a meter row or a hits lane that a live signal can
 * feed into a pinned setting. One module because the identical button
 * mounts wherever a reactive row/lane lives — the Bands card's own level
 * rows and its Frequencies corner (deviceMenu.ts), and every meter row
 * audioMeters.ts owns (Rhythm/Signal/Character) — and every one of them
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
 * setRowFed is the row-level half of the same contract: the glow + "→
 * <setting>" chip a fed meter row grows, and the dim every other row takes
 * on while `.vc-patching` is set on an ancestor (controlsTheme.ts's own
 * rules) — shared so deviceMenu.ts's own Bands-card jacks (built directly,
 * not through audioMeters.ts) and audioMeters.ts's own rows apply the exact
 * same class/chip logic rather than two hand-rolled copies drifting apart.
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
  /** Tiny dots under the ring — how many of this scene's settings use this
   *  source right now, capped so a busy source doesn't grow the row. */
  setUses(n: number): void;
  setLabel(ariaLabel: string, title: string): void;
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
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  el.addEventListener("pointerenter", () => onHover(true));
  el.addEventListener("pointerleave", () => onHover(false));
  el.addEventListener("focus", () => onHover(true));
  el.addEventListener("blur", () => onHover(false));

  const MAX_USE_DOTS = 4;
  return {
    el,
    setFilled(on) {
      el.classList.toggle("vc-jack-filled", on);
    },
    setPressed(on) {
      el.setAttribute("aria-pressed", String(on));
    },
    setUses(n) {
      const count = Math.max(0, Math.min(MAX_USE_DOTS, n));
      while (uses.children.length < count) uses.appendChild(document.createElement("i"));
      while (uses.children.length > count) uses.lastElementChild?.remove();
    },
    setLabel(ariaLabel, title) {
      el.setAttribute("aria-label", ariaLabel);
      el.title = title;
    },
  };
}

/** Toggles a meter row's (or a hit lane's shared row's) fed glow + "→
 *  <label>" chip — `kind`/`color`/`label` are already resolved by the caller
 *  (deviceMenu.ts's refreshBandsJacks, audioMeters.ts's refreshPatchView),
 *  this only writes the DOM:
 *   - "full": the row feeds the pinned setting and nothing else is being
 *     previewed right now — the strong glow plus the chip.
 *   - "soft": the row feeds the *previewed* setting (a hover/focus short of
 *     a click), or is named in a `"scene"` setting's own display-only
 *     `drive.sceneSources` — a dimmer glow, no chip. A preview always takes
 *     this over a competing pinned feed on the same row (see the caller).
 *   - "faint": the row feeds the pinned setting, but a *different* setting
 *     is simultaneously being previewed elsewhere — a bare mark so the
 *     pinned patch doesn't vanish from view while it's not what's shown.
 *   - "none": dims under `.vc-patching` like any other unfed row.
 *  Call only on a selection/patch change, never per frame. */
export function setRowFed(
  rowEl: HTMLElement,
  kind: "full" | "soft" | "faint" | "none",
  color: string,
  label: string,
): void {
  rowEl.classList.toggle("vc-row-fed", kind === "full");
  rowEl.classList.toggle("vc-row-fed-soft", kind === "soft");
  rowEl.classList.toggle("vc-row-fed-faint", kind === "faint");
  if (kind !== "none") rowEl.style.setProperty("--vc-hl", color);
  let chip = rowEl.querySelector<HTMLElement>(":scope > .vc-fed-chip");
  if (kind === "full") {
    if (!chip) {
      chip = document.createElement("span");
      chip.className = "vc-fed-chip";
      rowEl.appendChild(chip);
    }
    chip.textContent = `→ ${label}`;
  } else {
    chip?.remove();
  }
}
