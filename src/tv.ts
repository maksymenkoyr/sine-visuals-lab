// Must stay the first import: installs the TV's room-look storage overlay
// before any store module seeds its cache from localStorage (net/roomStorage.ts).
import "./net/tvStorageBoot.ts";
import "./render/scenes/index.ts"; // side-effect: registers built-in scenes
import { createGL, resizeCanvasToDisplaySize, watchContextLoss } from "./render/gl.ts";
import { detectQuality, presetAllows, qualitySettings, type QualityPreset, type QualitySettings } from "./render/quality.ts";
import type { QualityChoice } from "./render/qualityPref.ts";
import { getScene, listScenes, FULL_VIEWPORT, type Scene, type SceneContext, type Viewport } from "./render/scene.ts";
import { getPalette, type Palette } from "./render/palette.ts";
import { createAnimClock } from "./render/animClock.ts";
import { createRenderLatch } from "./render/renderLatch.ts";
import { advanceAutoTune, resolveExpansion, resolveSensitivity, resolveSmoothing } from "./render/autoTune.ts";
import { createQualityGovernor, type QualityGovernor } from "./render/governor.ts";
import { createCompositor, type Compositor } from "./render/compositor.ts";
import { nextRenderAnchor, shouldRenderFrame, targetFrameIntervalMs } from "./render/framePace.ts";
import { createRoomCode, RendererConnection } from "./net/room.ts";
import { roomCodeFromParam } from "./net/roomCode.ts";
import { createJoinScreen, type JoinScreen } from "./ui/joinScreen.ts";
import { SOURCE_URL } from "./brand.ts";
import { BUILD_INFO, versionHint, versionLabel } from "./version.ts";
import { pinEverything } from "./pinnedAssets.ts";
import { requestWakeLock } from "./ui/wakeLock.ts";
import { getSilenceGate } from "./audio/silenceGate.ts";
import { getHitShape } from "./audio/hitStrength.ts";
import { applyBandGains, getBandGains } from "./audio/bandGains.ts";
import { applySensitivity } from "./audio/sensitivity.ts";
import type { FeatureFrame } from "./audio/types.ts";
import { createDriveEngine } from "./render/drives.ts";
import { realStorage } from "./net/realStorage.ts";
import { applyRoomStorage } from "./net/syncedStores.ts";
import { createLookReplica, type LookReplica } from "./net/lookSync.ts";
import { createGlide, type Glide } from "./net/outputGlide.ts";
import { DEFAULT_OUTPUT_PARAMS } from "./net/outputSync.ts";
import { newKey, TV_SLOT_ROTATE_MS } from "./net/pairing.ts";
import { clearSession, readSession, writeSession } from "./net/sessions.ts";
import { PendingSlot } from "./net/pendingSlot.ts";
import { reconnectDelayMs } from "./net/reconnect.ts";
import { hostInRoster, tvPhase, waitingLine, TV_PHASE_TEXT, type HostInRoom, type TvPhase } from "./net/tvPhase.ts";
import type { AdoptMessage } from "./net/roomMessages.ts";
import type { LookDoc, LookServerMsg } from "../server/lookDoc.ts";

