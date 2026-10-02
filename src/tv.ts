// Must stay the first import: installs the TV's room-look storage overlay
// before any store module seeds its cache from localStorage (net/roomStorage.ts).
import "./net/tvStorageBoot.ts";
import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize } from "./render/gl.ts";
import { detectQuality, qualitySettings, type QualityPreset, type QualitySettings } from "./render/quality.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type SceneContext, type Viewport } from "./render/scene.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune, resolveExpansion, resolveSensitivity, resolveSmoothing } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createRoomCode, RendererConnection, type DeviceCommand } from "./net/room.ts";
import { roomCodeFromParam } from "./net/roomCode.ts";
import { createJoinScreen, type JoinScreen } from "./ui/joinScreen.ts";
import { SOURCE_URL } from "./brand.ts";
import { BUILD_INFO, versionHint, versionLabel } from "./version.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { getSilenceGate } from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import { applyBandGains, getBandGains } from "./audio/bandGains.ts";
import { applySensitivity } from "./audio/sensitivity.ts";
import type { FeatureFrame } from "./audio/types.ts";
import { createDriveEngine } from "./render/drives.ts";
import { realStorage } from "./net/realStorage.ts";
import { applyRoomStorage } from "./net/syncedStores.ts";
import { createLookReplica, type LookReplica } from "./net/lookSync.ts";
import { newKey, TV_SLOT_ROTATE_MS } from "./net/pairing.ts";
import { clearSession, readSession, writeSession } from "./net/sessions.ts";
import { PendingSlot } from "./net/pendingSlot.ts";
import { reconnectDelayMs } from "./net/reconnect.ts";
import { tvPhase, waitingLine, TV_PHASE_TEXT, WAITING_HINT_AFTER_MS, type TvPhase } from "./net/tvPhase.ts";
import type { AdoptMessage } from "./net/roomMessages.ts";
import type { LookDoc, LookServerMsg } from "../server/lookDoc.ts";

/**
 * The paired display entry (tv.html). A renderer in the room's mould: the
 * laptop (host) streams feature frames, a phone (controller) edits the room's
 * look document, and this page draws what they say — it has no panel and no
 * audio of its own.
 *
 * The page is in one phase at a time (net/tvPhase.ts) and `setPhase` is the one
 * place that decides what is drawn over the picture. Unpaired, it shows the
 * pairing QR: it holds a throwaway slot room (net/pendingSlot.ts), and a phone
 * that scans the QR hands it a room to join (`onAdopt`). Once paired it keeps
 * its room and key (net/sessions.ts) so a reload or a power cycle rejoins
 * without anyone scanning again, and the QR never comes back unless the viewer
 * presses OK twice. The nonce in the QR, not anything the server holds, is
 * what proves an adoption was meant for this screen: the slot socket presents
 * it when it joins, so the room hands the adopt (which carries the room key)
 * to that socket and not to anyone else who sat down in the slot.
 *
 * The QR screen also carries a field to type a room code (ui/joinScreen.ts,
 * `{ tv: true }`), which reloads this page with `?room=CODE` and joins that
 * room without a key. Only an unclaimed room takes that (server/roomRules.ts
 * `decideJoin`); a laptop's room never does, and `typedRoomRefused` puts the
 * screen back where it was and says why.
 *
 * The look (server/lookDoc.ts) arrives as snapshots and patches, is folded
 * into a replica (net/lookSync.ts) and applied whole: the room-scope storage is
 * written into this page's localStorage overlay and every store re-seeds from
 * it (`applyRoomStorage`), the same mechanism the pop-out uses. So the TV
 * resolves Sensitivity, Expansion, Smoothing, band gains and drives itself, from
 * its own anim clock on the host's frames, rather than being sent resolved
 * values; its Auto readouts are therefore its own. What does not travel:
 * the laptop's audio input and its own analysis marks (syncedStores.ts's
 * PRIVATE_KEYS and VOLATILE_PREFIXES), and the readings only a local extractor
 * has (`beatRatio`, `wavePeak`).
 */

