#!/usr/bin/env node
// Records the same music twice at once — straight from a Chrome tab share
// and through this machine's real microphone — so the gap between the two
// inputs can be measured (tools/mic-gap-analyze.ts reads what this writes).
//
//   node tools/mic-gap.mjs [--out <dir>] [--volumes 50,80] [--seconds 60]
//        [--tracks <id,id,…>] [--noise 20] [--mic <device label part>]
//        [--songs <dir>] [--noise-audio <wav> [--noise-level <0..1>]]
//
// `--volumes ""` records the room noise only.
//
// Needs the laptop left alone in a quiet room: the music plays out of its
// own speakers at each of `--volumes` (macOS output volume, restored after).
//
// How: a local server serves two pages to the installed Google Chrome (not
// Playwright's Chromium — macOS grants mic access per app, and the user's
// Chrome already has it). The player tab plays a song from `--songs`
// (promo-songs by default); the recorder tab calls getDisplayMedia, which
// --auto-select-tab-capture-source-by-title answers with the player tab, and
// getUserMedia for the mic with the same three processing flags off that
// src/audio/capture.ts uses. Both streams go into ONE AudioContext and one
// AudioWorklet, so tab and mic samples share a clock and the measured delay
// between them is exact to a sample. --use-fake-ui-for-media-stream is NOT
// passed: with it Chrome skips the share picker and grabs the whole screen,
// ignoring the by-title flag; the mic is granted by context permission
// instead. Tab capture keeps the tab audible (suppressLocalAudioPlayback
// stays false), which is what lets the mic hear it.
//
// `--noise-audio` loops a file on a third tab, at `--noise-level` of its own
// volume, for the whole run. That tab's title doesn't match the by-title flag,
// so only the player tab is shared: the tab leg stays the music alone, while
// the mic hears the music and the noise together.
//
// Output: <out>/<segment>.tab.wav and .mic.wav (mono s16 at 48 kHz, the
// format tests/tempoEval/recordings.ts reads), and <out>/session.json with
// each segment's song, start offset, volume and the tracks' settings.
import { createServer } from "node:http";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const SR = 48000;
const mainRoot = resolve(execSync("git rev-parse --path-format=absolute --git-common-dir", { encoding: "utf8" }).trim(), "..");
const songsDir = resolve(opt("--songs", join(mainRoot, "tools/.cache/promo-songs")));
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const outDir = resolve(opt("--out", join(mainRoot, "tools/.cache/mic-gap", stamp)));
const volumes = opt("--volumes", "50,80").split(",").filter(Boolean).map(Number);
const seconds = +opt("--seconds", "60");
const noiseSec = +opt("--noise", "20");
const micLabel = opt("--mic", "");
const noiseArg = opt("--noise-audio", null);
const noiseAudio = noiseArg === null ? null : resolve(noiseArg);
const noiseLevel = +opt("--noise-level", "0.5");
if (noiseAudio && !existsSync(noiseAudio)) throw new Error(`--noise-audio: no file at ${noiseAudio}`);
if (!(noiseLevel >= 0 && noiseLevel <= 1)) throw new Error("--noise-level must be between 0 and 1");
// One per tempo region the tracker has to cover (86 to 175 BPM).
const trackIds = opt("--tracks", "ium1_38q9UY,sc1688273,LPRsMPmwMf8,LAxCqlU-OAo,E_YGLT8G_00").split(",").filter(Boolean);
mkdirSync(outDir, { recursive: true });

const PLAYER_TITLE = "MicGap Player";

// A log sine sweep, for the speaker+room+mic response without music's own
// spectrum in the way. Written beside the output so the analysis can use it.
function writeSweep(path) {
  const dur = 8;
  const f0 = 30;
  const f1 = 16000;
  const n = dur * SR;
  const k = Math.log(f1 / f0);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const fade = Math.min(1, t / 0.05, (dur - t) / 0.05);
    const v = 0.5 * fade * Math.sin(((2 * Math.PI * f0 * dur) / k) * (Math.exp((t / dur) * k) - 1));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  writeFileSync(path, Buffer.concat([wavHeader(n), pcm]));
}

function wavHeader(samples) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + samples * 2, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(samples * 2, 40);
  return h;
}

const PLAYER_HTML = `<!doctype html><title>${PLAYER_TITLE}</title><audio id=a></audio><script>
window.playAt = async (url, start) => { const a = document.getElementById('a'); a.src = url; a.volume = 1;
  await new Promise(r => a.addEventListener('loadedmetadata', r, { once: true })); a.currentTime = start; await a.play(); };
window.stopPlay = () => { const a = document.getElementById('a'); a.pause(); a.removeAttribute('src'); a.load(); };
</script>`;