/**
 * The paired display entry (tv.html). A renderer in the room's mould: the
 * device it follows (the laptop by default; any device the room's Room view
 * puts on its own input) streams feature frames, any device's Play sets the
 * room's look document (Main, net/mainPlay.ts), and this page draws what they
 * say — it has no panel and no audio of its own, so it always follows. Its one
 * choice is its screen in the Room view: `main` shows Main; `own` freezes the
 * picture on what it shows now and ignores the room's looks (the replica keeps
 * following them, so switching back to `main` shows the current Main at once).
 *
 * The page is in one phase at a time (net/tvPhase.ts) and `setPhase` is the one
 * place that decides what is drawn over the picture. Unpaired, it shows the
 * pairing QR: it holds a throwaway slot room (net/pendingSlot.ts), and a phone
 * that scans the QR hands it a room to join (`onAdopt`). Once paired it keeps
 * its room and key (net/sessions.ts) so a reload or a power cycle rejoins
 * without anyone scanning again, and the QR never comes back unless the viewer
 * asks: the Reset button (`resetBtn`), which has the remote's focus whenever
 * the room shows nothing so one OK press does it, or OK pressed twice while
 * the picture is live. The nonce in the QR, not anything the server holds, is
 * what proves an adoption was meant for this screen: the slot socket presents
 * it when it joins, so the room hands the adopt (which carries the room key)
 * to that socket and not to anyone else who sat down in the slot. A laptop
 * can also adopt this screen by typing its code, with no nonce; the room
 * delivers that only while this is the one screen waiting in the slot.
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
 * its own anim clock on its feed's frames, rather than being sent resolved
 * values; its Auto readouts are therefore its own. A patch that carries
 * `glideMs` (a Play held down on any device) is walked to over that long
 * (`startGlide`, net/outputGlide.ts) instead of applied at once; the three
 * resolved dials above are the TV's own, so they are not part of that walk.
 * What does not travel:
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
/** How long the room may show nothing before Reset grows and takes the
 *  remote's focus: a normal join, or the laptop's first frames, never flashes
 *  it up; a dead room offers it almost at once. */
const RESET_PROMPT_AFTER_MS = 1500;
const REPAIR_PROMPT = "Press OK again to reset and show the pairing code";
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

// Forgets the room and brings the pairing QR back (`repair`). Once the room has
// shown nothing for RESET_PROMPT_AFTER_MS (joining, waiting) it sits big under
// the pill and holds the focus, so a remote's single OK press is enough and a
// pointer remote can click it; otherwise it is a dim corner link, out of focus,
// so a stray OK doesn't drop a working screen (two presses still do, below).
const resetBtn = document.createElement("button");
resetBtn.type = "button";
const RESET_BIG_STYLE = `
  position: fixed; bottom: 110px; left: 50%; transform: translateX(-50%); z-index: 31;
  color: #000; background: #fff; border: 0; cursor: pointer;
  font: 600 18px/1.4 system-ui, sans-serif; padding: 10px 22px; border-radius: 999px;
`;
const RESET_CORNER_STYLE = `
  position: fixed; bottom: 16px; right: 16px; z-index: 5;
  color: #fff6; background: #0008; border: 0; cursor: pointer;
  font: 600 12px/1.4 ui-monospace, monospace; letter-spacing: 0.05em;
  padding: 4px 10px; border-radius: 999px;
`;
resetBtn.style.display = "none";
// No :focus rule in an inline style, and a TV remote moves focus, not a cursor.
resetBtn.addEventListener("focus", () => (resetBtn.style.outline = "3px solid #8be9a8"));
resetBtn.addEventListener("blur", () => (resetBtn.style.outline = "none"));
resetBtn.addEventListener("click", () => repair());
document.body.appendChild(resetBtn);

function showResetBtn(how: "big" | "corner" | "hidden"): void {
  if (how === "hidden") {
    resetBtn.style.display = "none";
    resetBtn.blur();
    return;
  }
  const focused = document.activeElement === resetBtn;
  resetBtn.style.cssText = how === "big" ? RESET_BIG_STYLE : RESET_CORNER_STYLE;
  resetBtn.style.outline = focused && how === "big" ? "3px solid #8be9a8" : "none";
  resetBtn.textContent = how === "big" ? "Reset: show the pairing code" : "Reset";
  if (how === "big") resetBtn.focus({ preventScroll: true });
  else resetBtn.blur();
}

// Fetches every pinned asset (src/pinnedAssets.ts — the same registry
// app.ts's own call warms) after load, at idle, so a TV left open across a
// deploy doesn't 404 the first time something it's already holding onto
// (the Dancers clip library, the tempo worklet, a panel font) is needed.
pinEverything();

let scene: Scene = getScene("spectrum")!;
let palette: Palette = getPalette("neon");
let viewport: Viewport = FULL_VIEWPORT;
let quality: QualitySettings = qualitySettings("mid");
/** What detectQuality() found on this TV: what an `auto` choice renders at,
 *  and what the hello tells the Room view. Null until the benchmark is done. */
