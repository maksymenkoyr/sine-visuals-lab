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
 * Where a visit came from is one coarse word (`VisitFrom`, issue #597),
 * worked out in the browser by visitFrom() from the referrer and any
 * `utm_source` tag, so neither ever leaves the page: only the word does.
 * Tabs loaded before the field existed send none and are stored as "".
 *
 * The blob order below is the dataset's schema — Analytics Engine columns
 * are positional (blob1, blob2, …), so append new fields, never reorder.
 */

/** A scene started running on live audio: `start` for the first one in a
 *  page load, `scene` for each different scene after it. */
export type UsageEventKind = "start" | "scene";
export type UsageSource = "mic" | "display" | "remote";
/** `site` is one of our own pages, such as a scene page (/scenes/<id>/). */
export type VisitFrom = "search" | "ai" | "social" | "site" | "direct" | "other";

export interface UsageEvent {
  e: UsageEventKind;
  /** Scene id — the same ids as the URL hash. */
  s: string;
  src: UsageSource;
  /** 1 when the browser carries the owner's `?me=1` flag. */
  me: 0 | 1;
  from?: VisitFrom;
}

const KINDS: readonly string[] = ["start", "scene"] satisfies UsageEventKind[];
const SOURCES: readonly string[] = ["mic", "display", "remote"] satisfies UsageSource[];
const FROMS: readonly string[] = ["search", "ai", "social", "site", "direct", "other"] satisfies VisitFrom[];
const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Validates an untrusted beacon body. Anything malformed is dropped rather
 *  than stored, so a stray client can't write arbitrary strings into the
 *  dataset. */
export function parseUsageEvent(body: unknown): UsageEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const { e, s, src, me, from } = body as Record<string, unknown>;
  if (typeof e !== "string" || !KINDS.includes(e)) return null;
  if (typeof s !== "string" || !SCENE_ID_RE.test(s)) return null;
  if (typeof src !== "string" || !SOURCES.includes(src)) return null;
  if (me !== 0 && me !== 1) return null;
  if (from !== undefined && (typeof from !== "string" || !FROMS.includes(from))) return null;
  const ev: UsageEvent = { e: e as UsageEventKind, s, src: src as UsageSource, me };
  if (from !== undefined) ev.from = from as VisitFrom;
  return ev;
}

// Hosts are matched as themselves or any subdomain. AI before search:
// gemini.google.com is an AI chat, the rest of google.* is search.
const AI_HOSTS = ["chatgpt.com", "openai.com", "perplexity.ai", "claude.ai", "gemini.google.com", "bard.google.com", "copilot.microsoft.com", "you.com", "phind.com", "poe.com", "meta.ai", "deepseek.com", "mistral.ai", "grok.com"];
const SEARCH_HOSTS = ["bing.com", "duckduckgo.com", "yahoo.com", "yandex.ru", "yandex.com", "baidu.com", "ecosia.org", "search.brave.com", "startpage.com", "qwant.com", "kagi.com", "naver.com", "seznam.cz"];
const SOCIAL_HOSTS = ["instagram.com", "facebook.com", "fb.com", "t.co", "x.com", "twitter.com", "reddit.com", "youtube.com", "youtu.be", "tiktok.com", "linkedin.com", "lnkd.in", "threads.net", "pinterest.com", "discord.com", "t.me", "whatsapp.com", "vk.com", "bsky.app"];
const OWN_HOST = "sinevisualslab.com";

// A bare tag such as `utm_source=perplexity` names a host by its first label.
const onHost = (host: string, list: readonly string[]): boolean =>
  list.some((d) => host === d || host.endsWith(`.${d}`) || (!host.includes(".") && d.split(".")[0] === host));

/** Where this page load came from, from `document.referrer` and the
 *  `utm_source` query value (chat products tag their links with it, e.g.
 *  `utm_source=chatgpt.com`). A tag wins over the referrer. */
export function visitFrom(referrer: string, utmSource: string | null): VisitFrom {
  let host = "";
  if (utmSource) host = utmSource.toLowerCase().trim();
  else if (referrer) {
    try {
      host = new URL(referrer).hostname.toLowerCase();
    } catch {
      return "other";
    }
  } else return "direct";
  if (onHost(host, [OWN_HOST])) return "site";
  if (onHost(host, AI_HOSTS)) return "ai";
  if (onHost(host, SEARCH_HOSTS) || host === "google" || /(^|\.)google\.[a-z.]+$/.test(host)) return "search";
  if (onHost(host, SOCIAL_HOSTS)) return "social";
  return "other";
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
    blobs: [ev.e, ev.s, ev.src, ev.me ? "me" : "visitor", country, deviceClass(ua), ev.from ?? ""],
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
