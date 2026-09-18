#!/usr/bin/env node
// Measures real-microphone-to-onset-flag latency: the delay from a sound
// physically entering the mic to src/audio/features.ts flagging
// FeatureFrame.onset — the one link in the chain that was previously only
// estimated from reading src/audio/analyser.ts's/features.ts's constants,
// never actually clocked. Complements the render-cap delay (already
// measured separately, ~5-10ms — see renderLatch.ts) rather than
// re-measuring it: this tool stops at the onset flag.
//
//   node tools/audio-latency.mjs [--port 5173] [--scene caustics]
//        [--clicks 120] [--seed 12345] [--wav <path>] [--out <path>]
//
// Method: generates a click-track WAV (broadband bursts over literal digital
// silence — see generateClickTrack below for why every parameter is the
// value it is) and plays it in as Chromium's fake microphone via
// tools/ref-browser.mjs's launchWithMic/openScene, exactly like
// ref-hear.mjs/ref-shoot.mjs do for a reference video's audio.
//
// The core trick — why no clock is compared against another clock — is that
// the buffer being read for detection and the buffer being searched for
// ground truth are the SAME buffer: on the tick window.__viz.audioProbe()
// reports onset flipping true, window.__viz.audioBuffer() returns app.ts's
// deep 32768-sample analyser tap for that same tick (see debug.ts's
// audioProbe/audioBuffer split — probe() itself is unsuitable here, since it
// drives resolveSceneSetting()'s auto-tune side effects on every call).
// Matched-filtering that buffer against the exact click waveform we
// generated (kept in memory, not just its timestamp) finds the click's
// sample position directly inside the SAME buffer index space the "how many
// samples old is the newest sample" question is asked in — so the answer
// falls out as one subtraction, in samples, with no AudioContext.currentTime
// or performance.now() anywhere in the arithmetic. (An earlier version of
// this plan tried to derive the click's absolute time from currentTime and
// diff against FeatureFrame.time; that's systematically biased 0-10ms high,
// because currentTime is read before the analyser is in app.ts's
// currentVisual() — an audio callback landing between those two statements
// advances the ring buffer without advancing the timestamp. Comparing
// sample positions inside one buffer sidesteps that entirely.)
//
// window.__micT0 (performance.now() when getUserMedia resolved, set by
// ref-browser.mjs's init script) is used ONLY to guess which generated
// click a detected onset most likely corresponds to — safe, since clicks
// are spaced >=450ms apart and __micT0's own bias/jitter is a few tens of
// ms at most. It never appears in the reported latency itself; per the
// plan this bias makes it unsuitable as anything but a coarse disambiguator.
//
// Real-music sanity pass (--wav pointing at an existing file, e.g. a
// tools/.cache/refs/<bundle>/audio.wav): there's no known click waveform to
// matched-filter against, so this falls back to a cruder same-buffer
// technique — the steepest recent rise in a short-window RMS envelope,
// which has no independent ground truth. Treat its output as "does the
// click-track number roughly hold on a real mix", not as a second precise
// measurement — a real attack is softer than a synthetic click's sharp
// transient, so this reads higher even when everything is working.
//
// Output: <out>.json (samples array + summary) and a human-readable summary
// on stdout, ending with AUDIO_LATENCY_OK on success.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { launchWithMic, openScene } from "./ref-browser.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const port = opt("--port", "5173");
const scene = opt("--scene", "caustics");
const clickCount = +opt("--clicks", "120");
const seed = +opt("--seed", "12345");
const wavOverride = opt("--wav", null);
const outPath = resolve(opt("--out", `tools/.cache/audio-latency/${scene}.json`));