let detectedPreset: QualityPreset | null = null;
/** The room's Quality choice for this screen (server/roomDevices.ts
 *  `quality`): a TV page has no panel, so the Room view sets it. `auto` until
 *  a roster says otherwise, which is how a TV rendered before the choice. */
let qualityChoice: QualityChoice = "auto";
let sceneCtx: SceneContext;
/** Draws every frame (render/compositor.ts): here only to crossfade a scene
 *  change (the held effects are the laptop's and pop-out's, not a TV's). */
let compositor: Compositor | null = null;
let join: JoinScreen;

/** True from the canvas's `webglcontextlost` until the page reloads on the
 *  restore (main()'s watchContextLoss): the loop draws nothing meanwhile. */
let glLost = false;
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
/** Whether the room's last roster listed the laptop; null until this socket
 *  has had one (the `waiting` line, net/tvPhase.ts). */
let hostInRoom: HostInRoom = null;

let replica: LookReplica = createLookReplica();
/** This screen's record in the room says `own` (server/roomDevices.ts): it
 *  keeps showing what it shows and ignores the room's looks, though the replica
 *  still follows them so a later switch back to `main` is current. */
let screenOwn = false;
/** This socket has had a roster that lists this screen. A keyed room sends the
 *  look before the roster, so until then it is not known whether to show it. */
let screenKnown = false;
/** A snapshot arrived while the screen was not following Main, so it has not
 *  been shown (an empty one included: it means "the defaults"). */
let lookHeld = false;
/** The scene / palette of the last look document applied. The look re-asserts
 *  a scene or palette only when the document's differs from this, so a
 *  settings-only patch never fights one a command set. */
let lastDocScene = "";
let lastDocPalette = "";
/** The look on screen, a glide's half-way step included: what the next glide
 *  starts from. Null until the room has sent one. */
let shown: LookDoc | null = null;
/** A smooth arrival in progress: the laptop's Play held down sends a look with
 *  `glideMs` (net/roomBridge.ts), and the settings walk there over that long
 *  (net/outputGlide.ts says which move and which wait for the end). Any other
 *  look message ends it by jumping straight to what it says. */
let glide: Glide | null = null;
/** The look the running glide arrives at, applied whole when it lands. */
let glideTarget: LookDoc | null = null;

function availableScenes(): Scene[] {
  return listScenes().filter((s) => presetAllows(s, quality.preset));
}

/** Tells the room what this screen shows, so the roster stays current, and
 *  what its own benchmark picks, so the Room view can say what Auto means here. */
function announce(): void {
  conn?.sendHello(scene.id, palette.id, viewport, detectedPreset ?? undefined);
}

function resolvePreset(): QualityPreset {
  return qualityChoice === "auto" ? (detectedPreset ?? quality.preset) : qualityChoice;
}

/** The roster's Quality for this screen. When the preset it resolves to moves,
 *  `quality` is changed in place (the scene context and the governor hold it),
 *  the governor starts again from the new baseline, and the scene is mounted
 *  again, since geometry is sized at init. A scene whose `minQuality` is above
 *  the new preset keeps running as it was mounted, as the pop-out output does
 *  (output.ts's applyQuality); scenes the look picks from then on must allow
 *  the preset. Before the GL context is up only the choice is kept: main()
 *  resolves it when it builds `quality`. */
function onQualityChoice(choice: QualityChoice | undefined): void {
  if (choice === undefined) return;
  qualityChoice = choice;
  if (!governor) return;
  const preset = resolvePreset();
  if (preset === quality.preset) return;
  Object.assign(quality, qualitySettings(preset));
  governor = createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  if (presetAllows(scene, quality.preset)) switchScene(scene);
}

