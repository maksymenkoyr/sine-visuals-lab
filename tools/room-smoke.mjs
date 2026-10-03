#!/usr/bin/env node
// Drives a running Worker + Durable Object (server/worker.ts, server/room.ts)
// with plain WebSocket clients: the part of the room that Vitest cannot reach.
// tests/roomCore.test.ts runs the room's rules against fake sockets; this runs
// the real adapter, the real hibernating sockets and real WebSocket framing.
// It is a black box on purpose — it builds the frames and the messages by hand
// (src/net/protocol.ts and src/net/roomMessages.ts have the formats) so it
// cannot share a bug with the code it checks. The one thing it borrows is
// LOOK_LIMITS, to size a value that is too big.
//
//   npm run dev:worker                                        # another terminal
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/room-smoke.mjs smoke [origin]
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node tools/room-smoke.mjs host  [origin]
//
// The origin is the argument, else ROOM_ORIGIN, else the one `npm run
// dev:worker` listens on. NODE_TLS_REJECT_UNAUTHORIZED=0 is for that dev
// server's self-signed certificate.
//
//   smoke  Claims a room as a host, then walks the join and send rules with two
//          controllers (a tablet and a phone) and a renderer: who gets the look
//          and when (the laptop too), that patches are acked and relayed to
//          everyone but the sender with the sender's id, that a renderer cannot
//          patch and an oversized patch is refused, that a late joiner receives
//          the same look, that the roster lists every member with its device
//          settings, that a deviceSet round trip changes one and a refused one is
//          answered with deviceReject, that frames go from a device on its own
//          input to the devices that follow it and from nobody else, that
//          every wrong credential is closed with the denial code and told
//          nothing, the TV adopt route (it reaches only the slot socket that
//          joined with the nonce), that a keyless host and renderer still relay
//          frames in an unclaimed room, that the host's deviceForget tells the
//          removed device, and that the host's endRoom tells every socket it
//          ended.
//          Exits non-zero if any check fails.
//   host   Plays the laptop for a real page: claims a room, prints its code,
//          keys and the phone (controller) URL, and streams synthetic frames at
//          the host rate until Ctrl-C. Lets a phone, a TV or a headless browser
//          be driven without a microphone. PAGE_ORIGIN is the origin of the page
//          that serves the app (the Vite URL under `npm run dev`; it defaults to
//          the room origin, right when the Worker serves a built site).
//
// Needs Node's global WebSocket (22 or newer) and a Node that strips TypeScript
// types, because it imports server/lookDoc.ts for LOOK_LIMITS (22.18 or newer).
// The Worker throttles room creation per IP, and `wrangler dev` has no client
// IP, so every request shares one bucket: repeated runs inside a minute can be
// told to slow down.

import { randomBytes } from "node:crypto";

const DEFAULT_ORIGIN = "https://localhost:8787";
const WAIT_MS = 3000; // for a message that should arrive
const QUIET_MS = 300; // for a message that should not

// The wire frame (src/net/protocol.ts header): type byte, one byte per band
// (src/audio/types.ts NUM_BANDS), energy, flags, onset phase (u16), bpm * 10
// (u16), level, and the room time as a float64, all little-endian.
const NUM_BANDS = 24;
const FRAME_BYTES = 1 + NUM_BANDS + 1 + 1 + 2 + 2 + 1 + 8;
const HOST_HZ = 30;

const [mode = "smoke", originArg] = process.argv.slice(2);
const origin = (originArg ?? process.env.ROOM_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/+$/, "");
const wsOrigin = origin.replace(/^http/, "ws");

function die(message) {
  console.error(message);
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  die("No global WebSocket in this Node. Use Node 22 or newer (or run with --experimental-websocket on 20).");
}
if (mode !== "smoke" && mode !== "host") die("Usage: node tools/room-smoke.mjs smoke|host [origin]");

const newKey = () => randomBytes(16).toString("base64url");
const u8 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));

