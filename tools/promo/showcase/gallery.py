"""Gallery → scene shot from a screen recording of the app, with a cursor-following zoom and the pointer erased.

    uv run --with imageio-ffmpeg --with opencv-python-headless --with scipy --with numpy python tools/promo/showcase/gallery.py <showcase.json> [h|v]

Input: config "gallery" and the recording; <work>/<gallery.track> from track_pointer.py.
Output: <work>/gallery-<fmt>.mp4 plus gallery-<fmt>.mp4.json {frames, dur} (edit.py reads the length
from it). Both formats unless one is named.

The brief: in the gallery view (no browser text) first zoom out to see the cursor, then start zooming in
on it along its movement. So the gallery part starts wide on the whole page (cropped under the browser
chrome and above the sharing bar / room badge) with the real pointer visible, then eases in while
following the pointer (the tracked track, exponentially smoothed so the camera lags it a little), until
the pointer clicks a scene's tile. The scene part opens at that same zoom and eases back out to the scene
framing (below its toolbar with the ROOM button); there the pointer is erased (inpainted) because it
would otherwise sit still on the picture. The camera is computed per 60 fps output frame on the nearest
source frame (motion interpolation tore the picture on fast pans), so camera moves are smooth and only
the page content repeats a frame.
"""
import json, math, os, subprocess, sys
import cv2, numpy as np, imageio_ffmpeg
from scipy.ndimage import binary_fill_holes
import config