/** No new frame this long -> the laptop is not sending: the "waiting" phase. */
const STALE_TIMEOUT_MS = 3000;
/** How long "Joined ABCD" stays up after an adoption. */
const JOINED_PILL_MS = 8000;
/** The second OK press has to follow the first within this long to re-pair. */
const REPAIR_WINDOW_MS = 3000;
const REPAIR_PROMPT = "Press OK again to pair another phone";
const SLOT_RETRY_TEXT = "Couldn't reach the server. Trying again...";
const TYPED_REFUSED_TEXT = "That room needs its QR, a code alone can't join it";
const TYPED_REFUSED_PILL_MS = 8000;

const canvas = document.getElementById("gl") as HTMLCanvasElement;
const badge = document.getElementById("badge") as HTMLDivElement;

// The AGPL §13 network-source offer — see src/brand.ts. Same visual language
// as #badge (tv.html), opposite corner, dimmer: present but not competing
// with the visualization. Carries the version label too (src/version.ts) —
// this corner is the TV's only chrome, so it doubles as the version corner
// the gallery footer (src/ui/gallery.ts) shows on the phone/laptop entry.
const sourceLink = document.createElement("a");
sourceLink.textContent = `Source (AGPL-3.0) · ${versionLabel(BUILD_INFO)}`;
sourceLink.title = versionHint(BUILD_INFO).join("\n");
sourceLink.href = SOURCE_URL;
sourceLink.target = "_blank";
sourceLink.rel = "noopener";
sourceLink.style.cssText = `
  position: fixed; bottom: 16px; left: 16px; z-index: 5;
  color: #fff6; font: 600 12px/1.4 ui-monospace, monospace;
  letter-spacing: 0.05em; background: #0008; padding: 4px 10px;
  border-radius: 999px; text-decoration: none;
`;
document.body.appendChild(sourceLink);

// One line of status over the picture (connecting, waiting for the laptop, a
// pairing confirmation). Above the join overlay (joinScreen.ts, z-index 20) so
// a prompt is readable on either.
const pill = document.createElement("div");
pill.style.cssText = `
  position: fixed; bottom: 56px; left: 50%; transform: translateX(-50%); z-index: 30;
  display: none; max-width: 90%; text-align: center;
  color: #fffe; font: 600 16px/1.4 ui-monospace, monospace;
  letter-spacing: 0.05em; background: #000b; padding: 8px 18px;
  border-radius: 999px;
`;
document.body.appendChild(pill);

// Fetches every pinned asset (src/pinnedAssets.ts — the same registry
// app.ts's own call warms) after load, at idle, so a TV left open across a
// deploy doesn't 404 the first time something it's already holding onto
// (the Dancers clip library, the tempo worklet, a panel font) is needed.
pinEverything();

const PRESET_ORDER: QualityPreset[] = ["floor", "low", "mid", "high"];
const presetAllows = (s: Scene, p: QualityPreset): boolean =>
  !s.minQuality || PRESET_ORDER.indexOf(p) >= PRESET_ORDER.indexOf(s.minQuality);

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
let sceneCtx: SceneContext;
let join: JoinScreen;

const animClock = createAnimClock();
// See renderLatch.ts / app.ts's own instance: turns anim.dtSec into wall
// time since the last *rendered* frame and keeps a one-shot edge alive
// across ticks the render cap skips.
const renderLatch = createRenderLatch();
// See src/render/drives.ts's header. Which source each setting reacts to is
// part of the room's look (the drive choices ride in its storage and are
// re-read by `applyRoomStorage`); with no look yet every setting reads its own
// `drive.default`.
const driveEngine = createDriveEngine();
let lastRafMs = 0;

