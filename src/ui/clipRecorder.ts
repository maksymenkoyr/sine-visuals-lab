import {
  RECORD_AUDIO_BPS,
  RECORD_FPS,
  RECORD_SIZES,
  RECORD_TIMESLICE_MS,
  RECORD_VIDEO_BPS,
  clipFileName,
  cropRect,
  extForMime,
  pickRecordFormat,
  type RecordAspect,
} from "./clipFormat.ts";

/**
 * Records a clip of the visuals with the sound they hear, to post on Instagram
 * and the like. The Record button (recordControls.ts) drives it; the pure
 * parts — which container, the crop maths, the file name — are clipFormat.ts.
 *
 * What is recorded, picture: the canvas only, never the panel or the HUD
 * (they are DOM on top of it). While a pop-out output window is open that is
 * the OUTPUT's canvas, not the main window's: the main window then renders
 * only a cheap preview in a smaller box (docs/architecture.md, "Pop-out output
 * window"), and what the audience sees is the output's picture at its own
 * Quality and Resolution. The output is a same-origin popup, so the main
 * window can reach its canvas through the Window that net/outputBridge.ts
 * keeps (`popupWindow()`) and call `captureStream` on it; with no popup in
 * reach (none open, or the main window reloaded since it opened) the main
 * window's canvas is recorded instead.
 *
 * Sound: the MediaStream audio/capture.ts opened (a mic, a line input or a
 * tab/screen share), the same signal the analysers hear. Synthetic and idle
 * audio have no stream, so those clips are video only.
 *
 * Shape: "screen" records the canvas as it is. A crop ("9:16", "1:1") is
 * centre-cropped and scaled to its size in RECORD_SIZES. The WebGL canvas
 * cannot be copied from straight after it was presented (its buffer is
 * cleared once shown), so the canvas stream is played into a hidden <video>
 * and each frame of that is drawn into an offscreen 2D canvas, whose own
 * stream is what gets recorded.
 *
 * Saved when stopped, however it ends: the button, the output window closing,
 * the recorded canvas losing its GL context (or the output page reloading
 * itself over one), or the page being hidden — a hidden window gets no
 * animation frames, so the picture would freeze. Hidden is judged on the
 * window being recorded (and on the main window for a crop, whose copy runs
 * on its animation frames); the main window hiding while the output keeps
 * rendering is not a reason to stop.
 */

export interface ClipRecorderDeps {
  mainCanvas: HTMLCanvasElement;
  /** The pop-out output's window while one is open, else null. */
  outputWindow: () => Window | null;
  /** The live audio input's stream, null when there is none. */
  audioStream: () => MediaStream | null;
  /** The scene's id, for the file name. */
  sceneId: () => string;
  aspect: () => RecordAspect;
  /** Recording started or ended: the button redraws. */
  onChange: () => void;
  /** Something the performer should read (why a clip did not start or save). */
  onMessage: (text: string) => void;
}

export interface ClipRecorder {
  recording(): boolean;
  /** Milliseconds since the take began, 0 when not recording. */
  elapsedMs(): number;
  start(): void;
  /** Ends the take and saves it; a no-op when not recording. */
  stop(): void;
  toggle(): void;
}

/** How often the output window is checked for having closed. */
const OUTPUT_WATCH_MS = 500;

/** The output page's canvas, null when the window is gone or not a page of ours. */
function outputCanvas(win: Window | null): HTMLCanvasElement | null {
  try {
    if (!win || win.closed) return null;
    const el = win.document.getElementById("gl") as HTMLCanvasElement | null;
    return el && typeof el.captureStream === "function" ? el : null;
  } catch {
    // A window that is no longer same-origin (navigated away) is not reachable.
    return null;
  }
}

