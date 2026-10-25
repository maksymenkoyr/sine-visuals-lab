// How the three pages (app.ts, output.ts, tv.ts) survive a GPU context loss:
// they rebuild in place instead of reloading. A reload loses screen and tab
// capture (and Safari's mic until a tap) and restarts the tempo lock and
// Auto's warm-up, so it is only the fallback.
//
// What stays: audio capture and its analysers, the anim clock, Auto, the
// governor, the room connection and the stores. What goes is every GL object.
//
// Teardown runs on the loss, not the restore: GL calls on a lost context are
// silent no-ops, while freeing old objects after the restore makes WebGL warn
// about each one ("object does not belong to this context"). After the
// restore only the scene is mounted again; everything else (compositor
// targets, overlay, glass, picture readback) rebuilds lazily on its next draw.
//
// The page reloads when it was not set up at the loss, when teardown threw, or
// when rebuilding in place throws.

interface RecoveryHooks {
  /** False before the page has built what teardown would free. */
  ready(): boolean;
  teardown(): void;
  rebuild(): void;
  reload(): void;
}

export function createContextRecovery(hooks: RecoveryHooks): { lost(): void; restored(): boolean } {
  let clean = false;
  return {
    lost() {
      clean = false;
      if (!hooks.ready()) return;
      try {
        hooks.teardown();
        clean = true;
      } catch (err) {
        console.error("Graphics reset: freeing the old GL objects failed; the page will reload", err);
      }
    },
    restored() {
      if (clean) {
        clean = false;
        try {
          hooks.rebuild();
          return true;
        } catch (err) {
          console.error("Graphics reset: rebuilding in place failed; reloading", err);
        }
      }
      hooks.reload();
      return false;
    },
  };
}