// Render-rate cap and its jitter-tolerant gate live in framePace.ts (shared
// with app.ts) — see that file for why the gate needs a tolerance at all.
let lastRenderMs = 0;
let governor: QualityGovernor | null = null;

// ---- Room, pairing and look state ----

/** The room connection; null while unpaired. */
let conn: RendererConnection | null = null;
let paired = false;
let roomCode = "";
/** The pairing slot's code and the nonce its QR carries; empty outside `pair`. */
let slotCode = "";
let nonce = "";
let slot: PendingSlot | null = null;
let slotGen = 0;
let slotFailures = 0;
let slotFailed = false;
let rotateTimer: ReturnType<typeof setTimeout> | null = null;
let phase: TvPhase | null = null;

let replica: LookReplica = createLookReplica();
/** The scene / palette of the last look document applied. The look re-asserts
 *  a scene or palette only when the document's differs from this, so a
 *  settings-only patch never fights one a command (the Room panel) set. */
let lastDocScene = "";
let lastDocPalette = "";

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, quality.preset));
}

/** Tells the room what this screen shows, so the roster stays current. */
function announce(): void {
  conn?.sendHello(scene.id, palette.id, viewport);
}

function switchScene(next: Scene): void {
  scene.dispose(sceneCtx);
  scene = next;
  scene.init(sceneCtx);
  announce();
}

async function requestWakeLock(): Promise<void> {
  try {
    await navigator.wakeLock?.request("screen");
  } catch {
    // Not fatal — some browsers/contexts deny it; screen may just dim.
  }
}

// ---- The pill ----

let pillBase: string | null = null;
let pillFlash: string | null = null;
let pillFlashTimer = 0;
let waitingHintTimer = 0;

function renderPill(): void {
  const text = pillFlash ?? pillBase;
  pill.textContent = text ?? "";
  pill.style.display = text ? "block" : "none";
}

/** A message that sits over the phase's own line for a while. */
function flashPill(text: string, ms: number): void {
  pillFlash = text;
  renderPill();
  window.clearTimeout(pillFlashTimer);
  pillFlashTimer = window.setTimeout(() => {
    pillFlash = null;
    renderPill();
  }, ms);
}

function clearFlash(): void {
  window.clearTimeout(pillFlashTimer);
  pillFlash = null;
}

// ---- Phases ----

function phaseLine(p: TvPhase): string | null {
  if (p === "pair") return slotFailed ? SLOT_RETRY_TEXT : null;
  return p === "live" ? null : TV_PHASE_TEXT[p];
}

function setPhase(next: TvPhase): void {
  if (next === phase) return;
  phase = next;
  if (next === "pair") {
    join.show();
    badge.style.display = "none";
  } else {
    join.hide();
    badge.textContent = roomCode;
    badge.style.display = "block";
  }
  pillBase = phaseLine(next);
  // A saved room can outlive the laptop's own, and then this screen would wait
  // for ever with no hint: once the wait has gone on a while, say how to leave.
  window.clearTimeout(waitingHintTimer);
  if (next === "waiting") {
    waitingHintTimer = window.setTimeout(() => {
      if (phase !== "waiting") return;
      pillBase = waitingLine(WAITING_HINT_AFTER_MS);
      renderPill();
    }, WAITING_HINT_AFTER_MS);
  }
  renderPill();
}

// ---- Pairing ----

function stopPairing(): void {
  slotGen++; // an openSlot() still waiting on the network is now stale
  if (rotateTimer !== null) clearTimeout(rotateTimer);
  rotateTimer = null;
  slot?.close();
  slot = null;
  slotCode = "";
  nonce = "";
  slotFailed = false;
}

/** (Re)opens the pairing slot: a fresh throwaway room, a fresh nonce, a fresh
 *  QR. Runs again every TV_SLOT_ROTATE_MS while nobody has scanned, which
 *  bounds how long a photographed QR stays useful. */