/** One feature frame, built by hand. `f` is 0..1 for everything but bpm and onset. */
function frameBytes(f, roomTimeMs) {
  const buf = new ArrayBuffer(FRAME_BYTES);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o++, 1);
  for (let i = 0; i < NUM_BANDS; i++) v.setUint8(o++, u8(f.bands[i]));
  v.setUint8(o++, u8(f.energy));
  v.setUint8(o++, f.onset ? 3 : 0); // bit0 onset, bit1 pulseOnset
  v.setUint16(o, Math.round(f.phase * 65535), true);
  o += 2;
  v.setUint16(o, Math.round(f.bpm * 10), true);
  o += 2;
  v.setUint8(o++, u8(f.level));
  v.setFloat64(o, roomTimeMs, true);
  return buf;
}

/** A frame that moves a little and kicks on every beat of a steady tempo. */
function syntheticFrame(t, bpm = 120) {
  const beat = (t * bpm) / 60;
  const phase = beat - Math.floor(beat);
  const kick = Math.exp(-phase * 5);
  const bands = Array.from({ length: NUM_BANDS }, (_, i) => {
    const drift = 0.5 + 0.5 * Math.sin(t * 0.7 + i * 0.45);
    const weight = 1 - i / NUM_BANDS;
    return Math.min(1, 0.15 + 0.35 * drift + 0.5 * kick * weight);
  });
  const energy = bands.reduce((a, b) => a + b, 0) / NUM_BANDS;
  return { bands, energy, onset: phase < 1 / HOST_HZ / (60 / bpm), phase, bpm, level: 0.5 + 0.3 * kick };
}

async function newRoomCode() {
  const res = await fetch(`${origin}/api/room`, { method: "POST" });
  if (!res.ok) throw new Error(`POST /api/room answered ${res.status}`);
  return (await res.json()).code;
}

function roomUrl(code, role, deviceId, extra = {}) {
  const q = new URLSearchParams({ role, deviceId, ...extra });
  return `${wsOrigin}/api/room/${code}/ws?${q}`;
}

const sockets = new Set();

/** A WebSocket client that keeps what it receives. JSON messages are parsed;
 *  binary ones are kept as `{ binary: byteLength }`. */
function connect(label, url) {
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  const c = { label, ws, inbox: [], closed: null, waiters: [] };
  sockets.add(ws);
  c.opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", () => reject(new Error(`${label}: could not connect to ${origin}`)));
  });
  c.opened.catch(() => {}); // a denial test never awaits this
  c.whenClosed = new Promise((resolve) => {
    ws.addEventListener("close", (e) => {
      c.closed = { code: e.code, reason: e.reason };
      resolve(c.closed);
    });
  });
  ws.addEventListener("message", (e) => {
    c.inbox.push(typeof e.data === "string" ? JSON.parse(e.data) : { binary: e.data.byteLength });
    c.flush();
  });
  c.flush = () => {
    for (const w of [...c.waiters]) {
      const i = c.inbox.findIndex(w.pred);
      if (i === -1) continue;
      clearTimeout(w.timer);
      c.waiters.splice(c.waiters.indexOf(w), 1);
      w.resolve(c.inbox.splice(i, 1)[0]);
    }
  };
  /** Takes the first unread message matching `pred`, waiting for it if need be. */
  c.take = (what, pred, ms = WAIT_MS) =>
    new Promise((resolve, reject) => {
      const w = { pred, resolve, timer: setTimeout(() => {
        c.waiters.splice(c.waiters.indexOf(w), 1);
        reject(new Error(`${label}: no ${what} within ${ms} ms (unread: ${JSON.stringify(c.inbox).slice(0, 200)})`));
      }, ms) };
      c.waiters.push(w);
      c.flush();
    });
  /** Asserts that nothing matching `pred` shows up. */
  c.expectNone = async (what, pred, ms = QUIET_MS) => {
    await new Promise((r) => setTimeout(r, ms));
    const hit = c.inbox.find(pred);
    if (hit) throw new Error(`${label}: unexpected ${what}: ${JSON.stringify(hit).slice(0, 200)}`);
  };
  c.send = (msg) => ws.send(JSON.stringify(msg));
  c.sendBinary = (buf) => ws.send(buf);
  c.close = () => ws.close();
  return c;
}

const isType = (type) => (m) => m.type === type;
const isBinary = (m) => typeof m.binary === "number";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function assertEqual(actual, expected, what) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}

