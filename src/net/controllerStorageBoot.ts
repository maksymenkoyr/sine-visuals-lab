/**
 * Installs the phone controller's room-look storage overlay (net/roomStorage.ts)
 * when the page was opened as one, and does nothing for any other visit.
 * app.ts must import this FIRST: ES modules evaluate in import order and every
 * store seeds its cache from `localStorage` at module load, so the overlay has
 * to be in place before any of them runs (the same reasoning as
 * outputStorage.ts for the pop-out).
 *
 * The overlay is seeded from the phone's real room keys, so the first phone
 * into an empty room publishes its own tuning as the room's starting look —
 * and a solo visit to the same site never sees an overlay, so its settings
 * behave exactly as before.
 */

import { installRoomStorage, wantsControllerStorage } from "./roomStorage.ts";

if (wantsControllerStorage(location.search)) installRoomStorage({ seed: true });