async function openSlot(): Promise<void> {
  const gen = ++slotGen;
  if (rotateTimer !== null) clearTimeout(rotateTimer);
  rotateTimer = null;
  slot?.close();
  slot = null;

  let code: string;
  try {
    code = await createRoomCode();
  } catch {
    if (gen !== slotGen) return;
    slotFailed = true;
    pillBase = phaseLine("pair");
    renderPill();
    rotateTimer = setTimeout(() => void openSlot(), reconnectDelayMs(slotFailures++));
    return;
  }
  if (gen !== slotGen) return; // adopted, or superseded, while the request was out
  slotFailures = 0;
  slotFailed = false;
  pillBase = phaseLine("pair");
  renderPill();

  slotCode = code;
  nonce = newKey();
  // The slot's device id is as throwaway as the slot: it never reaches a roster.
  // The nonce rides along so the room delivers the adopt to this socket alone.
  slot = new PendingSlot(code, newKey(), nonce, onAdopt, () => void openSlot());
  join.setCode(code, { nonce });
  rotateTimer = setTimeout(() => void openSlot(), TV_SLOT_ROTATE_MS);
}

function startPairing(): void {
  closeConn();
  forgetTypedRoom(); // a reload must land on the QR, not on the room that was typed
  paired = false;
  roomCode = "";
  setPhase("pair");
  void openSlot();
}

/** Takes `?room=` out of the address bar once the typed room is no longer the
 *  one on screen (other query values stay). */