async function runSmoke() {
  let LOOK_LIMITS;
  try {
    ({ LOOK_LIMITS } = await import("../server/lookDoc.ts"));
  } catch (err) {
    die(`Could not load server/lookDoc.ts (${err.message}). This tool needs a Node that strips TypeScript types (22.18 or newer).`);
  }

  let failures = 0;
  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`ok    ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${name}\n      ${err.message}`);
    }
  };

  const code = await newRoomCode();
  const hostKey = newKey();
  const roomKey = newKey();
  const frame = frameBytes(syntheticFrame(1), Date.now());
  const url = {
    host: (extra = {}) => roomUrl(code, "host", "smoke-host", { hk: hostKey, k: roomKey, ...extra }),
    controller: (id, extra = {}) => roomUrl(code, "controller", id, { k: roomKey, ...extra }),
    renderer: (id, extra = {}) => roomUrl(code, "renderer", id, { k: roomKey, ...extra }),
  };

  let host, phone, tv, watcher;
  let lookBeforeClose;

  // The host claims the room with both keys; from then on it is keyed.
  await step("host claims an unclaimed room, is told the look, and gets a roster that lists it as the owner", async () => {
    host = connect("host", url.host({ kind: "laptop", mic: "1" }));
    await host.opened;
    const look = await host.take("look", isType("look"));
    assertEqual([look.rev, look.doc], [0, null], "the look the laptop is told");
    host.send({ type: "hello", scene: "spectrum", palette: "neon" });
    const roster = await host.take("roster", (m) => m.type === "roster" && m.devices.some((d) => d.scene === "spectrum"));
    const me = roster.devices.find((d) => d.role === "host");
    assert(me, "roster should list the host");
    assertEqual([me.owner, me.ears, me.screen, me.online], [true, "own", "main", true], "the owner's settings");
  });

  await step("a controller is told the look is empty, and is in the roster with its own settings", async () => {
    phone = connect("phone", url.controller("smoke-phone", { kind: "phone", mic: "1", name: "Smoke phone" }));
    await phone.opened;
    const look = await phone.take("look", isType("look"));
    assertEqual([look.rev, look.doc], [0, null], "an unpatched room's look");
    const roster = await host.take("roster", (m) => m.type === "roster" && m.devices.some((d) => d.deviceId === "smoke-phone"));
    const entry = roster.devices.find((d) => d.deviceId === "smoke-phone");
    assertEqual(
      [entry.role, entry.kind, entry.name, entry.hasMic, entry.ears, entry.follow, entry.screen, entry.online, entry.owner],
      ["controller", "phone", "Smoke phone", true, "follow", null, "off", true, false],
      "a phone's default settings",
    );
    assertEqual(roster.devices[0].deviceId, "smoke-host", "the owner is listed first");
    await phone.take("roster", isType("roster")); // it receives one too
  });

  await step("a controller's patch is acked with the next revision", async () => {
    phone.send({ type: "lookPatch", n: 1, scene: "spectrum", palette: "neon", set: { "vibe.smoke": "1" } });
    const ack = await phone.take("lookAck", isType("lookAck"));
    assertEqual([ack.n, ack.rev], [1, 1], "lookAck n, rev");
  });

  await step("a renderer joining with the room key gets the look so far", async () => {
    tv = connect("tv", url.renderer("smoke-tv"));
    await tv.opened;
    const look = await tv.take("look", isType("look"));
    assertEqual(look.rev, 1, "look rev");
    assertEqual([look.doc.scene, look.doc.palette, look.doc.storage], ["spectrum", "neon", { "vibe.smoke": "1" }], "look doc");
  });

  await step("a later patch is relayed to the renderer and the laptop with the sender's id, and not echoed", async () => {
    phone.send({ type: "lookPatch", n: 2, set: { "vibe.smoke": "2" } });
    const ack = await phone.take("lookAck", isType("lookAck"));
    assertEqual([ack.n, ack.rev], [2, 2], "lookAck n, rev");
    const patch = await tv.take("lookPatch", isType("lookPatch"));
    assertEqual([patch.rev, patch.set, patch.by], [2, { "vibe.smoke": "2" }, "smoke-phone"], "relayed patch");
    const atHost = await host.take("lookPatch", (m) => m.type === "lookPatch" && m.rev === 2);
    assertEqual([atHost.set, atHost.by], [{ "vibe.smoke": "2" }, "smoke-phone"], "the laptop's copy of the patch");
    await phone.expectNone("echoed lookPatch", isType("lookPatch"));
  });

  await step("a patch that changes nothing is acked without a new revision or a broadcast", async () => {
    phone.send({ type: "lookPatch", n: 3, set: { "vibe.smoke": "2" } });
    const ack = await phone.take("lookAck", isType("lookAck"));
    assertEqual([ack.n, ack.rev], [3, 2], "lookAck n, rev");
    await tv.expectNone("lookPatch for a no-op", isType("lookPatch"));
  });

  await step("host frames reach every device that follows it, never the host, and a follower's bytes go nowhere", async () => {
    watcher = connect("watcher", url.controller("smoke-watcher", { kind: "tablet", mic: "1" }));
    await watcher.opened;
    await watcher.take("look", isType("look"));
    for (let i = 0; i < 3; i++) host.sendBinary(frame);
    const seenByTv = await tv.take("binary frame", isBinary);
    const seenByWatcher = await watcher.take("binary frame", isBinary);
    const seenByPhone = await phone.take("binary frame", isBinary);
    assertEqual([seenByTv.binary, seenByWatcher.binary, seenByPhone.binary], [FRAME_BYTES, FRAME_BYTES, FRAME_BYTES], "relayed frame size");
    await host.expectNone("its own frame back", isBinary);
    for (const c of [tv, watcher, phone]) c.inbox = c.inbox.filter((m) => !isBinary(m));
    phone.sendBinary(frame); // the phone follows the laptop: it is not a feed
    await tv.expectNone("a frame from a device that is not on its own input", isBinary);
    await host.expectNone("a frame from a device that is not on its own input", isBinary);
  });

  await step("a renderer cannot patch the look", async () => {
    tv.send({ type: "lookPatch", n: 7, set: { "vibe.smoke": "tv" } });
    const rej = await tv.take("lookReject", isType("lookReject"));
    assertEqual([rej.n, rej.reason], [7, "role"], "lookReject n, reason");
  });

  await step("an oversized value is refused and changes nothing", async () => {
    phone.send({ type: "lookPatch", n: 8, set: { "vibe.big": "x".repeat(LOOK_LIMITS.maxValueBytes + 1) } });
    const rej = await phone.take("lookReject", isType("lookReject"));
    assertEqual([rej.n, rej.reason], [8, "size"], "lookReject n, reason");
    phone.send({ type: "lookGet" });
    const look = await phone.take("look", isType("look"));
    lookBeforeClose = look;
    assertEqual(look.rev, 2, "revision after a refused patch");
    assert(!("vibe.big" in look.doc.storage), "refused value must not be stored");
  });

  await step("a renderer that reconnects gets the same look with no controller activity", async () => {
    tv.close();
    await tv.whenClosed;
    tv = connect("tv again", url.renderer("smoke-tv"));
    await tv.opened;
    const look = await tv.take("look", isType("look"));
    assertEqual(look, lookBeforeClose, "look after reconnect");
  });

  await step("a deviceSet changes one device and everyone is told; a refused one is answered to the sender alone", async () => {
    phone.send({ type: "deviceSet", targetId: "smoke-tv", name: "Big TV", screen: "own" });
    for (const c of [host, phone, tv]) {
      const roster = await c.take(
        "roster with the new name",
        (m) => m.type === "roster" && m.devices.some((d) => d.deviceId === "smoke-tv" && d.name === "Big TV"),
      );
      assertEqual(roster.devices.find((d) => d.deviceId === "smoke-tv").screen, "own", "the TV's screen");
    }
    phone.send({ type: "deviceSet", targetId: "smoke-tv", ears: "own" });
    const reject = await phone.take("deviceReject", isType("deviceReject"));
    assertEqual([reject.targetId, reject.reason], ["smoke-tv", "no-mic"], "deviceReject targetId, reason");
    phone.send({ type: "deviceSet", targetId: "smoke-tv", ears: "loud" });
    const shape = await phone.take("deviceReject", isType("deviceReject"));
    assertEqual([shape.targetId, shape.reason], ["smoke-tv", "shape"], "deviceReject for a bad value");
    await tv.expectNone("deviceReject meant for the sender", isType("deviceReject"));
  });

  await step("a device on its own input is relayed to its followers, and the laptop's frames stop reaching them", async () => {
    phone.send({ type: "deviceSet", targetId: "smoke-phone", ears: "own" });
    await phone.take("roster showing it on its own input", (m) => m.type === "roster" && m.devices.some((d) => d.deviceId === "smoke-phone" && d.ears === "own"));
    tv.send({ type: "deviceSet", targetId: "smoke-tv", follow: "smoke-phone" });
    await tv.take("roster showing the TV following the phone", (m) => m.type === "roster" && m.devices.some((d) => d.deviceId === "smoke-tv" && d.follow === "smoke-phone"));
    for (const c of [host, phone, tv, watcher]) c.inbox = c.inbox.filter((m) => !isBinary(m));
    phone.sendBinary(frame);
    const got = await tv.take("binary frame from the phone", isBinary);
    assertEqual(got.binary, FRAME_BYTES, "relayed frame size");
    await host.expectNone("a frame from a device nobody told the laptop to follow", isBinary);
    host.sendBinary(frame);
    await watcher.take("binary frame from the laptop", isBinary);
    await tv.expectNone("a laptop frame at a device that follows the phone", isBinary);
  });

  // Every wrong credential: closed with the denial code, and told nothing.
  const denied = async (label, wsUrl) => {
    const c = connect(label, wsUrl);
    const closed = await Promise.race([
      c.whenClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: not closed within ${WAIT_MS} ms`)), WAIT_MS)),
    ]);
    assertEqual(closed.code, 4003, `${label}: close code`);
    assertEqual(c.inbox, [], `${label}: messages received before the close`);
  };
  const strayCode = await newRoomCode(); // never claimed

  await step("a renderer without the key is denied", () => denied("keyless renderer", roomUrl(code, "renderer", "smoke-stray")));
  await step("a controller with the wrong key is denied", () =>
    denied("wrong-key controller", roomUrl(code, "controller", "smoke-stray", { k: newKey() })));
  await step("a malformed key is denied", () =>
    denied("malformed key", roomUrl(code, "controller", "smoke-stray", { k: "short" })));
  await step("a controller cannot claim an unclaimed room", () =>
    denied("controller on an unclaimed code", roomUrl(strayCode, "controller", "smoke-stray", { k: newKey() })));
  await step("a keyless host is denied in a claimed room", () => denied("keyless host", roomUrl(code, "host", "smoke-stray")));
  await step("a host with the wrong host key is denied", () =>
    denied("wrong host key", roomUrl(code, "host", "smoke-stray", { hk: newKey(), k: roomKey })));
  await step("an unknown role is denied", () => denied("unknown role", roomUrl(code, "admin", "smoke-stray", { k: roomKey })));

  // The TV adopt route: a TV waits in a throwaway room, joined as a keyless
  // renderer under the nonce its QR carries (`adopt` query value). The slot's
  // code is on the TV's screen, so anyone may sit in it; the adopt carries the
  // room key and goes only to the socket that presented the nonce it names.
  await step("the adopt route reaches only the TV that joined with the nonce, and answers the rest", async () => {
    const slot = await newRoomCode();
    const nonce = newKey();
    const waiting = connect("waiting tv", roomUrl(slot, "renderer", "smoke-slot", { adopt: nonce }));
    const bystander = connect("bystander without a nonce", roomUrl(slot, "renderer", "smoke-bystander"));
    const stranger = connect("bystander with another nonce", roomUrl(slot, "renderer", "smoke-stranger", { adopt: newKey() }));
    await Promise.all([waiting.opened, bystander.opened, stranger.opened]);
    const adopt = (target, init) => fetch(`${origin}/api/room/${target}/adopt`, { method: "POST", ...init });
    const json = { headers: { "Content-Type": "application/json" } };

    const ok = await adopt(slot, { ...json, body: JSON.stringify({ room: code, k: roomKey, n: nonce }) });
    assertEqual([ok.status, await ok.json()], [200, { delivered: 1 }], "adopt to the TV that joined with the nonce");
    const msg = await waiting.take("adopt", isType("adopt"));
    assertEqual([msg.type, msg.room, msg.k, msg.n], ["adopt", code, roomKey, nonce], "adopt message");
    await bystander.expectNone("adopt", isType("adopt"));
    await stranger.expectNone("adopt", isType("adopt"));

    const unknown = await adopt(slot, { ...json, body: JSON.stringify({ room: code, k: roomKey, n: newKey() }) });
    assertEqual([unknown.status, await unknown.json()], [404, { delivered: 0 }], "adopt with a nonce nobody presented");
    await waiting.expectNone("adopt for another nonce", isType("adopt"));

    const nobody = await adopt(await newRoomCode(), { ...json, body: JSON.stringify({ room: code, k: roomKey, n: nonce }) });
    assertEqual([nobody.status, await nobody.json()], [404, { delivered: 0 }], "adopt to an empty room");
    const bad = await adopt(slot, { ...json, body: JSON.stringify({ room: "nope" }) });
    assertEqual(bad.status, 400, "adopt with a malformed body");
    const notJson = await adopt(slot, { ...json, body: "not json" });
    assertEqual(notJson.status, 400, "adopt with a body that is not JSON");
    const preflight = await fetch(`${origin}/api/room/${slot}/adopt`, { method: "OPTIONS" });
    assertEqual(preflight.status, 204, "adopt preflight status");
    assert(preflight.headers.get("access-control-allow-origin") === "*", "adopt preflight should carry CORS");
    for (const c of [waiting, bystander, stranger]) c.close();
  });

  // An unclaimed room behaves as it did before keys existed.
  await step("a keyless host and renderer still relay frames in an unclaimed room", async () => {
    const legacy = await newRoomCode();
    const h = connect("legacy host", roomUrl(legacy, "host", "smoke-lhost"));
    const r = connect("legacy renderer", roomUrl(legacy, "renderer", "smoke-lrend"));
    await Promise.all([h.opened, r.opened]);
    r.send({ type: "hello", scene: "spectrum", palette: "neon" });
    const roster = await r.take("roster", isType("roster"));
    assert(roster.devices.some((d) => d.deviceId === "smoke-lrend" && d.role === "renderer"), "roster should list the renderer");
    h.sendBinary(frame);
    const got = await r.take("binary frame", isBinary);
    assertEqual(got.binary, FRAME_BYTES, "relayed frame size");
    r.send({ type: "lookGet" });
    await r.expectNone("look in an unclaimed room", isType("look"));
    h.close();
    r.close();
  });

  // Last and on its own: the room answers this before it has read the body, so
  // a server that mishandles that is better found after the other checks ran.
  await step("an adopt body over the cap is refused", async () => {
    const res = await fetch(`${origin}/api/room/${await newRoomCode()}/adopt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ room: code, k: roomKey, n: newKey(), pad: "x".repeat(LOOK_LIMITS.maxAdoptBodyBytes) }),
    });
    assertEqual(res.status, 413, "adopt with an oversized body");
  });

  // The laptop removes a device: the device is told, and the roster drops it.
  // Only the message is checked, for the same reason as endRoom below.
  await step("the host's deviceForget tells the removed device and drops it from the roster", async () => {
    const forgetCode = await newRoomCode();
    const hk = newKey();
    const k = newKey();
    const owner = connect("owner", roomUrl(forgetCode, "host", "smoke-fo-host", { hk, k }));
    await owner.opened;
    const pad = connect("pad to remove", roomUrl(forgetCode, "controller", "smoke-fo-pad", { k, kind: "tablet", mic: "1" }));
    await pad.opened;
    await owner.take("roster with the pad", (m) => m.type === "roster" && m.devices.some((d) => d.deviceId === "smoke-fo-pad"));
    pad.send({ type: "deviceForget", targetId: "smoke-fo-host" }); // not allowed: only the owner forgets
    await owner.expectNone("ended", isType("ended"));
    owner.send({ type: "deviceForget", targetId: "smoke-fo-pad" });
    const gone = await pad.take("ended", isType("ended"));
    assertEqual(gone.reason, "removed", "ended reason");
    await owner.take("roster without the pad", (m) => m.type === "roster" && !m.devices.some((d) => d.deviceId === "smoke-fo-pad"));
    owner.close();
  });

  // The laptop's Reset: the host ends its room, every socket is told `ended`,
  // the host's is closed with the denial code, and the old keys get nobody back
  // in. Only the host's close is checked: under `wrangler dev` a close the room
  // starts on another socket leaves that client stuck closing, which is why
  // `ended` exists (src/net/roomMessages.ts). A room of its own, so the checks
  // above keep theirs.
  await step("the host's endRoom tells every socket it ended, and the old keys are dead", async () => {
    const ended = await newRoomCode();
    const hk = newKey();
    const k = newKey();
    const endHost = connect("ending host", roomUrl(ended, "host", "smoke-end-host", { hk, k }));
    await endHost.opened;
    const endTv = connect("tv in the ending room", roomUrl(ended, "renderer", "smoke-end-tv", { k }));
    await endTv.opened;
    await endTv.take("look", isType("look"));
    endHost.send({ type: "endRoom" });
    await endTv.take("ended", isType("ended"));
    await endHost.take("ended", isType("ended"));
    const closed = await Promise.race([
      endHost.whenClosed,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`host not closed within ${WAIT_MS} ms`)), WAIT_MS)),
    ]);
    assertEqual(closed.code, 4003, "host close code after endRoom");
    await denied("tv back with the ended room's key", roomUrl(ended, "renderer", "smoke-end-tv", { k }));
  });

  for (const ws of sockets) ws.close();
  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

