import { describe, expect, it } from "vitest";
import {
  PROBE_TIMEOUT_MS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  SILENCE_LIMIT_MS,
  isSilent,
  isTerminalClose,
  reconnectDelayMs,
} from "../src/net/reconnect.ts";
import { ROOM_CLOSE_DENIED } from "../server/roomRules.ts";

const middle = () => 0.5;

describe("reconnectDelayMs", () => {
  it("starts at the base and doubles, with the middle of the jitter band meaning no jitter", () => {
    expect(reconnectDelayMs(0, middle)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1, middle)).toBe(RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(2, middle)).toBe(RECONNECT_BASE_MS * 4);
  });

  it("is monotone and stops growing at the cap", () => {
    let prev = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      const d = reconnectDelayMs(attempt, middle);
      expect(d).toBeGreaterThanOrEqual(prev);
      expect(d).toBeLessThanOrEqual(RECONNECT_MAX_MS);
      prev = d;
    }
    expect(prev).toBe(RECONNECT_MAX_MS);
  });

  it("keeps jitter inside a fifth either side of the nominal delay, cap included", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const nominal = reconnectDelayMs(attempt, middle);
      expect(reconnectDelayMs(attempt, () => 0)).toBeGreaterThanOrEqual(Math.floor(nominal * 0.8));
      expect(reconnectDelayMs(attempt, () => 0)).toBeLessThan(nominal);
      expect(reconnectDelayMs(attempt, () => 0.999999)).toBeLessThanOrEqual(Math.ceil(nominal * 1.2));
      expect(reconnectDelayMs(attempt, () => 0.999999)).toBeGreaterThan(nominal);
    }
  });

  it("spreads a crowd that dropped together (different randoms, different delays)", () => {
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) delays.add(reconnectDelayMs(3, () => i / 10));
    expect(delays.size).toBeGreaterThan(5);
  });

  it("treats a nonsense attempt as the first one and survives a huge one", () => {
    expect(reconnectDelayMs(-3, middle)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelayMs(Number.NaN, middle)).toBe(RECONNECT_BASE_MS);
    expect(reconnectDelayMs(1.9, middle)).toBe(RECONNECT_BASE_MS * 2);
    expect(reconnectDelayMs(5000, middle)).toBe(RECONNECT_MAX_MS);
    expect(reconnectDelayMs(Infinity, middle)).toBe(RECONNECT_MAX_MS);
  });

  it("defaults to Math.random and stays in range", () => {
    for (let i = 0; i < 50; i++) {
      const d = reconnectDelayMs(2);
      expect(d).toBeGreaterThanOrEqual(RECONNECT_BASE_MS * 4 * 0.8 - 1);
      expect(d).toBeLessThanOrEqual(RECONNECT_BASE_MS * 4 * 1.2 + 1);
    }
  });
});

describe("isTerminalClose", () => {
  it("is true only for the room's denial code", () => {
    expect(isTerminalClose(ROOM_CLOSE_DENIED)).toBe(true);
  });

  it("treats every ordinary close as a blink to retry", () => {
    for (const code of [1000, 1001, 1005, 1006, 1011, 1012, 1013, 4000, 4001, 4002, 4004]) {
      expect(isTerminalClose(code)).toBe(false);
    }
  });
});

describe("isSilent", () => {
  const sentAt = 1_700_000_000_000;

  it("is false when no ping is outstanding, however late it is", () => {
    expect(isSilent(0, sentAt)).toBe(false);
    expect(isSilent(0, sentAt + SILENCE_LIMIT_MS * 100)).toBe(false);
  });

  it("turns true once the oldest unanswered ping is as old as the limit", () => {
    expect(isSilent(sentAt, sentAt)).toBe(false);
    expect(isSilent(sentAt, sentAt + SILENCE_LIMIT_MS - 1)).toBe(false);
    expect(isSilent(sentAt, sentAt + SILENCE_LIMIT_MS)).toBe(true);
    expect(isSilent(sentAt, sentAt + SILENCE_LIMIT_MS * 5)).toBe(true);
  });

  it("takes another limit for the quicker check", () => {
    expect(isSilent(sentAt, sentAt + PROBE_TIMEOUT_MS - 1, PROBE_TIMEOUT_MS)).toBe(false);
    expect(isSilent(sentAt, sentAt + PROBE_TIMEOUT_MS, PROBE_TIMEOUT_MS)).toBe(true);
  });

  it("gives the page-return probe less time than the steady watchdog", () => {
    expect(PROBE_TIMEOUT_MS).toBeLessThan(SILENCE_LIMIT_MS);
  });
});
