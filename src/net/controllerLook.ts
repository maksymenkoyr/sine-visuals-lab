/**
 * The phone controller's side of the look: what it reads off the device to
 * publish, and what it does with a look the room hands it (the `LookIO` that
 * net/lookSync.ts drives). The device itself is injected, so this tests in node
 * with the real publisher on top (tests/controllerLook.test.ts).
 *
 * A phone can be handed an id it cannot show: a scene this build does not have
 * or is too heavy for, a palette from a newer build. It then keeps showing its
 * own fallback, but what it publishes must keep naming the room's id. lookSync
 * folds every value the room sends into its `base` whether or not `write`
 * managed to show it, so a `read` that reported the fallback would differ from
 * `base` and the next tick would publish the fallback over the room's choice
 * (and a reconnect would treat it as an unacked local edit). The same ids are
 * moved on by the phone's own picks, through noteScene / notePalette.
 *
 * The room-scope storage has no such mirror here: net/roomStorage.ts owns which
 * keys a build takes part in.
 */

import type { LookDoc } from "../../server/lookDoc.ts";
import type { LookIO } from "./lookSync.ts";

export interface ControllerLookDevice {
  /** The palette id this phone is showing. */
  paletteId(): string;
  /** Whether this build has a palette by that id. */
  canShowPalette(id: string): boolean;
  showPalette(id: string): void;
  /** Shows the scene when this phone can (it is known here, and its quality
   *  preset allows it); leaves whatever it is showing otherwise. */
  showScene(id: string): void;
  /** The room-scope settings as they are on this device now. */
  captureStorage(): Record<string, string>;
  /** Makes the room-scope settings the device's (before any scene mounts). */
  applyStorage(storage: Record<string, string>): void;
}

export interface ControllerLook {
  io: Pick<LookIO, "read" | "write">;
  /** This phone itself is now showing this scene (a pick, or entering one). */
  noteScene(id: string): void;
  /** This phone itself is now showing this palette. */
  notePalette(id: string): void;
}

export function createControllerLook(device: ControllerLookDevice): ControllerLook {
  /** The scene id the room holds, shown or not. Null until the phone has
   *  picked one or the room has told it: it then publishes no scene at all
   *  (an empty scene id is no opinion, server/lookDoc.ts). */
  let roomSceneId: string | null = null;
  /** The palette id the room holds, shown or not. Null until either side has
   *  said one; read falls back to the device's own then. */
  let roomPaletteId: string | null = null;

  return {
    io: {
      read(): LookDoc {
        return {
          scene: roomSceneId ?? "",
          palette: roomPaletteId ?? device.paletteId(),
          storage: device.captureStorage(),
        };
      },
      write(doc: LookDoc): void {
        // Storage first: applyRoomStorage re-seeds every store from it, so a
        // scene that mounts below already has the room's settings.
        device.applyStorage(doc.storage);
        if (doc.palette) {
          roomPaletteId = doc.palette;
          if (doc.palette !== device.paletteId() && device.canShowPalette(doc.palette)) {
            device.showPalette(doc.palette);
          }
        }
        if (!doc.scene) return;
        roomSceneId = doc.scene;
        device.showScene(doc.scene);
      },
    },
    noteScene(id) {
      roomSceneId = id;
    },
    notePalette(id) {
      roomPaletteId = id;
    },
  };
}
