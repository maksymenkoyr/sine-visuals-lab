/**
 * A tiny grey signal-preview meter on every input in the Input card's Source
 * row that ISN'T the live one (src/ui/deviceMenu.ts), so you can see which
 * one has sound before picking it. Opens a quiet getUserMedia stream per
 * candidate device into an AnalyserNode — nothing ever connects to an
 * AudioContext's destination, so nothing is heard — and reports each one's
 * level on demand; nothing here touches the live capture itself.
 *
 * inputPreviewSupported() gates the whole feature off on WebKit (desktop
 * Safari, and every iOS browser — they're all WebKit under the hood) and on
 * mobile UAs generally: opening a second getUserMedia on another device
 * there can end the LIVE capture's own track, which would fire
 * src/app.ts's onCaptureEnded and loop into a reopen — the mic that's
 * actually playing music would audibly hiccup every time this module synced.
 * Desktop Chromium/Firefox don't share that failure mode, so this only ever
 * runs there.
 *
 * src/app.ts owns the one instance, syncing it to the Source row's non-live
 * options while the panel is open (see its setInputPreviewActive wiring) —
 * this module only opens/reads/closes streams, it has no idea what a panel
 * or a "live" row is.
 */

function isWebKit(): boolean {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
}

function isMobileUa(): boolean {
  return /iPhone|iPad|iPod|Android/.test(navigator.userAgent);
}

export function inputPreviewSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  return !isWebKit() && !isMobileUa();
}

const ANALYSER_FFT_SIZE = 512;
// The meter's whole travel: −60 dBFS reads as a barely-there room floor, 0
// dBFS as clipping. Same shape as any other dBFS-to-0..1 meter in this repo,
// just not shared code — this is the only place mapping a *preview* level.
const METER_FLOOR_DB = -60;

interface OpenInput {
  stream: MediaStream;
  analyser: AnalyserNode;
  data: Float32Array<ArrayBuffer>;
}

export interface InputPreview {
  /** Opens every id not already open, closes every open id not listed here.
   *  A failed open is swallowed — that device just has no meter until a
   *  later sync retries it. */
  sync(deviceIds: string[]): void;
  /** 0..1, or null while that id isn't open (never requested, still
   *  opening, or its open failed). */
  level(deviceId: string): number | null;
  stop(): void;
}

export function createInputPreview(): InputPreview {
  let ctx: AudioContext | null = null;
  const open = new Map<string, OpenInput>();
  // ids a getUserMedia call is in flight for — guards against sync() firing
  // again before the previous open for the same id has resolved.
  const opening = new Set<string>();
  let wanted = new Set<string>();

  function ensureContext(): AudioContext {
    if (!ctx) ctx = new AudioContext({ latencyHint: "playback" });
    return ctx;
  }

  function closeOne(id: string): void {
    const entry = open.get(id);
    if (!entry) return;
    for (const track of entry.stream.getTracks()) track.stop();
    open.delete(id);
  }

  function openOne(context: AudioContext, id: string): void {
    opening.add(id);
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          deviceId: { exact: id },
        },
      })
      .then((stream) => {
        opening.delete(id);
        // Dropped from `wanted`, or this whole preview was stopped, while the
        // open was in flight — close it now rather than leave a mic stream
        // open that nothing reads from and nobody asked for anymore.
        if (!wanted.has(id) || ctx !== context) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = ANALYSER_FFT_SIZE;
        source.connect(analyser); // never connected onward to destination — silent by construction
        open.set(id, { stream, analyser, data: new Float32Array(analyser.fftSize) });
      })
      .catch(() => {
        opening.delete(id);
      });
  }

  return {
    sync(deviceIds: string[]): void {
      const context = ensureContext();
      void context.resume();
      wanted = new Set(deviceIds);
      for (const id of Array.from(open.keys())) if (!wanted.has(id)) closeOne(id);
      for (const id of wanted) if (!open.has(id) && !opening.has(id)) openOne(context, id);
    },
    level(id: string): number | null {
      const entry = open.get(id);
      if (!entry) return null;
      entry.analyser.getFloatTimeDomainData(entry.data);
      let sumSq = 0;
      for (let i = 0; i < entry.data.length; i++) sumSq += entry.data[i] * entry.data[i];
      const rms = Math.sqrt(sumSq / entry.data.length);
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB));
    },
    stop(): void {
      wanted = new Set();
      for (const id of Array.from(open.keys())) closeOne(id);
      const context = ctx;
      ctx = null;
      void context?.close();
    },
  };
}