/** Swaps the running scene for `next`. If `next`'s init() throws (a shader
 *  this TV's GPU won't compile) the scene it replaced is brought back, rather
 *  than leaving a half-built one whose render() throws every frame. With
 *  `crossfade` the replaced scene stays up under the new one until the
 *  compositor's blend is done (render/crossfade.ts: one bar from the next
 *  beat, a cut on the floor preset); the room's look carries no glide length
 *  for a scene change, so a TV always takes the one-bar default. */
function switchScene(next: Scene, crossfade = false): void {
  const prev = scene;
  // A crossfade still running ends here, its outgoing scene dropped at once.
  compositor?.cancel();
  const fade = crossfade && prev !== next;
  if (!fade) prev.dispose(sceneCtx);
  try {
    next.init(sceneCtx);
    scene = next;
    if (fade) compositor?.begin(prev, { cut: quality.preset === "floor" });
  } catch (err) {
    console.error(`TV: "${next.name}" failed to start:`, err);
    try {
      next.dispose(sceneCtx);
    } catch {
      // Whatever init() half-built; the original error is the one to report.
    }
    if (!fade) {
      try {
        prev.init(sceneCtx);
      } catch (err2) {
        console.error(`TV: "${prev.name}" failed to restart:`, err2);
      }
    }
  }
  announce();
}

/** Boot mount: the current scene, else the first of availableScenes() whose
 *  init() succeeds (a shader this TV's GPU won't compile must not leave the
 *  screen blank before the room badge ever appears). False if none mounts. */
function mountFirstScene(): boolean {
  const candidates = [scene, ...availableScenes().filter((s) => s !== scene)];
  for (const next of candidates) {
    try {
      next.init(sceneCtx);
      scene = next;
      return true;
    } catch (err) {
      console.error(`TV: "${next.name}" failed to start:`, err);
      try {
        next.dispose(sceneCtx);
      } catch {
        // Whatever init() half-built; the original error is the one to report.
      }
    }
  }
  return false;
}

// ---- The pill ----

let pillBase: string | null = null;
let pillFlash: string | null = null;
let pillFlashTimer = 0;
let resetPromptTimer = 0;

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
  if (p === "waiting") return waitingLine(hostInRoom);
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
    // "room", so nobody takes it for a pairing code: typed on a laptop, a
    // room's code finds no screen waiting (only the QR screen's code does).
    badge.textContent = `room ${roomCode}`;
    badge.style.display = "block";
  }
  window.clearTimeout(resetPromptTimer);
  showResetBtn(next === "pair" ? "hidden" : "corner");
  if (next === "joining" || next === "waiting") {
    resetPromptTimer = window.setTimeout(() => {
      if (phase === "joining" || phase === "waiting") showResetBtn("big");
    }, RESET_PROMPT_AFTER_MS);
  }
  pillBase = phaseLine(next);
  renderPill();
}

/** The roster changed: the `waiting` line says whether the laptop is there. */
function onRoster(roster: ReadonlyArray<{ role: string }>): void {
  hostInRoom = hostInRoster(roster);
  if (phase !== "waiting") return;
  pillBase = phaseLine("waiting");
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
 *  only with the nonce its own QR carries (a laptop's adopt by typed code
 *  carries none, see roomCore `adopt`); a wrong nonce is somebody else's
 *  request or a replay and is ignored. */
function onAdopt(m: AdoptMessage): void {
  if (phase !== "pair" || nonce === "" || (m.n !== undefined && m.n !== nonce)) return;
  stopPairing();
  writeSession("tv", { room: m.room, key: m.k, ts: Date.now() }, realStorage);
  joinRoom(m.room, m.k);
  flashPill(`Joined ${m.room}`, JOINED_PILL_MS);
}

/** The viewer asked to start over (Reset, or OK twice): forget the room and show the QR. */
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
  shown = null;
  glide = null;
  glideTarget = null;
  hostInRoom = null;
  screenOwn = false;
  // A room joined by a typed code has no records, so no screen choice to wait for.
  screenKnown = key === null;
  lookHeld = false;

  const c = new RendererConnection(room, {
    auth: key ? { roomKey: key } : undefined,
    reconnect: true,
    device: { kind: "tv", hasMic: false, name: "TV" },
  });
  conn = c;
  c.onLook(onLook);
  c.onRosterChange((r) => {
    if (conn !== c) return;
    onRoster(r);
    onScreenChoice(c.self?.screen);
    onQualityChoice(c.self?.quality);
  });
  c.onState((s) => {
    if (conn !== c) return;
    // A new socket has had no roster yet; the last one's is not news.
    if (s !== "open") hostInRoom = null;
    if (s !== "denied") return;
    if (key === null) {
      typedRoomRefused();
      return;
    }
    // The room no longer accepts this key (it expired, or the laptop's Reset
    // ended it): the saved session is dead, so pair again.
    clearSession("tv", realStorage);
    startPairing();
  });
  announce();
  setPhase("joining");
}