function forgetTypedRoom(): void {
  const query = new URLSearchParams(location.search);
  if (!query.has("room")) return;
  query.delete("room");
  const rest = query.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

/** A code typed into the join screen named a room that has a key (a laptop's
 *  room always does): a code alone does not get in, and the room says so. Go
 *  back to what the screen was doing before — its saved room, else the QR —
 *  and say why, since the viewer asked for something and nothing happened. */
function typedRoomRefused(): void {
  forgetTypedRoom();
  const saved = readSession("tv", realStorage);
  if (saved) joinRoom(saved.room, saved.key);
  else startPairing();
  flashPill(TYPED_REFUSED_TEXT, TYPED_REFUSED_PILL_MS);
}

/** A phone handed this screen a room. Only an unpaired screen takes one, and
 *  only with the nonce its own QR carries; anything else is somebody else's
 *  request or a replay and is ignored. */
function onAdopt(m: AdoptMessage): void {
  if (phase !== "pair" || nonce === "" || m.n !== nonce) return;
  stopPairing();
  writeSession("tv", { room: m.room, key: m.k, ts: Date.now() }, realStorage);
  joinRoom(m.room, m.k);
  flashPill(`Joined ${m.room}`, JOINED_PILL_MS);
}

/** The viewer asked to pair another phone: forget the room and show the QR. */
function repair(): void {
  clearSession("tv", realStorage);
  clearFlash();
  startPairing();
}

// ---- The room ----

function closeConn(): void {
  conn?.close();
  conn = null;
}

/** Joins `room`. `key` is the room's key from a pairing; null is a room joined
 *  by a typed code alone, which only an unclaimed (key-less) room accepts. */
function joinRoom(room: string, key: string | null): void {
  closeConn();
  paired = true;
  roomCode = room;
  replica = createLookReplica();
  lastDocScene = "";
  lastDocPalette = "";

  const c = new RendererConnection(room, { auth: key ? { roomKey: key } : undefined, reconnect: true });
  conn = c;
  c.onLook(onLook);
  c.onCommand(onCommand);
  c.onState((s) => {
    if (s !== "denied" || conn !== c) return;
    if (key === null) {
      typedRoomRefused();
      return;
    }
    // The room no longer accepts this key (it expired, or the laptop started a
    // new one): the saved session is dead, so pair again.
    clearSession("tv", realStorage);
    startPairing();
  });
  announce();
  setPhase("joining");
}

/** Scene / palette / viewport commands, as before: the Room panel's Mosaic and
 *  Panorama, and Shuffle. A command's scene applies even though the look names
 *  another; the look only speaks again when it changes (see `lastDocScene`). */
function onCommand(cmd: DeviceCommand): void {
  if (cmd.palette) palette = getPalette(cmd.palette);
  if (cmd.viewport) viewport = cmd.viewport;
  const next = cmd.scene ? getScene(cmd.scene) : undefined;
  if (next && presetAllows(next, quality.preset)) switchScene(next);
  else if (cmd.palette || cmd.viewport) announce();
}

function onLook(m: LookServerMsg): void {
  if (m.type === "look") {
    replica.onSnapshot(m.rev, m.doc);
    const doc = replica.doc();
    // An empty room (no look yet) is the defaults, not whatever was left from another room.
    if (doc) applyDoc(doc);
    else applyRoomStorage({}, localStorage);
  } else if (m.type === "lookPatch") {
    const r = replica.onPatch(m.rev, m);
    if (r.status === "applied") applyDoc(r.doc);
    else if (r.status === "gap") conn?.requestLook();
  }
  // lookAck / lookReject answer a controller's own patch; a TV never sends one.
}

/** Makes the page show this look: settings first, so a scene's init() and
 *  first render already see the settings that go with it, then palette, then
 *  scene. The whole storage is applied every time (once per message, and
 *  messages come at the controller's publish cadence, lookSync.ts's
 *  LOOK_PUBLISH_MS), so a store that was edited out of band is re-seeded too. */
function applyDoc(doc: LookDoc): void {
  applyRoomStorage(doc.storage, localStorage);
  let paletteChanged = false;
  if (doc.palette !== lastDocPalette) {
    lastDocPalette = doc.palette;
    // getPalette() falls back to the first palette for an id it doesn't know;
    // a look naming one this build lacks must not repaint the screen.
    if (doc.palette !== "" && getPalette(doc.palette).id === doc.palette && palette.id !== doc.palette) {
      palette = getPalette(doc.palette);
      paletteChanged = true;
    }
  }
  if (doc.scene !== lastDocScene) {
    lastDocScene = doc.scene;
    const next = doc.scene === "" ? undefined : getScene(doc.scene);
    if (next && next !== scene && presetAllows(next, quality.preset)) {
      switchScene(next); // announces the new palette with it
      return;
    }
  }
  if (paletteChanged) announce();
}

async function main(): Promise<void> {
  let gl: WebGL2RenderingContext;
  try {
    gl = createGL(canvas);
  } catch (err) {
    console.error(err);
    badge.textContent = "WebGL2 unsupported on this TV";
    badge.style.display = "block";
    return;
  }

  quality = qualitySettings(await detectQuality());
  sceneCtx = { gl, quality };
  if (!presetAllows(scene, quality.preset)) scene = availableScenes()[0] ?? scene;
  governor = createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  scene.init(sceneCtx);

  // The join screen's typed-code field (`{ tv: true }`: one plain Join) reloads
  // this page with `?room=CODE`. The QR and its big code are the TV's own
  // pairing slot's, so they are what the field is a fallback for.
  join = createJoinScreen("adopt", document.body, { tv: true });

  if (import.meta.env.DEV) {
    // Headless runs complete an adoption without decoding the QR: read the
    // slot and nonce from here, then POST /api/room/<slot>/adopt. Getters, so
    // a rotated slot is seen. A prod build drops this block (the DEV literal).
    const debug: { readonly slot: string; readonly nonce: string; readonly phase: TvPhase | null } = {
      get slot() {
        return slotCode;
      },
      get nonce() {
        return nonce;
      },
      get phase() {
        return phase;
      },
    };
    (window as unknown as { __tvPairing: typeof debug }).__tvPairing = debug;
  }

  // The scene is up before any connection exists, so the room's first `look`
  // (pushed the moment the socket opens) is never dropped for lack of a scene
  // to apply it to — output.ts has the same constraint.
  // A code typed into the join screen (`?room=CODE`, see `typedRoomRefused`)
  // is an explicit ask, so it comes before the saved room.
  const saved = readSession("tv", realStorage);
  const typed = roomCodeFromParam(new URLSearchParams(location.search).get("room"));
  if (typed) joinRoom(typed, saved && saved.room === typed ? saved.key : null);
  else if (saved) joinRoom(saved.room, saved.key);
  else startPairing();

  // A second OK press within REPAIR_WINDOW_MS of the first forgets the room
  // and shows the QR again. Deliberate friction: someone who photographed the
  // QR earlier must not be able to take over a screen that is already in use.
  let repairUntil = 0;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.key !== "Enter" && e.keyCode !== 13) || e.repeat || !paired) return;
    const now = performance.now();
    if (now < repairUntil) {
      repairUntil = 0;
      repair();
      return;
    }
    repairUntil = now + REPAIR_WINDOW_MS;
    flashPill(REPAIR_PROMPT, REPAIR_WINDOW_MS);
  });

  void requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void requestWakeLock();
  });

  lastRafMs = performance.now();

  function loop(): void {
    requestAnimationFrame(loop);

    const nowRafMs = performance.now();
    const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
    lastRafMs = nowRafMs;

    const c = conn;
    const s = c ? c.sample() : null;
    const connected = c !== null && c.state === "open";
    const freshFrames = c !== null && s !== null && c.msSinceLastFrame < STALE_TIMEOUT_MS;
    setPhase(tvPhase({ paired, connected, freshFrames }));

    if (phase !== "live" || !s) return;

    const frame: FeatureFrame = {
      time: s.timeSec,
      bands: s.bands,
      energy: s.energy,
      onset: s.onsetFired,
      pulseOnset: s.pulseFired,
      bpm: s.bpm,
      onsetPhase: s.beatPhase,
      level: s.level,
    };

    // The same per-tick chain as app.ts's loop() and drawScene(), minus what
    // needs a local extractor or a panel. The host sends ungained frames, so
    // the Bands card's faders (part of the look) are applied here. Smoothing is
    // resolved exactly once per tick — resolveSmoothing() slews its auto value.
    // The silence gate's marks are this device's own (volatile, not in the
    // look), and there is no `beatRatio` — a paired TV never runs a local
    // broadband FeatureExtractor — so a graded broadband beatPulse falls back
    // to the loudest of this device's own band ratios (src/audio/hitStrength.ts
    // has the story), and no `wavePeak` either. Beat grid and a setting's own
    // drawn line are drive choices (src/render/drives.ts), carried by the look.
    const gained = applyBandGains(frame, getBandGains(scene.id));
    const smoothing = resolveSmoothing(scene.id);
    // Only the GPU draw is rate-capped — sampling and the anim clock's decay
    // stay on every rAF tick.
    const anim = animClock.advance(dtSec, gained, smoothing, getSilenceGate(), { shape: getHitShape() });
    advanceAutoTune(dtSec, anim.profile);
    renderLatch.accumulate(anim);
    const sensitivity = resolveSensitivity(scene.id);
    const expansion = resolveExpansion(scene.id);
    driveEngine.accumulate(dtSec, gained, applySensitivity(gained, sensitivity, expansion).energy, anim, scene.id, scene.settings ?? []);

    if (!shouldRenderFrame(nowRafMs, lastRenderMs, targetFrameIntervalMs(quality.preset))) return;
    lastRenderMs = nowRafMs;

    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    const displayFrame = applySensitivity(gained, sensitivity, expansion);
    const latchedAnim = renderLatch.consume(anim, nowRafMs);
    const drives = driveEngine.forScene(scene.id, scene.settings ?? [], latchedAnim);
    scene.render(sceneCtx, displayFrame, viewport, palette, latchedAnim, drives);
    governor?.recordFrame(nowRafMs);
  }

  requestAnimationFrame(loop);
}

void main();