cfg = config.load(sys.argv[1])
G = cfg["gallery"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
SW, SH = G["size"]
FPS = G["fps"]
REC = config.p(cfg, G["recording"])
PAGE, SCENE = tuple(G["page"]), tuple(G["scene"])   # crop areas without browser chrome / sharing bar / room badge
G0, G1 = G["galleryRange"]
S0, S1 = G["sceneRange"]
ZOOM_IN, ZOOM_OUT = G["zoomIn"], G["zoomOut"]       # gallery zoom-in window, scene ease back out
WIN = tuple(G["pointerRest"])                       # where the pointer rests on the scene, for erasing
TAU = G["followTau"]

track = json.load(open(config.p(cfg, G["track"])))  # [t, x, y, score, template]

def smoother(k):
    k = min(max(k, 0.0), 1.0)
    return k * k * k * (k * (6 * k - 15) + 10)

def cursor_smoothed(t, tau=TAU):
    """Exponentially smoothed pointer position (camera lag) at source time t."""
    sx = sy = None
    for tt, x, y, *_ in track:
        if tt > t:
            break
        if sx is None:
            sx, sy = x, y
        else:
            a = 1 - math.exp(-(1 / FPS) / tau)
            sx += (x - sx) * a; sy += (y - sy) * a
    return sx, sy

def fit(cx, cy, cw, W, H, box):
    bx0, by0, bx1, by1 = box
    ch = cw * H / W
    if ch > by1 - by0:
        ch = by1 - by0; cw = ch * W / H
    if cw > bx1 - bx0:
        cw = bx1 - bx0; ch = cw * H / W
    x0 = min(max(cx - cw / 2, bx0), bx1 - cw); y0 = min(max(cy - ch / 2, by0), by1 - ch)
    return x0, y0, cw, ch

def gallery_rect(t, W, H, fmt):
    z = smoother((t - ZOOM_IN[0]) / (ZOOM_IN[1] - ZOOM_IN[0]))
    wide_w = PAGE[2] - PAGE[0] if fmt == "h" else (PAGE[3] - PAGE[1]) * W / H
    tight_w = G["tightWidth"][fmt]
    cx, cy = cursor_smoothed(t)
    pcx, pcy = (PAGE[0] + PAGE[2]) / 2, (PAGE[1] + PAGE[3]) / 2
    if fmt == "h":
        cx, cy = pcx + (cx - pcx) * z, pcy + (cy - pcy) * z
    else:
        cy = pcy + (cy - pcy) * z
    if t > ZOOM_IN[1]:
        tight_w *= 1 - G["slowPush"] * smoother((t - ZOOM_IN[1]) / (G1 - ZOOM_IN[1]))  # slow push until the click
    return fit(cx, cy, wide_w + (tight_w - wide_w) * z, W, H, PAGE)

def scene_rect(t, W, H, fmt, start):
    z = smoother((t - ZOOM_OUT[0]) / (ZOOM_OUT[1] - ZOOM_OUT[0]))
    full_w = SCENE[2] - SCENE[0] if fmt == "h" else (SCENE[3] - SCENE[1]) * W / H
    x0, y0, cw, ch = start
    sx, sy = x0 + cw / 2, y0 + ch / 2
    fx, fy = (SCENE[0] + SCENE[2]) / 2, (SCENE[1] + SCENE[3]) / 2
    return fit(sx + (fx - sx) * z, sy + (fy - sy) * z, cw + (full_w - cw) * z, W, H, SCENE)

def erase(fr):
    x0, y0, x1, y1 = WIN
    win = fr[y0:y1, x0:x1]
    white = (win > 215).all(axis=2)
    if white.sum() < 15:
        return
    m = binary_fill_holes(cv2.dilate(white.astype(np.uint8), np.ones((3, 3), np.uint8))).astype(np.uint8)
    m = cv2.dilate(m, np.ones((7, 7), np.uint8))
    fr[y0:y1, x0:x1] = cv2.inpaint(np.ascontiguousarray(win), m * 255, 7, cv2.INPAINT_TELEA)

def frames(t0, t1):
    dec = subprocess.Popen([FF, "-loglevel", "error", "-ss", f"{t0}", "-t", f"{t1 - t0}", "-i", REC,
                            "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    i = 0
    while True:
        buf = dec.stdout.read(SW * SH * 3)
        if len(buf) < SW * SH * 3:
            return
        yield t0 + i / FPS, np.frombuffer(buf, np.uint8).reshape(SH, SW, 3).copy()
        i += 1

def crop(fr, r, W, H):
    x0, y0, cw, ch = r
    M = np.float32([[W / cw, 0, -x0 * W / cw], [0, H / ch, -y0 * H / ch]])  # subpixel crop + scale
    return cv2.warpAffine(fr, M, (W, H), flags=cv2.INTER_LANCZOS4)

fmts = [sys.argv[2]] if len(sys.argv) > 2 else ["h", "v"]
for fmt in fmts:
    W, H = config.size(fmt)
    out = config.p(cfg, f"gallery-{fmt}.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    enc = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}",
                            "-r", "60", "-i", "-", "-vf", "format=yuv420p",
                            "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-colorspace", "bt709", "-color_primaries", "bt709",
                            "-color_trc", "bt709", out], stdin=subprocess.PIPE)
    def at60(t0, t1, fix=None):
        """(output time, nearest source frame) at 60 fps over [t0, t1)."""
        src = frames(t0, t1); cur = next(src); nxt = next(src, None)
        for k in range(round((t1 - t0) * 60)):
            t = t0 + k / 60
            while nxt is not None and abs(nxt[0] - t) <= abs(cur[0] - t):
                cur, nxt = nxt, next(src, None)
                if fix: fix(cur[1])
            yield t, cur[1]
    n, last = 0, None
    for t, fr in at60(G0, G1):
        last = gallery_rect(t, W, H, fmt)
        enc.stdin.write(crop(fr, last, W, H).tobytes()); n += 1
    start = last
    first = [True]
    for t, fr in at60(S0, S1, erase):
        if first[0]:
            erase(fr); first[0] = False
        enc.stdin.write(crop(fr, scene_rect(t, W, H, fmt, start), W, H).tobytes()); n += 1
    enc.stdin.close(); enc.wait()
    json.dump({"frames": n, "dur": n / 60}, open(out + ".json", "w"))
    print(fmt, "done", out, n, "frames")
