// A meter flash (a bar's flash(), the Tempo dot on each beat, revealRow's ring
// on a row) is a jump to a lit style followed by an ease back to rest. Running
// it as a Web Animation (Element.animate) instead of as a CSS transition means
// a new flash never has to force a style and layout pass to restart the
// transition, which is what the older "switch the transition off, write the
// lit style, read offsetWidth, switch it back on" trick did on every beat.
// The animation carries no fill, so when it ends the element shows its own
// inline or class style again. Callers keep that style at the rest value,
// which is the same value as the animation's last keyframe, so nothing snaps.
// Where Element.animate is missing the flash is skipped and the element just
// stays at rest.

/** Restart a jump-then-fade on `el`: cancels `prev` (the caller's last
 *  flash on this element), then animates from `lit` to `rest`. Returns the
 *  new Animation for the caller to pass back next time, or null where the
 *  browser has no Element.animate. */
export function flashTo(
  el: Pick<HTMLElement, "animate">,
  prev: Animation | null,
  lit: Keyframe,
  rest: Keyframe,
  durationMs: number,
): Animation | null {
  prev?.cancel();
  if (typeof el.animate !== "function") return null;
  return el.animate([lit, rest], { duration: durationMs, easing: "ease-out" });
}