// The title must not contain PLAYER_TITLE, or the by-title flag would pick this tab.
const NOISE_TITLE = "MicGap Noise";
const NOISE_HTML = `<!doctype html><title>${NOISE_TITLE}</title><audio id=a loop></audio><script>
window.playNoise = async (url, level) => { const a = document.getElementById('a'); a.src = url; a.volume = level; await a.play(); };
window.stopNoise = () => { const a = document.getElementById('a'); a.pause(); a.removeAttribute('src'); a.load(); };
</script>`;

// The worklet hands every render quantum's two inputs (tab, mic) to the page
// as mono; a stereo tab is averaged, like the app's analysers downmix it.
const TAP_JS = `class Tap extends AudioWorkletProcessor {
  process(inputs) {
    const mono = (inp) => { const out = new Float32Array(128); if (!inp || !inp.length) return out;
      for (const ch of inp) for (let i = 0; i < 128; i++) out[i] += ch[i] / inp.length; return out; };
    this.port.postMessage([mono(inputs[0]), mono(inputs[1])]);
    return true;
  }
}
registerProcessor('tap', Tap);`;

const RECORDER_HTML = `<!doctype html><title>MicGap Recorder</title><button id=go>start</button><script>
let tab = [], mic = [];
window.startCapture = async (micLabel) => {
  const off = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: { ...off, suppressLocalAudioPlayback: false }, selfBrowserSurface: 'exclude', preferCurrentTab: false });
  let micStream = await navigator.mediaDevices.getUserMedia({ audio: off });
  if (micLabel) {
    const dev = (await navigator.mediaDevices.enumerateDevices()).find(d => d.kind === 'audioinput' && d.label.includes(micLabel));
    if (dev) { micStream.getTracks().forEach(t => t.stop()); micStream = await navigator.mediaDevices.getUserMedia({ audio: { ...off, deviceId: { exact: dev.deviceId } } }); }
  }
  const ctx = new AudioContext({ sampleRate: ${SR}, latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([${JSON.stringify(TAP_JS)}], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 2, numberOfOutputs: 1 });
  node.port.onmessage = (e) => { tab.push(e.data[0]); mic.push(e.data[1]); };
  ctx.createMediaStreamSource(display).connect(node, 0, 0);
  ctx.createMediaStreamSource(micStream).connect(node, 0, 1);
  const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute).connect(ctx.destination);
  await ctx.resume();
  window.__tracks = { display: display.getAudioTracks().map(t => ({ label: t.label, settings: t.getSettings(), state: t.readyState })),
    mic: micStream.getAudioTracks().map(t => ({ label: t.label, settings: t.getSettings() })),
    ctx: { sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency } };
  window.__micTrack = micStream.getAudioTracks()[0];
  return window.__tracks;
};
window.resetBuffers = () => { tab = []; mic = []; };
window.micStats = () => { const s = window.__micTrack && window.__micTrack.stats; return s ? { totalFrames: s.totalFrames, deliveredFrames: s.deliveredFrames, ...(s.toJSON ? s.toJSON() : {}) } : null; };
// Drains what's buffered as base64 little-endian s16 for each input.
window.drain = () => {
  const pack = (blocks) => { const n = blocks.length * 128; const b = new Int16Array(n);
    let o = 0; for (const blk of blocks) for (let i = 0; i < 128; i++) b[o++] = Math.max(-32768, Math.min(32767, Math.round(blk[i] * 32767)));
    let s = ''; const u = new Uint8Array(b.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s); };
  const out = { tab: pack(tab), mic: pack(mic) }; tab = []; mic = []; return out;
};
</script>`;

