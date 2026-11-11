import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLook, createWalker, releaseFreeLook, setMoveKey, takeFreeLook, type Walker, type WalkerPose } from "../src/render/freeLook.ts";

const OPTS = { walkSpeed: 2, climbSpeed: 1, pitchMax: 1.2 };

/** Steps the walker for `seconds` at 60 fps and returns a copy of the pose. */
function run(walker: Walker, seconds: number): WalkerPose {
  let pose = walker.step(0, takeFreeLook());
  for (let i = 0; i < Math.round(seconds * 60); i++) pose = walker.step(1 / 60, takeFreeLook());
  return { ...pose };
}

afterEach(() => releaseFreeLook());

describe("free look walker", () => {
  it("stands still with no input", () => {
    expect(run(createWalker(OPTS), 10)).toEqual({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  });

  it("walks where it looks, at its speed, and comes to a stop when let go", () => {
    const w = createWalker(OPTS);
    setMoveKey("forward", true);
    const a = run(w, 2);
    const b = run(w, 1);
    expect(b.z - a.z).toBeCloseTo(-OPTS.walkSpeed, 3);
    expect(b.x).toBeCloseTo(0, 9);
    addLook(Math.PI / 2, 0);
    const c = run(w, 2);
    const d = run(w, 1);
    expect(d.x - c.x).toBeCloseTo(OPTS.walkSpeed, 3);
    setMoveKey("forward", false);
    const e = run(w, 1);
    expect(run(w, 1).x).toBeCloseTo(e.x, 3);
  });

  it("is no faster on a diagonal", () => {
    const w = createWalker(OPTS);
    setMoveKey("forward", true);
    setMoveKey("right", true);
    const a = run(w, 2);
    const b = run(w, 1);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(OPTS.walkSpeed, 3);
  });

  it("stops its pitch at pitchMax and walks along the ground whatever the pitch", () => {
    const w = createWalker(OPTS);
    addLook(0, 5);
    setMoveKey("forward", true);
    const p = run(w, 2);
    expect(p.pitch).toBe(OPTS.pitchMax);
    expect(p.y).toBe(0);
    addLook(0, -50);
    expect(run(w, 0).pitch).toBe(-OPTS.pitchMax);
  });

  it("climbs and sinks", () => {
    const w = createWalker(OPTS);
    setMoveKey("up", true);
    expect(run(w, 2).y).toBeGreaterThan(1.5 * OPTS.climbSpeed);
    setMoveKey("up", false);
    setMoveKey("down", true);
    expect(run(w, 4).y).toBeLessThan(0);
  });

  it("wraps x and z into its period", () => {
    const w = createWalker({ ...OPTS, period: 10 });
    setMoveKey("forward", true);
    setMoveKey("left", true);
    for (let i = 0; i < 20; i++) {
      const p = run(w, 1);
      for (const v of [p.x, p.z]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(10);
      }
    }
  });

  it("spends a turn on the take that reads it, and keeps keys held", () => {
    addLook(0.3, -0.1);
    setMoveKey("left", true);
    const first = { ...takeFreeLook() };
    expect(first).toEqual({ yaw: 0.3, pitch: -0.1, forward: 0, right: -1, up: 0 });
    expect({ ...takeFreeLook() }).toEqual({ yaw: 0, pitch: 0, forward: 0, right: -1, up: 0 });
    releaseFreeLook();
    expect(takeFreeLook().right).toBe(0);
  });
});

// ui/freeLook.ts listens on the canvas, window and document; the tests run in
// node, so all three are small fakes that keep the listeners.
type Listener = (e: Record<string, unknown>) => void;

function listenerHost() {
  const on = new Map<string, Listener[]>();
  return {
    addEventListener(type: string, fn: Listener) {
      on.set(type, [...(on.get(type) ?? []), fn]);
    },
    fire(type: string, fields: Record<string, unknown> = {}) {
      const e = {
        claimed: false,
        stopped: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault() {},
        stopImmediatePropagation() {
          e.claimed = true;
        },
        stopPropagation() {
          e.stopped = true;
        },
        ...fields,
      };
      for (const fn of on.get(type) ?? []) fn(e);
      return e;
    },
  };
}

describe("free look keys", () => {
  let win: ReturnType<typeof listenerHost>;
  let doc: ReturnType<typeof listenerHost> & { pointerLockElement: unknown; hidden: boolean; exitPointerLock(): void };
  let canvas: ReturnType<typeof listenerHost> & { requestPointerLock(): Promise<void> };
  let walkable: boolean;
  let starts: number;

  beforeEach(async () => {
    walkable = true;
    starts = 0;
    win = listenerHost();
    doc = Object.assign(listenerHost(), {
      pointerLockElement: null as unknown,
      hidden: false,
      exitPointerLock() {
        doc.pointerLockElement = null;
        doc.fire("pointerlockchange");
      },
    });
    canvas = Object.assign(listenerHost(), {
      requestPointerLock() {
        doc.pointerLockElement = canvas;
        doc.fire("pointerlockchange");
        return Promise.resolve();
      },
    });
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    const { wireFreeLook } = await import("../src/ui/freeLook.ts");
    wireFreeLook({ canvas: canvas as unknown as HTMLCanvasElement, enabled: () => walkable, onStart: () => starts++ });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const click = (fields: Record<string, unknown> = {}) => canvas.fire("pointerdown", { pointerType: "mouse", button: 0, ...fields });
  const key = (type: "keydown" | "keyup", code: string, fields: Record<string, unknown> = {}) => win.fire(type, { code, key: code, ...fields });

  it("starts on a mouse click on the picture of a walkable scene, not on a touch", () => {
    click({ pointerType: "touch" });
    walkable = false;
    click();
    expect(doc.pointerLockElement).toBe(null);
    walkable = true;
    click();
    expect(doc.pointerLockElement).toBe(canvas);
    expect(starts).toBe(1);
  });

  it("leaves the keys alone until the walk starts", () => {
    expect(key("keydown", "KeyW").claimed).toBe(false);
    expect(takeFreeLook().forward).toBe(0);
  });

  it("claims the move keys while walking, and only those", () => {
    click();
    expect(key("keydown", "KeyW").claimed).toBe(true);
    expect(key("keydown", "ArrowUp").claimed).toBe(true);
    expect(key("keydown", "Digit1").claimed).toBe(false);
    expect(key("keydown", "KeyD", { metaKey: true }).claimed).toBe(false);
    expect(takeFreeLook().forward).toBe(1);
    expect(key("keyup", "KeyW").claimed).toBe(true);
    expect(takeFreeLook().forward).toBe(1);
    key("keyup", "ArrowUp");
    expect(takeFreeLook().forward).toBe(0);
    key("keydown", "Space");
    expect(takeFreeLook().up).toBe(1);
  });

  it("turns with the mouse, keeps the moves from the rest of the page, and drops a jump", () => {
    click();
    expect(win.fire("pointermove", { movementX: 100, movementY: 50 }).stopped).toBe(true);
    const turn = { ...takeFreeLook() };
    expect(turn.yaw).toBeGreaterThan(0);
    expect(turn.pitch).toBeLessThan(0);
    win.fire("pointermove", { movementX: 1000, movementY: 0 });
    expect(takeFreeLook().yaw).toBe(0);
  });

  it("stops on Esc and swallows an Esc that comes just after the lock ends", () => {
    click();
    expect(key("keydown", "Escape").claimed).toBe(true);
    expect(doc.pointerLockElement).toBe(null);
    expect(key("keydown", "Escape").claimed).toBe(true);
    vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1000);
    expect(key("keydown", "Escape").claimed).toBe(false);
  });

  it("lets go of held keys when the walk stops, and their key-ups pass", () => {
    click();
    key("keydown", "KeyW");
    doc.exitPointerLock();
    expect(takeFreeLook().forward).toBe(0);
    expect(key("keyup", "KeyW").claimed).toBe(false);
  });

  it("lets go when Command comes up, since macOS sends no key-up under it", () => {
    click();
    key("keydown", "KeyW");
    key("keyup", "MetaLeft", { key: "Meta" });
    expect(takeFreeLook().forward).toBe(0);
  });

  it("stops at the next key once the scene can't be walked", () => {
    click();
    walkable = false;
    expect(key("keydown", "KeyW").claimed).toBe(false);
    expect(doc.pointerLockElement).toBe(null);
  });
});
