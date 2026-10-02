import { describe, expect, it } from "vitest";
import { isTvUserAgent, tvRedirectTarget } from "../src/net/tvRedirect.ts";

const TVS = [
  "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36",
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager",
  "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K VH2 Build/STT1.211025.001.Z4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0 Safari/537.36",
  "Mozilla/5.0 (Linux; Android 9; AFTMM Build/PS7633) AppleWebKit/537.36 (KHTML, like Gecko) Silk/112.3.1 like Chrome/112.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 CrKey/1.56.500000",
  "Mozilla/5.0 (Linux; Android 11; Google TV Streamer) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "Opera/9.80 (Linux mips; U; HbbTV/1.1.1 (; Philips; ; ; ; ) CE-HTML/1.0 NETTV/3.2.1; en) Presto/2.6.33 Version/10.70",
];

const NOT_TVS = [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
];

describe("isTvUserAgent", () => {
  it.each(TVS)("a TV: %s", (ua) => expect(isTvUserAgent(ua)).toBe(true));
  it.each(NOT_TVS)("not a TV: %s", (ua) => expect(isTvUserAgent(ua)).toBe(false));
});

describe("tvRedirectTarget", () => {
  const TV = TVS[0]!;

  it("sends a TV opening the plain site to /tv", () => {
    expect(tvRedirectTarget("", TV)).toBe("/tv");
    expect(tvRedirectTarget("?quality=low", TV)).toBe("/tv?quality=low");
  });

  it("leaves everything else where it is", () => {
    expect(tvRedirectTarget("", NOT_TVS[0]!)).toBeNull();
    expect(tvRedirectTarget("?notv", TV)).toBeNull();
    expect(tvRedirectTarget("?room=ABCD", TV)).toBeNull();
    expect(tvRedirectTarget("?room=ABCD&role=controller", TV)).toBeNull();
    expect(tvRedirectTarget("?adopt=WXYZ", TV)).toBeNull();
  });
});