/** True while this screen shows the room's Main: its record says `main` (or
 *  `off`, which only silences it) and the roster has said so. */
function followsMain(): boolean {
  return screenKnown && !screenOwn;
}

/** The roster's word for this screen. Switching to `own` freezes the picture
 *  where it is (a glide in flight stops); switching back to `main`, or the first
 *  roster of a socket that held a look back, shows the replica's document. */
function onScreenChoice(screen: string | undefined): void {
  const wasShowing = followsMain();
  screenOwn = screen === "own";
  if (screen !== undefined) screenKnown = true;
  if (screenOwn) {
    glide = null;
    glideTarget = null;
    return;
  }
  if (wasShowing || !screenKnown) return;
  glide = null;
  glideTarget = null;
  const doc = replica.doc();
  if (doc) applyDoc(doc);
  else if (lookHeld) applyRoomStorage({}, localStorage);
  lookHeld = false;
}

function onLook(m: LookServerMsg): void {
  if (m.type === "look") {
    replica.onSnapshot(m.rev, m.doc);
    // A screen on its own look (or one not yet told its choice) only keeps the
    // replica current: onScreenChoice shows it when the screen follows Main.
    if (!followsMain()) {
      lookHeld = true;
      return;
    }
    glide = null;
    glideTarget = null;
    const doc = replica.doc();
    // An empty room (no look yet) is the defaults, not whatever was left from another room.
    if (doc) applyDoc(doc);
    else applyRoomStorage({}, localStorage);
  } else if (m.type === "lookPatch") {
    const r = replica.onPatch(m.rev, m);
    if (r.status === "applied") {
      if (!followsMain()) return;
      if (!startGlide(r.doc, m.glideMs)) {
        glide = null;
        glideTarget = null;
        applyDoc(r.doc);
      }
    } else if (r.status === "gap") conn?.requestLook();
  }
  // lookAck / lookReject answer a controller's own patch; a TV never sends one.
}

/** Starts walking to `doc` over `ms` when the look allows it: the same scene
 *  on screen, and a setting that is safe to move and does differ. False means
 *  switch at once. */
function startGlide(doc: LookDoc, ms: number | undefined): boolean {
  if (typeof ms !== "number" || !(ms > 0) || shown === null) return false;
  const from = { scene: scene.id, palette: palette.id, storage: shown.storage, params: DEFAULT_OUTPUT_PARAMS };
  const to = { scene: doc.scene === "" ? scene.id : doc.scene, palette: doc.palette, storage: doc.storage, params: DEFAULT_OUTPUT_PARAMS };
  const started = createGlide(from, to, scene.settings ?? [], performance.now(), ms);
  if (!started) return false;
  glide = started;
  glideTarget = doc;
  return true;
}

/** One step of a glide: stores only. The scene and palette stay as they were
 *  until the glide lands through applyDoc(). */
function stepGlide(nowMs: number): void {
  if (!glide || !glideTarget) return;
  const { state, done } = glide.lookAt(nowMs);
  if (done) {
    const target = glideTarget;
    glide = null;
    glideTarget = null;
    applyDoc(target);
    return;
  }
  shown = { scene: state.scene, palette: state.palette, storage: state.storage };
  applyRoomStorage(state.storage, localStorage);
}

