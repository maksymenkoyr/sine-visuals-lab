import { describe, expect, it } from "vitest";
import { LOOK_LIMITS } from "../server/lookDoc.ts";
import { RoomCore, type Attachment, type CoreHost, type CoreSocket } from "../server/roomCore.ts";
import { NUM_BANDS } from "../src/audio/types.ts";
import { decodeFeatureFrame, encodeFeatureFrame } from "../src/net/protocol.ts";

// The relay never parses a feature frame, but it drops one longer than
// LOOK_LIMITS.maxBinaryBytes (server/roomCore.ts relayFrame) — in every room,
// legacy ones included, with no error and no reject. So the frame layout
// (src/net/protocol.ts) and that cap are coupled: grow the frame without
// raising the cap and every TV and phone preview goes black. Nothing else in
// the suite connects the two, because the room tests use made-up byte counts.

/** Bytes of slack the cap keeps above the real frame, so one more small field
 *  does not need a Worker deploy to land first. */
const HEADROOM_BYTES = 8;

const fullFrame = {
  bands: new Float32Array(NUM_BANDS).fill(1),
  energy: 1,
  onset: true,
  pulseOnset: true,
  bpm: 999,
  onsetPhase: 1,
  level: 1,
};

describe("the feature frame and the relay's binary cap", () => {
  it("fits the cap, whatever the values", () => {
    for (const frame of [fullFrame, { ...fullFrame, bands: new Float32Array(NUM_BANDS) }]) {
      const bytes = encodeFeatureFrame(frame, 1_755_000_123_456.789).byteLength;
      expect(bytes, "raise LOOK_LIMITS.maxBinaryBytes (server/lookDoc.ts) in the same change that grows the frame").toBeLessThanOrEqual(
        LOOK_LIMITS.maxBinaryBytes,
      );
    }
  });

  it("leaves headroom under the cap", () => {
    const bytes = encodeFeatureFrame(fullFrame, 0).byteLength;
    expect(LOOK_LIMITS.maxBinaryBytes - bytes).toBeGreaterThanOrEqual(HEADROOM_BYTES);
  });

  it("is relayed by a real room, and still decodes on the other side", () => {
    const sent: Array<string | ArrayBuffer> = [];
    const attachment = (role: "host" | "renderer", sid: string): Attachment => ({
      sid,
      role,
      deviceId: sid,
      scene: "",
      palette: "",
      viewport: { x: 0, y: 0, w: 1, h: 1 },
      keyed: false,
      kind: role === "host" ? "laptop" : "tv",
      hasMic: role === "host",
    });
    const socket = (a: Attachment, tags: string[], log?: Array<string | ArrayBuffer>): CoreSocket & { tags: string[] } => ({
      attachment: a,
      tags,
      send: (d) => void log?.push(d),
      close: () => undefined,
      setAttachment: () => undefined,
    });
    const hostSocket = socket(attachment("host", "laptop"), ["host", "laptop"]);
    const tv = socket(attachment("renderer", "tv"), ["renderer", "tv"], sent);
    const live = [hostSocket, tv];
    const host: CoreHost = {
      sockets: (tag) => live.filter((s) => tag === undefined || s.tags.includes(tag)),
      now: () => 0,
      setAlarm: () => undefined,
      deleteAlarm: () => undefined,
      put: () => undefined,
      remove: () => undefined,
      removeAll: () => undefined,
    };
    const core = new RoomCore(host, new Map());

    core.message(hostSocket, encodeFeatureFrame(fullFrame, 42));

    expect(sent.length).toBe(1);
    expect(decodeFeatureFrame(sent[0] as ArrayBuffer)?.roomTimeMs).toBe(42);
  });
});