// ---------------------------------------------------------------------
// Seeded RNG (mulberry32) — deterministic so a click track is reproducible
// across runs, same idiom as tests/features.test.ts's seeded onset tests.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dbfsToLinear = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------
// Hand-rolled RIFF/PCM16 mono writer — nothing in the repo synthesizes
// audio today (tools/ref-scan.py only extracts it via ffmpeg), and this is
// a small enough format to not need a dependency for it.
function writeWavPCM16(path, floatSamples, sampleRate) {
  const n = floatSamples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------------
// The click track. Every constant here exists to defeat a specific failure
// mode of src/audio/features.ts's detector — see this tool's header list in
// the plan this came from; restated at each constant so the file is
// self-contained.
const SAMPLE_RATE = 48000; // tools/ref-scan.py's format — what Chromium's fake-audio-capture reads
const CLICK_PEAK_DBFS = -6; // loud and unambiguous; there's no bed to keep headroom above (see below)
const CLICK_DUR_MS = 2.5; // long enough to light all 24 log-spaced bands, short enough to keep ground truth tight
const MIN_INTERVAL_S = 0.45; // above ONSET_REFRACTORY_SEC(0.1) and PEAK_HOLD_SEC(0.3)+relax, so clicks don't pump each other's band ceilings
const MAX_INTERVAL_S = 1.15;
const LEAD_IN_S = 4; // tracker warm-up, discarded by construction (no click lands before this)
const TRAIL_S = 1;
const ARRIVAL_ENVELOPE_FRAC = 0.1; // "arrival" = where the click's own envelope first clears 10% of its peak

// No noise bed between clicks — this plays as literal digital silence.
// Two earlier versions had one: first literal per-sample white noise, which
// broke the measurement outright (a freshly-independent-random 2048-sample
// FFT window has huge single-frame periodogram variance — a periodogram
// bin's power estimate is itself chi-squared-distributed, its own standard
// deviation comparable to its mean — so the bed alone fired spurious onsets
// throughout the recording, 107 of them against 20 real clicks in one run).
// A second version summed fixed-frequency, fixed-amplitude partials to kill
// that per-frame variance, but nearby partials beat against each other as
// their relative phase drifts (2048-sample analysis windows are disjoint,
// so two partials a few Hz apart slide in and out of phase over consecutive
// windows), which still produced a slow amplitude wobble large enough to
// cross threshold every 100-200ms (measured: 83 spurious onsets over 12.5s
// of "bed", fluxRatio always barely above 1). The bed's entire purpose was
// defending against a REAL microphone's physical self-noise (thermal/
// electrical) fluctuating enough, in near silence, to cross an adaptive
// window that's collapsed to MIN_RANGE_DB — but tools/ref-browser.mjs's
// fake, file-based capture device has no physical noise source at all: it
// plays back exactly the samples in the WAV, so literal digital silence
// really is silence, with zero variance to trigger anything. Measured
// directly: 0 onsets over 12s of an all-zero-sample WAV, on this same
// scene. If this tool is ever pointed at a REAL microphone instead of the
// fake file device, this assumption stops holding and a bed belongs back.
function generateClickTrack() {
  const rand = mulberry32(seed);
  const whiteNoise = () => rand() * 2 - 1; // uniform, used for click bursts only
  const clickPeak = dbfsToLinear(CLICK_PEAK_DBFS);
  const clickLen = Math.round((CLICK_DUR_MS / 1000) * SAMPLE_RATE);

  // Short linear attack (12% of the burst), then an exponential-ish decay —
  // sharper than a raised cosine so the "arrival" point sits close to the
  // burst's actual start rather than deep into a slow ramp.
  const envelope = new Float32Array(clickLen);
  const attackLen = Math.max(1, Math.round(clickLen * 0.12));
  for (let i = 0; i < clickLen; i++) {
    envelope[i] = i < attackLen ? i / attackLen : Math.exp((-(i - attackLen) / (clickLen - attackLen)) * 4);
  }

  const clicks = [];
  let tSec = LEAD_IN_S;
  for (let k = 0; k < clickCount; k++) {
    tSec += MIN_INTERVAL_S + rand() * (MAX_INTERVAL_S - MIN_INTERVAL_S);
    let startSample = Math.round(tSec * SAMPLE_RATE);
    // Nudge off a 128-sample (render-quantum) boundary so clicks don't all
    // land at the same phase of the audio callback grid.
    if (startSample % 128 === 0) startSample += 1 + Math.floor(rand() * 60);
    const template = new Float32Array(clickLen);
    for (let i = 0; i < clickLen; i++) template[i] = whiteNoise() * clickPeak * envelope[i];
    let thresholdOffset = clickLen - 1;
    for (let i = 0; i < clickLen; i++) {
      // Thresholded on the envelope itself, not the noisy instantaneous
      // sample — the envelope is what's deterministic; a single sample's
      // magnitude also carries whiteNoise()'s own per-sample roll.
      if (envelope[i] > ARRIVAL_ENVELOPE_FRAC) {
        thresholdOffset = i;
        break;
      }
    }
    clicks.push({ index: k, startSample, timeSec: startSample / SAMPLE_RATE, template, thresholdOffset });
  }

  const durationSec = clicks[clicks.length - 1].timeSec + CLICK_DUR_MS / 1000 + TRAIL_S;
  const totalSamples = Math.ceil(durationSec * SAMPLE_RATE);
  const samples = new Float32Array(totalSamples); // zero-filled: silence between clicks, see header
  for (const click of clicks) {
    for (let i = 0; i < click.template.length; i++) {
      const s = click.startSample + i;
      if (s < totalSamples) samples[s] += click.template[i];
    }
  }
  return { samples, clicks, sampleRate: SAMPLE_RATE, durationSec };
}

// ---------------------------------------------------------------------
// Resample a click's own template to the AudioContext's actual sample rate
// (usually 48000, matching the file, but not guaranteed) before
// matched-filtering against a live buffer recorded at that rate.
function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(samples.length - 1, i0 + 1);
    const frac = srcPos - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/** Matched filter: the offset in `buffer` where `template` best aligns (raw
 *  dot-product argmax — a matched filter doesn't need per-offset
 *  normalization to find the peak, only to score confidence in it after).
 *  O(buffer.length * template.length); at 32768 x ~120 this is ~4M ops per
 *  click, negligible for a ~100-click run. */
function matchedFilter(buffer, template) {
  const bn = buffer.length;
  const tn = template.length;
  let bestOffset = 0;
  let bestValue = -Infinity;
  for (let offset = 0; offset <= bn - tn; offset++) {
    let sum = 0;
    for (let i = 0; i < tn; i++) sum += buffer[offset + i] * template[i];
    if (sum > bestValue) {
      bestValue = sum;
      bestOffset = offset;
    }
  }
  let bufEnergy = 0;
  let tmplEnergy = 0;
  for (let i = 0; i < tn; i++) {
    bufEnergy += buffer[bestOffset + i] ** 2;
    tmplEnergy += template[i] ** 2;
  }
  const confidence = bestValue / (Math.sqrt(bufEnergy * tmplEnergy) || 1);
  return { offset: bestOffset, confidence };
}

/** Real-music fallback (--wav pointing at an existing file): no known click
 *  waveform to matched-filter against, so this locates the steepest recent
 *  rise in a short-window RMS envelope instead — a proxy for "the attack of
 *  whatever transient just triggered this onset". A first version compared
 *  against a "quiet baseline" taken from the buffer's own older quarter;
 *  that assumes the buffer contains a quiet stretch at all, which dense,
 *  continuously loud music doesn't have — it collapsed to exactly 0ms on a
 *  first real-music run, because the loud baseline made "quiet" trivially
 *  true near the buffer's very end. Steepest-rise has no such assumption:
 *  it's the same idea features.ts's own flux detector uses (a local
 *  increase, not an absolute level), just computed directly on the
 *  waveform instead of per-band spectra. No independent ground truth
 *  either way; see this file's header for why this is a sanity check only. */
function envelopeArrival(buffer, sampleRate) {
  const win = Math.max(8, Math.round(sampleRate * 0.001)); // ~1ms window
  const n = buffer.length;
  const rmsLen = n - win;
  if (rmsLen <= 1) return { offset: n - 1 };
  const rms = new Float32Array(rmsLen);
  for (let i = 0; i < rmsLen; i++) {
    let sum = 0;
    for (let j = 0; j < win; j++) sum += buffer[i + j] * buffer[i + j];
    rms[i] = Math.sqrt(sum / win);
  }
  // Onsets fire within a tick or two of the transient (see this file's
  // click-track results), so the transient itself must sit in roughly the
  // last 150ms of a 682ms buffer — searching the whole buffer would let a
  // louder, unrelated moment earlier in the window win instead.
  const step = win;
  const searchStart = Math.max(0, rmsLen - Math.round(sampleRate * 0.15) - step);
  let bestIdx = searchStart;
  let bestRise = -Infinity;
  for (let i = searchStart; i < rmsLen - step; i++) {
    const rise = rms[i + step] - rms[i];
    if (rise > bestRise) {
      bestRise = rise;
      bestIdx = i;
    }
  }
  return { offset: Math.min(bestIdx + win, n - 1) };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function quantile(values, q) {
  const s = [...values].sort((a, b) => a - b);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

// ---------------------------------------------------------------------
async function main() {
  let wavPath;
  let track = null;
  if (wavOverride) {
    wavPath = resolve(wavOverride);
    if (!existsSync(wavPath)) {
      console.error(`audio-latency: --wav ${wavPath} does not exist`);
      process.exit(2);
    }
    console.log(`audio-latency: real-music sanity pass against ${wavPath} (approximate — no known ground truth, see header)`);
  } else {
    track = generateClickTrack();
    wavPath = resolve(`tools/.cache/audio-latency/click-track-${seed}.wav`);
    writeWavPCM16(wavPath, track.samples, track.sampleRate);
    console.log(
      `audio-latency: generated ${track.clicks.length} clicks over ${track.durationSec.toFixed(1)}s -> ${wavPath}`,
    );
  }

  const { browser, ctx } = await launchWithMic(wavPath);
  const page = await openScene(ctx, { port, scene, quality: "high" });
  const durationMs = track ? track.durationSec * 1000 + 500 : 60_000;
  console.log(`audio-latency: listening on ${scene} for ${(durationMs / 1000).toFixed(1)}s...`);

  const edges = await page.evaluate(async (durationMs) => {
    const out = [];
    let prevOnset = false;
    const t0 = performance.now();
    return await new Promise((resolveEval) => {
      function tick() {
        const p = window.__viz.audioProbe();
        if (p.onset && !prevOnset) {
          const buf = window.__viz.audioBuffer();
          out.push({ wallMs: performance.now() - window.__micT0, fluxRatio: p.fluxRatio, mono: buf.mono, sampleRate: buf.sampleRate });
        }
        prevOnset = p.onset;
        if (performance.now() - t0 < durationMs) requestAnimationFrame(tick);
        else resolveEval(out);
      }
      requestAnimationFrame(tick);
    });
  }, durationMs);
  await browser.close();

  console.log(`audio-latency: ${edges.length} onset(s) detected`);
  if (edges.length === 0) {
    console.error("audio-latency: no onsets detected at all — the detector never fired. Check the scene loaded and the mic started.");
    process.exit(1);
  }

  // A single click reliably fires more than one onset: the detector's own
  // adaptive peak/floor trackers relax over the following ~100-300ms and
  // can re-cross threshold on their own decay, with no new audio — the
  // exact "second onset from its tail" behavior tests/features.test.ts
  // already documents for a plain click track. The deep buffer being 682ms
  // wide means a matched-filter match on a LATER re-trigger still finds the
  // same click sitting further back in the buffer, with perfectly good
  // confidence — so confidence alone can't tell a tail re-trigger apart
  // from the real first detection. The only thing that can is order: take
  // the EARLIEST edge inside a tight window right after each click's known
  // time, and throw the rest of that window away as re-triggers rather than
  // trying to match them to a different click. WINDOW_MS is generous versus
  // the ~45ms ceiling any real term could reach (see this file's header),
  // while staying far short of MIN_INTERVAL_S so it can never straddle two
  // clicks.
  const WINDOW_MS = 120;
  const results = [];
  if (track) {
    let cursor = 0; // edges are already time-ordered; never re-scan past a consumed one
    for (const click of track.clicks) {
      const windowStart = click.timeSec * 1000 - 20; // small slop for __micT0 jitter — a click can't be detected before it happens
      const windowEnd = click.timeSec * 1000 + WINDOW_MS;
      while (cursor < edges.length && edges[cursor].wallMs < windowStart) cursor++;
      if (cursor >= edges.length || edges[cursor].wallMs > windowEnd) continue; // missed — no onset in this click's window
      const edge = edges[cursor];
      cursor++; // consumed — later edges in the same window are tail re-triggers, not a different click
      if (!edge.mono || !edge.sampleRate) continue; // DEV tap unavailable — see measureAnalyser's own comment
      const buffer = Float32Array.from(edge.mono);
      const template = resampleLinear(click.template, track.sampleRate, edge.sampleRate);
      const scaledThresholdOffset = Math.round(click.thresholdOffset * (edge.sampleRate / track.sampleRate));
      const match = matchedFilter(buffer, template);
      const arrivalIndex = match.offset + scaledThresholdOffset;
      const latencyMs = ((buffer.length - 1 - arrivalIndex) / edge.sampleRate) * 1000;
      results.push({
        clickIndex: click.index,
        wallMs: +edge.wallMs.toFixed(1),
        fluxRatio: edge.fluxRatio,
        confidence: match.confidence,
        latencyMs: +latencyMs.toFixed(2),
      });
    }
    // Low confidence here means the matched filter didn't actually find this
    // click's own waveform in the buffer — the window caught some unrelated
    // onset (bed jitter, a stray render-side effect) instead of this click.
    const trusted = results.filter((r) => r.confidence > 0.3);
    if (trusted.length < results.length) {
      console.log(`audio-latency: dropped ${results.length - trusted.length} low-confidence match(es)`);
    }
    results.length = 0;
    results.push(...trusted);
  } else {
    for (const edge of edges) {
      if (!edge.mono || !edge.sampleRate) continue;
      const buffer = Float32Array.from(edge.mono);
      const arrivalIndex = envelopeArrival(buffer, edge.sampleRate).offset;
      const latencyMs = ((buffer.length - 1 - arrivalIndex) / edge.sampleRate) * 1000;
      results.push({ clickIndex: null, wallMs: +edge.wallMs.toFixed(1), fluxRatio: edge.fluxRatio, confidence: null, latencyMs: +latencyMs.toFixed(2) });
    }
  }

  const latencies = results.map((r) => r.latencyMs);
  const med = median(latencies);
  const iqr = quantile(latencies, 0.75) - quantile(latencies, 0.25);
  const ratio = track ? results.length / track.clicks.length : null;

  console.log(`audio-latency: n=${latencies.length}, median=${med.toFixed(2)}ms, IQR=${iqr.toFixed(2)}ms`);
  if (track) {
    // These sanity bounds are calibrated against the click track's own
    // known, sharp-transient ground truth (see this file's header) — they
    // don't apply to the real-music fallback below, whose "arrival" is
    // already an approximate, softer-attack heuristic with no ground truth
    // to be precise against in the first place.
    console.log(`audio-latency: onset:click ratio = ${ratio.toFixed(2)} (expect close to 1.0)`);
    if (ratio < 0.9 || ratio > 1.1) console.log("audio-latency: WARNING — onset:click ratio far from 1.0 (missed or spurious onsets)");
    if (med < 5) console.log("audio-latency: WARNING — median under 5ms is suspiciously low; check for peak-picking or bed-triggered onsets");
    if (med > 45) console.log("audio-latency: WARNING — median over 45ms exceeds any expected term; check click association");
    const nearestTick = 1000 / 60;
    if (Math.abs(med - Math.round(med / nearestTick) * nearestTick) < 0.5) {
      console.log("audio-latency: WARNING — median clusters on a 16.67ms multiple; likely still quantizing to render ticks, not the in-buffer index");
    }
  } else {
    console.log("audio-latency: real-music mode has no ground truth to sanity-check against — compare this number's order of magnitude to a click-track run, not its exact value");
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      { scene, port: +port, mode: track ? "click-track" : "real-music", wav: wavPath, medianMs: +med.toFixed(2), iqrMs: +iqr.toFixed(2), onsetClickRatio: ratio, results },
      null,
      1,
    ),
  );
  console.log(`audio-latency: wrote ${outPath}`);
  console.log("AUDIO_LATENCY_OK");
}

main().catch((err) => {
  console.error("audio-latency:", err.message);
  process.exit(1);
});