/** Makes the page show this look: settings first, so a scene's init() and
 *  first render already see the settings that go with it, then palette, then
 *  scene. The whole storage is applied every time (once per message, and
 *  messages come once per Play), so a store that was edited out of band is
 *  re-seeded too. */
function applyDoc(doc: LookDoc): void {
  shown = doc;
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
      // Only a picture that is up crossfades; a TV still waiting for its frames just switches.
      switchScene(next, phase === "live"); // announces the new palette with it
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

  // See gl.ts's watchContextLoss(): a restored context means every scene's GL
  // objects are dead, so the page reloads. A paired TV reads its saved room
  // and key back (net/sessions.ts), a typed-code one still has `?room=` in the
  // address, and an unpaired one gets a fresh QR; none needs the old code put
  // back, so the phone stays connected.
  watchContextLoss(
    canvas,
    () => {
      glLost = true;
    },
    () => location.reload(),
  );

  detectedPreset = await detectQuality();
  quality = qualitySettings(resolvePreset());
  sceneCtx = { gl, quality };
  if (!presetAllows(scene, quality.preset)) scene = availableScenes()[0] ?? scene;
  governor = createQualityGovernor(quality, targetFrameIntervalMs(quality.preset));
  compositor = createCompositor(gl, {
    onOutgoingDone: (outgoing) => {
      try {
        outgoing.dispose(sceneCtx);
      } catch {
        // A crossfade's old scene failing to let go must not stop the new one.
      }
    },
  });
  if (!mountFirstScene()) {
    badge.textContent = "No scene can run on this TV's GPU";
    badge.style.display = "block";
    return;
  }

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
    // e2e read probe (DEV only): what the TV shows and whether frames flow.
    (window as unknown as { __tv: unknown }).__tv = {
      get scene() {
        return scene.id;
      },
      get palette() {
        return palette.id;
      },
      /** The preset this TV renders at, and what its benchmark picked. */
      get quality() {
        return { preset: quality.preset, detected: detectedPreset, choice: qualityChoice };
      },
      get msSinceLastFrame() {
        return conn ? conn.msSinceLastFrame : Infinity;
      },
    };
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
  // OK on the focused Reset button is the button's own click, not a first press.
  let repairUntil = 0;
  document.addEventListener("keydown", (e: KeyboardEvent) => {
    if ((e.key !== "Enter" && e.keyCode !== 13) || e.repeat || !paired || e.target === resetBtn) return;
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
    if (glLost) return;

    const nowRafMs = performance.now();
    const dtSec = Math.max(1e-4, (nowRafMs - lastRafMs) / 1000);
    lastRafMs = nowRafMs;

    stepGlide(nowRafMs);

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
    // needs a local extractor or a panel. A feed sends ungained frames, so
    // the Bands card's faders (part of the look) are applied here. Smoothing is
    // resolved once per tick, as app.ts's tick() does.
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

    const intervalMs = targetFrameIntervalMs(quality.preset);
    if (!shouldRenderFrame(nowRafMs, lastRenderMs, intervalMs)) return;
    lastRenderMs = nextRenderAnchor(nowRafMs, lastRenderMs, intervalMs);

    const resized = resizeCanvasToDisplaySize(canvas, quality.renderScale);
    if (resized) gl.viewport(0, 0, canvas.width, canvas.height);

    const displayFrame = applySensitivity(gained, sensitivity, expansion);
    const latchedAnim = renderLatch.consume(anim, nowRafMs);
    const drives = driveEngine.forScene(scene.id, scene.settings ?? [], latchedAnim);
    const outcome = compositor!.render({
      ctx: sceneCtx,
      scene,
      frame: displayFrame,
      viewport,
      palette,
      anim: latchedAnim,
      drives,
      drivesFor: (s) => driveEngine.forScene(s.id, s.settings ?? [], latchedAnim),
      nowMs: nowRafMs,
    });
    // Two scenes at once (a crossfade) say nothing about what one costs.
    if (outcome.governable) governor?.recordFrame(nowRafMs);
  }

  requestAnimationFrame(loop);
}

void main();
