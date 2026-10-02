/**
 * Room codes as a person types them. The Worker mints the codes
 * (`randomRoomCode` in server/worker.ts: four characters from an alphabet
 * without the look-alikes 0/O and 1/I/L) and only routes `ROOM_PATH_RE`-shaped
 * ones; this is the client-side mirror of that shape, so a typed code can be
 * cleaned up and checked before a device navigates to it.
 */

const CODE_LENGTH = 4;
const VALID_CODE_RE = /^[A-HJKMNP-Z2-9]{4}$/;

/** What the field should hold after any keystroke or paste: upper case, letters and digits only, capped at one code. */
export function normalizeRoomCodeInput(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

/** True only for a code the Worker could have issued. */
export function isValidRoomCode(code: string): boolean {
  return VALID_CODE_RE.test(code);
}

/** A `?room=` query value as a usable code, or null when absent or malformed. */
export function roomCodeFromParam(param: string | null): string | null {
  const code = normalizeRoomCodeInput(param ?? "");
  return isValidRoomCode(code) ? code : null;
}