const sweepPath = join(outDir, "sweep.src.wav");
writeSweep(sweepPath);

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/player.html") return res.end(PLAYER_HTML);
  if (url.pathname === "/recorder.html") return res.end(RECORDER_HTML);
  if (url.pathname === "/noise.html") return res.end(NOISE_HTML);
  const file =
    url.pathname === "/sweep.wav" ? sweepPath : url.pathname === "/noise.wav" ? noiseAudio : join(songsDir, url.pathname.replace(/^\/song\//, ""));
  if (!file || !existsSync(file)) return res.writeHead(404).end();
  // Range support, so the player can seek.
  const size = statSync(file).size;
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    const a = +m[1];
    const b = m[2] ? +m[2] : size - 1;
    res.writeHead(206, { "Content-Type": "audio/wav", "Content-Range": `bytes ${a}-${b}/${size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1 });
    return createReadStream(file, { start: a, end: b }).pipe(res);
  }
  res.writeHead(200, { "Content-Type": "audio/wav", "Accept-Ranges": "bytes", "Content-Length": size });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://localhost:${server.address().port}`;

const setVolume = (v) => execFileSync("osascript", ["-e", `set volume output volume ${v}`]);
const startVolume = +execFileSync("osascript", ["-e", "output volume of (get volume settings)"], { encoding: "utf8" }).trim();
const startMuted = execFileSync("osascript", ["-e", "output muted of (get volume settings)"], { encoding: "utf8" }).trim();

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [`--auto-select-tab-capture-source-by-title=${PLAYER_TITLE}`, "--autoplay-policy=no-user-gesture-required"],
});
const ctx = await browser.newContext({ permissions: ["microphone"] });
const player = await ctx.newPage();
await player.goto(`${base}/player.html`);
const noisePage = noiseAudio ? await ctx.newPage() : null;
if (noisePage) await noisePage.goto(`${base}/noise.html`);
const rec = await ctx.newPage();
rec.on("console", (m) => m.type() === "error" && console.log("REC", m.text()));
await rec.goto(`${base}/recorder.html`);
await rec.click("#go");
const tracks = await rec.evaluate((l) => window.startCapture(l), micLabel);
console.log("capture:", JSON.stringify(tracks));
if (tracks.display[0]?.state !== "live") throw new Error("the tab share has no live audio track");

const session = {
  started: new Date().toISOString(),
  sr: SR,
  startVolume,
  tracks,
  noiseAudio: noiseAudio ? basename(noiseAudio) : null,
  noiseLevel: noiseAudio ? noiseLevel : null,
  segments: [],
};

async function recordSegment(name, sec, play) {
  await rec.evaluate(() => window.resetBuffers());
  const tab = [];
  const mic = [];
  const statsBefore = await rec.evaluate(() => window.micStats());
  if (play) await play();
  const end = Date.now() + sec * 1000;
  while (Date.now() < end) {
    await new Promise((r) => setTimeout(r, 2000));
    const d = await rec.evaluate(() => window.drain());
    tab.push(Buffer.from(d.tab, "base64"));
    mic.push(Buffer.from(d.mic, "base64"));
  }
  await player.evaluate(() => window.stopPlay());
  const statsAfter = await rec.evaluate(() => window.micStats());
  for (const [leg, chunks] of [["tab", tab], ["mic", mic]]) {
    const pcm = Buffer.concat(chunks);
    writeFileSync(join(outDir, `${name}.${leg}.wav`), Buffer.concat([wavHeader(pcm.length / 2), pcm]));
  }
  console.log(`recorded ${name} (${sec}s)`);
  // The speaker-to-mic gain once moved 13 dB between sets with these two
  // unchanged at their end; logged per take so the next drift can be placed.
  const inputVolume = +execFileSync("osascript", ["-e", "input volume of (get volume settings)"], { encoding: "utf8" }).trim();
  const outputVolume = +execFileSync("osascript", ["-e", "output volume of (get volume settings)"], { encoding: "utf8" }).trim();
  return { statsBefore, statsAfter, inputVolume, outputVolume, endedAt: new Date().toISOString() };
}

try {
  setVolume(0);
  // Started once the output is at 0, so the noise never sounds at the laptop's own level.
  // At 0 the room-noise take holds the room alone.
  if (noisePage) await noisePage.evaluate(([u, l]) => window.playNoise(u, l), [`${base}/noise.wav`, noiseLevel]);
  const noise = await recordSegment("noise", noiseSec, null);
  session.segments.push({ name: "noise", kind: "noise", volume: 0, ...noise });
  for (const vol of volumes) {
    setVolume(vol);
    execFileSync("osascript", ["-e", "set volume without output muted"]);
    if (noisePage) {
      const nv = await recordSegment(`noise-audible-v${vol}`, noiseSec, null);
      session.segments.push({ name: `noise-audible-v${vol}`, kind: "noise", volume: vol, ...nv });
    }
    const sw = await recordSegment(`sweep-v${vol}`, 10, () => player.evaluate((u) => window.playAt(u, 0), `${base}/sweep.wav`));
    session.segments.push({ name: `sweep-v${vol}`, kind: "sweep", volume: vol, ...sw });
    for (const id of trackIds) {
      const song = JSON.parse(readFileSync(join(songsDir, `${id}.song.json`), "utf8"));
      // Start a little before the drop so each take has a build and a drop.
      const start = Math.max(0, Math.min(song.dropTime - 15, song.duration - seconds - 1));
      const name = `${id}-v${vol}`;
      const r = await recordSegment(name, seconds, () => player.evaluate(([u, s]) => window.playAt(u, s), [`${base}/song/${id}.wav`, start]));
      session.segments.push({ name, kind: "song", song: id, bpm: song.bpm, period: song.period, phi: song.phi, songStart: start, volume: vol, ...r });
      writeFileSync(join(outDir, "session.json"), JSON.stringify(session, null, 2));
    }
  }
} finally {
  if (noisePage) await noisePage.evaluate(() => window.stopNoise()).catch((e) => console.log("noise stop failed:", e.message));
  setVolume(startVolume);
  if (startMuted === "true") execFileSync("osascript", ["-e", "set volume with output muted"]);
  writeFileSync(join(outDir, "session.json"), JSON.stringify(session, null, 2));
  await browser.close();
  server.close();
}
console.log(`MIC_GAP_OK ${outDir}`);
