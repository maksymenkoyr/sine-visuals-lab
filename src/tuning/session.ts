/**
 * Which tuning slot this page belongs to, from a `?tune=` option.
 *
 * Two independent sessions in one dev server would otherwise stomp each
 * other: the param file is broadcast over the shared HMR socket to every
 * connected page, and applyTuningParams clears all overrides before applying,
 * so whichever page saw the message last wins. A slot scopes the param file,
 * the marks, and (in dev) the device id, so you can keep working one
 * visualizer while a tool drives the other.
 *
 * Absent means "not a tuning session": the device menu keeps writing your
 * real saved settings, exactly as it does for a user.
 */
import { parseOptions } from "../router.ts";

/** Conservative: a slot ends up in filenames, so keep it to something that
 *  can't escape a directory or need escaping. Anything malformed falls back
 *  to the default slot rather than failing the page. */
const SLOT_RE = /^[A-Z0-9]{1,8}$/;

export const DEFAULT_SLOT = "A";

export function tuningSlot(): string | null {
  const raw = parseOptions(location.search, location.hash).get("tune");
  if (raw === null) return null;
  const slot = raw.trim().toUpperCase();
  return SLOT_RE.test(slot) ? slot : DEFAULT_SLOT;
}

export function isTuningSession(): boolean {
  return tuningSlot() !== null;
}