async function runHost() {
  const code = await newRoomCode();
  const hostKey = newKey();
  const roomKey = newKey();
  const host = connect("host", roomUrl(code, "host", "synthetic-host", { hk: hostKey, k: roomKey }));
  await host.opened;

  // The real host stamps frames with a room time a renderer can map onto its own
  // clock (src/net/clock.ts): the Worker's clock, estimated from ping round trips.
  let offset = 0;
  let bestRtt = Infinity;
  host.ws.addEventListener("message", (e) => {
    if (typeof e.data !== "string") return;
    const m = JSON.parse(e.data);
    if (m.type !== "pong") return;
    const now = Date.now();
    const rtt = now - m.t0;
    if (rtt < bestRtt) {
      bestRtt = rtt;
      offset = m.tServer - (m.t0 + rtt / 2);
    }
  });
  for (let i = 0; i < 5; i++) setTimeout(() => host.send({ type: "ping", t0: Date.now() }), i * 100);
  host.send({ type: "hello", scene: "spectrum", palette: "neon" });

  const page = (process.env.PAGE_ORIGIN ?? origin).replace(/\/+$/, "");
  console.log(`Room        ${code}`);
  console.log(`Host key    ${hostKey}   (stays on the laptop)`);
  console.log(`Room key    ${roomKey}`);
  console.log(`Phone       ${page}/?room=${code}&role=controller&k=${roomKey}`);
  console.log(`Watch-only  ${page}/?room=${code}&k=${roomKey}`);
  console.log("Streaming synthetic frames. Ctrl-C to stop.");

  const t0 = Date.now();
  const timer = setInterval(() => {
    if (host.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    host.sendBinary(frameBytes(syntheticFrame((now - t0) / 1000), now + offset));
  }, 1000 / HOST_HZ);

  const stop = () => {
    clearInterval(timer);
    host.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  host.whenClosed.then((c) => {
    clearInterval(timer);
    die(`The room closed the host's socket (code ${c.code}).`);
  });
}

try {
  await (mode === "smoke" ? runSmoke() : runHost());
} catch (err) {
  const refused = /ECONNREFUSED|fetch failed|could not connect/.test(`${err.message} ${err.cause?.code ?? ""}`);
  die(`${err.message}${refused ? `\nIs the Worker running at ${origin}? Start it with \`npm run dev:worker\`.` : ""}`);
}
