import { describe, expect, it } from "vitest";
import { postAdopt } from "../src/net/adopt.ts";
import { newKey } from "../src/net/pairing.ts";

const BODY = { room: "ABCD", k: newKey(), n: newKey() };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(status: number): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return { status } as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("postAdopt", () => {
  it("posts the room, key and nonce as JSON to the slot's adopt route", async () => {
    const { fetchFn, calls } = fakeFetch(200);
    await postAdopt("https://example.test", "WXYZ", BODY, fetchFn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.test/api/room/WXYZ/adopt");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(BODY);
  });

  it("tolerates a trailing slash on the origin", async () => {
    const { fetchFn, calls } = fakeFetch(200);
    await postAdopt("https://example.test/", "WXYZ", BODY, fetchFn);
    expect(calls[0].url).toBe("https://example.test/api/room/WXYZ/adopt");
  });

  it("maps 200 to ok", async () => {
    expect(await postAdopt("https://x.test", "WXYZ", BODY, fakeFetch(200).fetchFn)).toBe("ok");
  });

  it("maps 404 to no-screen", async () => {
    expect(await postAdopt("https://x.test", "WXYZ", BODY, fakeFetch(404).fetchFn)).toBe("no-screen");
  });

  it("maps 429 to throttled", async () => {
    expect(await postAdopt("https://x.test", "WXYZ", BODY, fakeFetch(429).fetchFn)).toBe("throttled");
  });

  it("maps every other status to error", async () => {
    for (const status of [201, 204, 400, 403, 413, 500, 503]) {
      expect(await postAdopt("https://x.test", "WXYZ", BODY, fakeFetch(status).fetchFn)).toBe("error");
    }
  });

  it("maps a network failure to error instead of throwing", async () => {
    const fetchFn = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await postAdopt("https://x.test", "WXYZ", BODY, fetchFn)).toBe("error");
  });

  it("refuses a slot that isn't a room code, without calling out", async () => {
    for (const slot of ["", "abcd", "AB", "ABCDE", "../x", "AB/D", "AB1D"]) {
      const { fetchFn, calls } = fakeFetch(200);
      expect(await postAdopt("https://x.test", slot, BODY, fetchFn)).toBe("error");
      expect(calls).toHaveLength(0);
    }
  });
});