function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // The download has been handed to the browser by now; free the blob a while later.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function createClipRecorder(deps: ClipRecorderDeps): ClipRecorder {
  /** Everything one take owns, so ending it is one call. */
  let session: { startMs: number; stop: () => void } | null = null;

  function start(): void {
    if (session) return;
    if (typeof MediaRecorder === "undefined") {
      deps.onMessage("This browser cannot record a clip");
      return;
    }
    const aspect = deps.aspect();
    const outWin = deps.outputWindow();
    const outCanvas = outputCanvas(outWin);
    const source = outCanvas ?? deps.mainCanvas;
    const sourceDoc = outCanvas && outWin ? outWin.document : document;
    const undo: Array<() => void> = [];
    const fail = (text: string): void => {
      for (const f of undo.splice(0).reverse()) f();
      deps.onMessage(text);
    };

    let recorder: MediaRecorder;
    let sceneId = "";
    try {
      sceneId = deps.sceneId();
      const picture = source.captureStream(RECORD_FPS);
      undo.push(() => picture.getTracks().forEach((t) => t.stop()));
      let videoTracks = picture.getVideoTracks();

      if (aspect !== "screen") {
        const size = RECORD_SIZES[aspect];
        const crop = document.createElement("canvas");
        crop.width = size.w;
        crop.height = size.h;
        const ctx = crop.getContext("2d");
        if (!ctx) throw new Error("no 2d canvas");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, size.w, size.h);
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = picture;
        void video.play().catch(() => undefined);
        let raf = 0;
        const draw = (): void => {
          raf = requestAnimationFrame(draw);
          if (video.videoWidth === 0 || video.videoHeight === 0) return;
          const r = cropRect(video.videoWidth, video.videoHeight, size.w, size.h);
          ctx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, size.w, size.h);
        };
        raf = requestAnimationFrame(draw);
        const cropped = crop.captureStream(RECORD_FPS);
        undo.push(() => {
          cancelAnimationFrame(raf);
          cropped.getTracks().forEach((t) => t.stop());
          video.pause();
          video.srcObject = null;
        });
        videoTracks = cropped.getVideoTracks();
      }

      // The live audio input's own track, shared not cloned: ending the take
      // must never stop the microphone, so it is left out of the cleanup.
      const audioTracks = (deps.audioStream()?.getAudioTracks() ?? []).filter((t) => t.readyState === "live").slice(0, 1);
      const stream = new MediaStream([...videoTracks, ...audioTracks]);
      const format = pickRecordFormat((m) => MediaRecorder.isTypeSupported(m));
      recorder = new MediaRecorder(stream, {
        ...(format ? { mimeType: format.mimeType } : {}),
        videoBitsPerSecond: RECORD_VIDEO_BPS,
        ...(audioTracks.length > 0 ? { audioBitsPerSecond: RECORD_AUDIO_BPS } : {}),
      });
      const fallbackMime = format?.mimeType ?? "";
      const chunks: Blob[] = [];
      let saved = false;

      const save = (): void => {
        if (saved) return;
        saved = true;
        end();
        const type = recorder.mimeType || fallbackMime;
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) {
          deps.onMessage("Nothing was recorded");
          return;
        }
        saveBlob(blob, clipFileName(sceneId, new Date(), extForMime(type)));
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = save;
      recorder.onerror = () => {
        deps.onMessage("The recording failed");
        stopTake();
      };

      // Every way a take can end by itself.
      const stopTake = (): void => {
        if (recorder.state !== "inactive") recorder.stop();
        else save();
      };
      const onHidden = (): void => {
        // The main window's own hiding only matters when its frames feed the clip.
        const mainFeeds = aspect !== "screen" || !outCanvas;
        if (sourceDoc.visibilityState === "hidden" || (mainFeeds && document.visibilityState === "hidden")) stopTake();
      };
      const onLost = (): void => stopTake();
      source.addEventListener("webglcontextlost", onLost);
      document.addEventListener("visibilitychange", onHidden);
      if (sourceDoc !== document) sourceDoc.addEventListener("visibilitychange", onHidden);
      const watch = outCanvas && outWin ? window.setInterval(() => {
        if (outWin.closed) stopTake();
      }, OUTPUT_WATCH_MS) : 0;
      // A reloaded output page replaces the canvas this stream came from.
      const pictureTrack = picture.getVideoTracks()[0];
      pictureTrack?.addEventListener("ended", onLost);

      const end = (): void => {
        source.removeEventListener("webglcontextlost", onLost);
        document.removeEventListener("visibilitychange", onHidden);
        try {
          sourceDoc.removeEventListener("visibilitychange", onHidden);
        } catch {
          // The output window is already gone.
        }
        if (watch) window.clearInterval(watch);
        pictureTrack?.removeEventListener("ended", onLost);
        for (const f of undo.splice(0).reverse()) f();
        session = null;
        deps.onChange();
      };

      recorder.start(RECORD_TIMESLICE_MS);
      session = { startMs: performance.now(), stop: stopTake };
    } catch (err) {
      fail(err instanceof Error && err.message ? `Could not start recording: ${err.message}` : "Could not start recording");
      return;
    }
    deps.onChange();
  }

  function stop(): void {
    session?.stop();
  }

  return {
    recording: () => session !== null,
    elapsedMs: () => (session ? performance.now() - session.startMs : 0),
    start,
    stop,
    toggle: () => (session ? stop() : start()),
  };
}
