import { afterEach, describe, expect, it, vi } from "vitest";
import { detectDeviceKind, guessDeviceName, thisDevice, type DeviceEnv } from "../src/net/deviceKind.ts";

// Real user agent strings, as the browsers send them.
const UA = {
  // iPadOS 13+ Safari asks for the desktop site and says Macintosh.
  ipadDesktopClass:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  ipadMobile:
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  pixel:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  galaxyTab:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
  chromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
  lgWebOs:
    "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/79.0.3945.79 Safari/537.36 WebAppManager",
  samsungTizen:
    "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36",
  androidTv:
    "Mozilla/5.0 (Linux; Android 11; BRAVIA 4K GB) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
  windowsPhone:
    "Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.15254",
};

function env(userAgent: string, over: Partial<DeviceEnv> = {}): DeviceEnv {
  return { userAgent, maxTouchPoints: 0, screenW: 1440, screenH: 900, ...over };
}

describe("detectDeviceKind", () => {
  it("calls an iPad a tablet, in both of the agents it sends", () => {
    expect(detectDeviceKind(env(UA.ipadMobile, { maxTouchPoints: 5, screenW: 820, screenH: 1180 }))).toBe("tablet");
    expect(detectDeviceKind(env(UA.ipadDesktopClass, { maxTouchPoints: 5, screenW: 820, screenH: 1180 }))).toBe("tablet");
  });

  it("calls a Mac with no touch screen a laptop, even with the same agent as an iPad", () => {
    expect(detectDeviceKind(env(UA.ipadDesktopClass, { maxTouchPoints: 0 }))).toBe("laptop");
    expect(detectDeviceKind(env(UA.ipadDesktopClass, { maxTouchPoints: 1 }))).toBe("laptop");
    expect(detectDeviceKind(env(UA.macChrome))).toBe("laptop");
  });

  it("calls an iPhone and a Pixel phones", () => {
    expect(detectDeviceKind(env(UA.iphone, { maxTouchPoints: 5, screenW: 390, screenH: 844 }))).toBe("phone");
    expect(detectDeviceKind(env(UA.pixel, { maxTouchPoints: 5, screenW: 412, screenH: 915 }))).toBe("phone");
  });

  it("calls an Android agent without Mobile a tablet", () => {
    expect(detectDeviceKind(env(UA.galaxyTab, { maxTouchPoints: 5, screenW: 800, screenH: 1280 }))).toBe("tablet");
  });

  it("calls desktops and Chromebooks laptops", () => {
    expect(detectDeviceKind(env(UA.windowsEdge))).toBe("laptop");
    expect(detectDeviceKind(env(UA.chromeOs))).toBe("laptop");
    expect(detectDeviceKind(env(UA.linuxFirefox))).toBe("laptop");
  });

  it("calls a TV browser a tv, before any other rule sees its Android or Linux agent", () => {
    expect(detectDeviceKind(env(UA.lgWebOs, { screenW: 1920, screenH: 1080 }))).toBe("tv");
    expect(detectDeviceKind(env(UA.samsungTizen, { screenW: 1920, screenH: 1080 }))).toBe("tv");
    expect(detectDeviceKind(env(UA.androidTv, { screenW: 1920, screenH: 1080 }))).toBe("tv");
  });

  it("takes any other agent that says Mobile for a phone, unless the screen is tablet-sized", () => {
    expect(detectDeviceKind(env(UA.windowsPhone, { maxTouchPoints: 5, screenW: 360, screenH: 640 }))).toBe("phone");
    expect(detectDeviceKind(env("Mozilla/5.0 (Mobile; rv:40.0) Gecko/40.0 Firefox/40.0", { screenW: 800, screenH: 1280 }))).toBe(
      "tablet",
    );
  });

  it("falls back to laptop for an empty or unknown agent", () => {
    expect(detectDeviceKind(env(""))).toBe("laptop");
    expect(detectDeviceKind(env("curl/8.0"))).toBe("laptop");
  });
});

describe("guessDeviceName", () => {
  const name = (ua: string, over: Partial<DeviceEnv> = {}) => {
    const e = env(ua, over);
    return guessDeviceName(e, detectDeviceKind(e));
  };

  it("names each device by what it is", () => {
    expect(name(UA.ipadMobile, { maxTouchPoints: 5 })).toBe("iPad");
    expect(name(UA.ipadDesktopClass, { maxTouchPoints: 5 })).toBe("iPad");
    expect(name(UA.iphone, { maxTouchPoints: 5, screenW: 390, screenH: 844 })).toBe("iPhone");
    expect(name(UA.pixel, { maxTouchPoints: 5, screenW: 412, screenH: 915 })).toBe("Android phone");
    expect(name(UA.galaxyTab, { maxTouchPoints: 5, screenW: 800, screenH: 1280 })).toBe("Android tablet");
    expect(name(UA.macChrome)).toBe("Mac");
    expect(name(UA.windowsEdge)).toBe("Windows PC");
    expect(name(UA.chromeOs)).toBe("Chromebook");
    expect(name(UA.linuxFirefox)).toBe("Linux PC");
    expect(name(UA.lgWebOs)).toBe("TV");
    expect(name(UA.samsungTizen)).toBe("TV");
  });

  it("falls back to the kind's own name when the agent says nothing", () => {
    expect(name("")).toBe("Laptop");
    expect(name("curl/8.0")).toBe("Laptop");
    expect(guessDeviceName(env("curl/8.0"), "phone")).toBe("Phone");
    expect(guessDeviceName(env("curl/8.0"), "tablet")).toBe("Tablet");
    // A Windows Phone is a phone, never a "Windows PC" (its agent also says Android).
    expect(name(UA.windowsPhone, { maxTouchPoints: 5, screenW: 360, screenH: 640 })).not.toBe("Windows PC");
    expect(name("Mozilla/5.0 (Windows Phone 10.0) Mobile", { screenW: 360, screenH: 640 })).toBe("Phone");
  });
});

describe("thisDevice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads navigator and screen: kind, a microphone when getUserMedia exists, a guessed name", () => {
    vi.stubGlobal("navigator", {
      userAgent: UA.ipadDesktopClass,
      maxTouchPoints: 5,
      mediaDevices: { getUserMedia: () => Promise.resolve() },
    });
    vi.stubGlobal("screen", { width: 820, height: 1180 });
    expect(thisDevice()).toEqual({ kind: "tablet", hasMic: true, name: "iPad" });
  });

  it("has no microphone without getUserMedia, and a TV never has one", () => {
    vi.stubGlobal("navigator", { userAgent: UA.macChrome, maxTouchPoints: 0 });
    vi.stubGlobal("screen", { width: 1440, height: 900 });
    expect(thisDevice()).toEqual({ kind: "laptop", hasMic: false, name: "Mac" });

    vi.stubGlobal("navigator", {
      userAgent: UA.lgWebOs,
      maxTouchPoints: 0,
      mediaDevices: { getUserMedia: () => Promise.resolve() },
    });
    expect(thisDevice()).toEqual({ kind: "tv", hasMic: false, name: "TV" });
  });
});
