/**
 * Installs the TV's room-look storage overlay (net/roomStorage.ts) — and
 * nothing else. tv.ts must import this FIRST: ES modules evaluate in import
 * order and every store seeds its cache from `localStorage` at module load, so
 * the overlay has to be in place before any of them runs (the same reasoning
 * as outputStorage.ts for the pop-out).
 *
 * A TV starts with no look of its own: the overlay is empty, and the room's
 * look is the only thing that fills it. Its other keys (device id, quality,
 * pairing session) still reach the TV's real storage.
 */

import { installRoomStorage } from "./roomStorage.ts";

installRoomStorage({ seed: false });
