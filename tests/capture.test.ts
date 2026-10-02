import { afterEach, describe, expect, it, vi } from "vitest";
import { captureMic } from "../src/audio/capture.ts";

// capture.ts is browser glue, so the globals it touches are stubbed: just
// enough of navigator.mediaDevices, AudioContext and document to pin the two
// things that go wrong quietly — a stream leaked when the context can't be
// built, and a context that never gets asked to resume.

function fakeStream() {
  const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
  return { tracks, stream: { getTracks: () => tracks, getAudioTracks: () => tracks, getVideoTracks: () => [] } };
}

class FakeContext extends EventTarget {
  state: string;
  resume = vi.fn(() => {
    this.state = "running";
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.state = "closed";
    return Promise.resolve();
  });
  constructor(state = "running") {
    super();
    this.state = state;
  }
  createMediaStreamSource() {
    return {};
  }
}

function stubGlobals(stream: unknown, makeContext: () => FakeContext) {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  vi.stubGlobal("AudioContext", function () {
    return makeContext();
  });
  vi.stubGlobal("document", new EventTarget());
}

afterEach(() => vi.unstubAllGlobals());

describe("captureMic cleanup", () => {
  it("stops every track and closes the context when the source node can't be made", async () => {
    const { tracks, stream } = fakeStream();
    const ctx = new FakeContext();
    ctx.createMediaStreamSource = () => {
      throw new Error("track ended");
    };
    stubGlobals(stream, () => ctx);
    await expect(captureMic()).rejects.toThrow("track ended");
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
  });

  it("stops every track when the AudioContext constructor throws", async () => {
    const { tracks, stream } = fakeStream();
    stubGlobals(stream, () => {
      throw new Error("too many contexts");
    });
    await expect(captureMic()).rejects.toThrow("too many contexts");
    for (const t of tracks) expect(t.stop).toHaveBeenCalled();
  });
});

describe("captureMic context resume", () => {
  it("resumes a context that starts suspended, and again on a statechange and a gesture", async () => {
    const { stream } = fakeStream();
    const ctx = new FakeContext("suspended");
    stubGlobals(stream, () => ctx);
    await captureMic();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = "interrupted"; // iOS: a call or Siri
    ctx.dispatchEvent(new Event("statechange"));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    ctx.state = "suspended"; // a resume() refused without a gesture
    document.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resume).toHaveBeenCalledTimes(3);
  });

  it("leaves a running context alone, and never resumes one that stop() closed", async () => {
    const { stream } = fakeStream();
    const ctx = new FakeContext("running");
    stubGlobals(stream, () => ctx);
    const handle = await captureMic();
    ctx.dispatchEvent(new Event("statechange"));
    expect(ctx.resume).not.toHaveBeenCalled();
    handle.stop();
    ctx.state = "suspended";
    ctx.dispatchEvent(new Event("statechange"));
    document.dispatchEvent(new Event("pointerdown"));
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
