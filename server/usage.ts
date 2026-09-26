/**
 * Anonymous usage counts — the one measurement this site makes of itself.
 *
 * Cloudflare's own request analytics can't say how many people actually used
 * the visualizer: most requests are scanners and crawlers, a browser that
 * loads the page may never start audio, and the owner's own visits (from
 * changing IPs, countries, VPNs) can't be told apart by address. So the
 * client (src/net/usage.ts) reports only what a person does — a scene
 * actually running on live audio — and marks the owner's own devices by a
 * flag they set once per browser (`?me=1`), never by IP.
 *
 * Each event becomes one Workers Analytics Engine data point (the USAGE
 * binding in wrangler.toml; prod only, so previews and `wrangler dev` write
 * nothing). Nothing identifying is stored: no IP, no device id, no user
 * agent string — only the fields parseUsageEvent() accepts plus a country
 * and a coarse device class. PRIVACY.md describes this to visitors; keep the
 * two in step. `tools/usage.mjs` reads the counts back.
 *
 * The blob order below is the dataset's schema — Analytics Engine columns
 * are positional (blob1, blob2, …), so append new fields, never reorder.
 */

/** A scene started running on live audio: `start` for the first one in a
 *  page load, `scene` for each different scene after it. */
export type UsageEventKind = "start" | "scene";
export type UsageSource = "mic" | "display" | "remote";

export interface UsageEvent {
  e: UsageEventKind;
  /** Scene id — the same ids as the URL hash. */
  s: string;
  src: UsageSource;
  /** 1 when the browser carries the owner's `?me=1` flag. */
  me: 0 | 1;
}

const KINDS: readonly string[] = ["start", "scene"] satisfies UsageEventKind[];
const SOURCES: readonly string[] = ["mic", "display", "remote"] satisfies UsageSource[];
const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Validates an untrusted beacon body. Anything malformed is dropped rather
 *  than stored, so a stray client can't write arbitrary strings into the
 *  dataset. */
export function parseUsageEvent(body: unknown): UsageEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const { e, s, src, me } = body as Record<string, unknown>;
  if (typeof e !== "string" || !KINDS.includes(e)) return null;
  if (typeof s !== "string" || !SCENE_ID_RE.test(s)) return null;
  if (typeof src !== "string" || !SOURCES.includes(src)) return null;
  if (me !== 0 && me !== 1) return null;
  return { e: e as UsageEventKind, s, src: src as UsageSource, me };
}

// Crawlers that execute JavaScript (Googlebot does) can't start audio, so
// they shouldn't reach here at all — this is the backstop for any that fake it.
const BOT_UA_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview/i;

export function isBotUserAgent(ua: string): boolean {
  return ua === "" || BOT_UA_RE.test(ua);
}

export function deviceClass(ua: string): "mobile" | "desktop" {
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "mobile" : "desktop";
}

/** The Analytics Engine data point for an accepted event. */
export function usageDataPoint(ev: UsageEvent, country: string, ua: string): AnalyticsDataPoint {
  return {
    indexes: [ev.e],
    blobs: [ev.e, ev.s, ev.src, ev.me ? "me" : "visitor", country, deviceClass(ua)],
    doubles: [1],
  };
}

/** Structural copy of the Workers `AnalyticsEngineDataPoint`, so this module
 *  stays importable from the root (DOM) tsconfig that tests/ compiles under. */
interface AnalyticsDataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}
