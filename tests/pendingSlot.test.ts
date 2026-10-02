import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_CLOSE_DENIED } from "../server/roomRules.ts";
import type { AdoptMessage } from "../src/net/roomMessages.ts";

// src/net/pendingSlot.ts reaches room.ts (and so config.ts), which read
// `location` and friends at import, under environment: "node". Each test stubs
// just those, with a socket it can feed and drop by hand, and imports fresh.

class FakeSocket {
  static instances: FakeSocket[] = [];
  closed = false;
  private handlers: Record<string, Array<(e: unknown) => void>> = {};

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, cb: (e: unknown) => void): void {
    (this.handlers[type] ??= []).push(cb);
  }

  close(): void {
    this.closed = true;
  }

  receive(data: unknown): void {
    for (const cb of this.handlers.message ?? []) cb({ data });
  }
  drop(code: number): void {
    for (const cb of this.handlers.close ?? []) cb({ code });
  }
}

const NONCE = "N".repeat(22);
const ROOM_KEY = "K".repeat(22);
const ADOPT = JSON.stringify({ type: "adopt", room: "WXYZ", k: ROOM_KEY, n: NONCE });

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  FakeSocket.instances = [];
  const noop = { addEventListener: () => undefined, removeEventListener: () => undefined, visibilityState: "visible" };
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { ...noop, localStorage: undefined });
  vi.stubGlobal("document", noop);
  vi.stubGlobal("location", { hostname: "localhost", origin: "https://localhost:5173" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function last(): FakeSocket {
  return FakeSocket.instances[FakeSocket.instances.length - 1];
}

async function open(onAdopt: (m: AdoptMessage) => void = () => undefined, onDenied?: () => void) {
  const { PendingSlot } = await import("../src/net/pendingSlot.ts");
  return new PendingSlot("ABCD", "throwaway-device", NONCE, onAdopt, onDenied);
}

describe("PendingSlot", () => {
  it("joins the slot as a keyless renderer presenting the nonce, so the room can address the adopt to it", async () => {
    await open();
    expect(last().url).toBe(`wss://localhost:8787/api/room/ABCD/ws?role=renderer&deviceId=throwaway-device&adopt=${NONCE}`);
    expect(last().url).not.toContain("k=");
  });

  it("presents the same nonce again on every redial", async () => {
    await open();
    last().drop(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.instances).toHaveLength(2);
    expect(last().url).toContain(`&adopt=${NONCE}`);
  });

  it("hands a parsed adopt to its caller, and ignores everything else", async () => {
    const got: AdoptMessage[] = [];
    await open((m) => got.push(m));
    last().receive(new ArrayBuffer(8));
    last().receive("not json");
    last().receive(JSON.stringify({ type: "roster", devices: [] }));
    expect(got).toEqual([]);
    last().receive(ADOPT);
    expect(got).toEqual([{ type: "adopt", room: "WXYZ", k: ROOM_KEY, n: NONCE }]);
  });

  it("reports a denied join once instead of redialling", async () => {
    const denied = vi.fn();
    await open(undefined, denied);
    last().drop(ROOM_CLOSE_DENIED);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("stays quiet once closed", async () => {
    const got: AdoptMessage[] = [];
    const slot = await open((m) => got.push(m));
    const ws = last();
    slot.close();
    expect(ws.closed).toBe(true);
    ws.receive(ADOPT);
    ws.drop(1006);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(got).toEqual([]);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
