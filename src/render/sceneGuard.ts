/**
 * What a screen does when a scene throws while it draws. The main page
 * (src/app.ts), the pop-out output (src/output.ts) and a room's TV (src/tv.ts)
 * each hand their draw to `guard.draw`, so a bad scene costs one logged error
 * and one screen's change of scene, not the loop: audio sampling, drives and
 * the feed to the output and TVs run on as before. The screen moves to the
 * scene before it that still draws, or to the built-in one. The recovery lives
 * in `recover` alone, so "notice only, keep the frozen frame" would be a
 * one-function change. Failure is remembered for the page's life, until
 * `forgive` clears it. Pure: no DOM, no GL, so it is tested without a browser
 * (tests/sceneGuard.test.ts).
 */

import type { Scene } from "./scene.ts";

/** How many recently drawn scenes a screen keeps as fallbacks. */
const HISTORY_CAP = 8;

/** A throw from a scene's `render`, carrying the scene that threw. A crossfade
 *  draws two scenes in one frame, so the loop must know which one failed. */
export class SceneRenderError extends Error {
  readonly scene: Scene;
  readonly original: unknown;

  constructor(scene: Scene, original: unknown) {
    super(`Scene "${scene.id}" threw while drawing`);
    this.name = "SceneRenderError";
    this.scene = scene;
    this.original = original;
  }
}

/** The scene a screen should cut to after `failed` threw: the newest scene in
 *  `history` that is usable, else `builtIn`. `wasShown` says which of the two
 *  it was, since the notice words them differently. */
export function chooseFallback(
  failed: Scene,
  history: readonly Scene[],
  bad: ReadonlySet<string>,
  builtIn: Scene | undefined,
  canRun: (s: Scene) => boolean,
): { scene: Scene; wasShown: boolean } | null {
  const usable = (s: Scene): boolean => s !== failed && !bad.has(s.id) && canRun(s);
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i];
    if (usable(s)) return { scene: s, wasShown: true };
  }
  if (builtIn && usable(builtIn)) return { scene: builtIn, wasShown: false };
  return null;
}

export interface SceneGuardOptions {
  /** Cuts the screen to `next` with no crossfade; true when `next` is now shown. */
  switchTo(next: Scene, failed: Scene): boolean;
  /** A crossfade's outgoing scene threw: the blend ends, the incoming scene stays. */
  dropOutgoing(): void;
  builtIn(): Scene | undefined;
  canRun(s: Scene): boolean;
  /** Only the main page has a panel to say so; the output and TV leave it out. */
  notice?(failed: Scene, next: Scene, wasShown: boolean): void;
  log?(msg: string, err: unknown): void;
}

export interface SceneGuard {
  /** `render`'s result, or undefined when the frame drew nothing. */
  draw<T>(shown: Scene, render: () => T): T | undefined;
  forgive(id: string): void;
  hasFailed(id: string): boolean;
}

export function createSceneGuard(opts: SceneGuardOptions): SceneGuard {
  const reported = new Set<string>();
  const bad = new Set<string>();
  const history: Scene[] = [];
  let recovering = false;
  const log = opts.log ?? ((msg: string, err: unknown) => console.error(msg, err));

  function noteDrawn(scene: Scene): void {
    if (history[history.length - 1] === scene) return;
    const at = history.indexOf(scene);
    if (at !== -1) history.splice(at, 1);
    history.push(scene);
    if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
  }

  function recover(shown: Scene, err: unknown): void {
    const failed = err instanceof SceneRenderError ? err.scene : shown;
    const cause = err instanceof SceneRenderError ? err.original : err;
    if (!reported.has(failed.id)) {
      reported.add(failed.id);
      log(`Scene "${failed.id}" threw while drawing and was stopped:`, cause);
    }
    bad.add(failed.id);
    // The outgoing scene of a crossfade: the screen keeps the incoming one.
    if (failed !== shown) {
      opts.dropOutgoing();
      return;
    }
    // `switchTo` lands in the caller's own code, which may call `forgive`
    // (applyScene does); that must not clear the scene being stopped.
    recovering = true;
    try {
      for (;;) {
        const fb = chooseFallback(failed, history, bad, opts.builtIn(), opts.canRun);
        if (!fb) return;
        let shownNow = false;
        try {
          shownNow = opts.switchTo(fb.scene, failed);
        } catch {
          shownNow = false;
        }
        if (shownNow) {
          opts.notice?.(failed, fb.scene, fb.wasShown);
          return;
        }
        bad.add(fb.scene.id);
      }
    } finally {
      recovering = false;
    }
  }

  return {
    draw<T>(shown: Scene, render: () => T): T | undefined {
      if (bad.has(shown.id)) return undefined;
      try {
        const out = render();
        noteDrawn(shown);
        return out;
      } catch (err) {
        recover(shown, err);
        return undefined;
      }
    },
    forgive(id: string): void {
      if (recovering) return;
      bad.delete(id);
    },
    hasFailed(id: string): boolean {
      return bad.has(id);
    },
  };
}
