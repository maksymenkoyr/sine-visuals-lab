/**
 * The pure half of the clip recorder (clipRecorder.ts): which container the
 * browser can write, how a canvas is centre-cropped to a social-media shape,
 * what a saved clip is called and how elapsed time reads. Nothing here touches
 * the DOM, so tests/clipFormat.test.ts runs it in node; the recorder passes in
 * what the browser says (`MediaRecorder.isTypeSupported`) and the canvas sizes.
 */

/** What the clip's picture is shaped like: the canvas as it is, or a centre
 *  crop to a portrait or square frame. */
export type RecordAspect = "screen" | "9:16" | "1:1";

/** The choices in the order the button cycles through them. */
export const RECORD_ASPECTS: readonly RecordAspect[] = ["screen", "9:16", "1:1"];
export const RECORD_ASPECT_DEFAULT: RecordAspect = "screen";

/** What the choice is called on the button. */
export const RECORD_ASPECT_LABELS: Record<RecordAspect, string> = {
  screen: "Screen",
  "9:16": "9:16",
  "1:1": "1:1",
};

/** The pixel size of a cropped clip. `screen` has none: it keeps the canvas's own size. */
export const RECORD_SIZES: Record<Exclude<RecordAspect, "screen">, { w: number; h: number }> = {
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
};

/** Frames per second asked of the canvas stream. */
export const RECORD_FPS = 60;
/** Video bitrate, high enough that 1080p60 motion (fast strobes, noise) holds up. */
export const RECORD_VIDEO_BPS = 16_000_000;
export const RECORD_AUDIO_BPS = 192_000;
/** How often the recorder hands over a chunk, so a long take is not one blob in flight. */
export const RECORD_TIMESLICE_MS = 1000;

export function parseRecordAspect(raw: string | null): RecordAspect {
  return RECORD_ASPECTS.find((a) => a === raw) ?? RECORD_ASPECT_DEFAULT;
}

/** The choice after `current` in the button's cycle. */
export function nextRecordAspect(current: RecordAspect): RecordAspect {
  return RECORD_ASPECTS[(RECORD_ASPECTS.indexOf(current) + 1) % RECORD_ASPECTS.length];
}

export interface RecordFormat {
  /** What goes to `MediaRecorder`'s `mimeType`. */
  mimeType: string;
  /** The file extension, without the dot. */
  ext: "mp4" | "webm";
}

/** Best first: MP4 (H.264 + AAC) plays everywhere a clip gets posted, then
 *  WebM VP9 + Opus, then VP8. */
export const RECORD_FORMATS: readonly RecordFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.64002A,mp4a.40.2", ext: "mp4" },
  { mimeType: "video/mp4;codecs=avc1.42E01E,mp4a.40.2", ext: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", ext: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", ext: "webm" },
];

/** The first format the browser says it can write, null when it says none (the
 *  recorder then lets the browser pick and reads the extension off the result). */
export function pickRecordFormat(isSupported: (mimeType: string) => boolean): RecordFormat | null {
  return RECORD_FORMATS.find((f) => isSupported(f.mimeType)) ?? null;
}

/** The extension for a mime type the recorder reports. */
export function extForMime(mimeType: string): "mp4" | "webm" {
  return mimeType.toLowerCase().startsWith("video/mp4") ? "mp4" : "webm";
}

export interface CropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** The centred part of a `srcW` x `srcH` picture that has the shape of `dstW`
 *  x `dstH`, as large as fits: a wide canvas loses its sides for a portrait
 *  clip, a tall one its top and bottom. Whole pixels, so no blurred edge. */
export function cropRect(srcW: number, srcH: number, dstW: number, dstH: number): CropRect {
  const want = dstW / dstH;
  let sw = srcW;
  let sh = srcH;
  if (srcW / srcH > want) sw = Math.round(srcH * want);
  else sh = Math.round(srcW / want);
  return { sx: Math.floor((srcW - sw) / 2), sy: Math.floor((srcH - sh) / 2), sw, sh };
}

const two = (n: number): string => String(n).padStart(2, "0");

/** `sine-visuals-lab-<scene>-<YYYY-MM-DD-HHMMSS>.<ext>`, in the clock the
 *  performer sees (local time). */
export function clipFileName(sceneId: string, when: Date, ext: string): string {
  const stamp = `${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())}-${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`;
  const scene = sceneId.replace(/[^A-Za-z0-9_-]/g, "") || "scene";
  return `sine-visuals-lab-${scene}-${stamp}.${ext}`;
}

/** Elapsed recording time as m:ss (h:mm:ss from an hour). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
