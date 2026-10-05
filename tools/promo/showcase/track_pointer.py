"""Finds the macOS pointer in every frame of the gallery recording → <work>/track.json.

    uv run --with imageio-ffmpeg --with opencv-python-headless --with scipy --with numpy python tools/promo/showcase/track_pointer.py <showcase.json>

Input: config "gallery" (the recording, its size and fps, "tracking": template frames, search box,
last second to scan). Output: <work>/<gallery.track> = [[t, x, y, score, template], ...] per source frame,
which gallery.py follows with its camera.

How: a pointer template is cut from a recording frame where the pointer sits over plain page (the white
arrow, filled and masked so only the arrow's own pixels count), then matched against every frame's search
box with masked normalised template matching; the better of the templates wins. A template needs a frame
where the pointer is clear of everything else, so config lists a few: [at (s), pointer x, pointer y]; the
cut is the 80x80 px around that spot. Run it once per recording (it decodes every frame, slow).
"""
import json, os, subprocess, sys, tempfile
import cv2, numpy as np, imageio_ffmpeg
from scipy.ndimage import binary_fill_holes
import config

cfg = config.load(sys.argv[1])
G = cfg["gallery"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
SW, SH = G["size"]
REC = config.p(cfg, G["recording"])
fps = G["fps"]

def still(at):
    f = tempfile.mktemp(suffix=".png")
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(at), "-i", REC, "-frames:v", "1", f], check=True)
    im = cv2.imread(f); os.remove(f)
    return im

def tmpl(at, x, y):
    im = still(at)[y - 30:y + 50, x - 30:x + 50]
    white = (im > 215).all(axis=2)
    m = binary_fill_holes(cv2.dilate(white.astype(np.uint8), np.ones((3, 3), np.uint8))).astype(np.uint8)
    ys, xs = np.nonzero(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return cv2.cvtColor(im[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY), (m[y0:y1, x0:x1] * 255).astype(np.uint8)

T = [tmpl(t["at"], t["x"], t["y"]) for t in G["tracking"]["templates"]]
print("template sizes", [t[0].shape for t in T])
X0, Y0, X1, Y1 = G["tracking"]["search"]
dec = subprocess.Popen([FF, "-loglevel", "error", "-t", f"{G['tracking']['until']:.2f}", "-i", REC, "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
out = []; i = 0
while True:
    b = dec.stdout.read(SW * SH * 3)
    if len(b) < SW * SH * 3:
        break
    g = cv2.cvtColor(np.frombuffer(b, np.uint8).reshape(SH, SW, 3)[Y0:Y1, X0:X1], cv2.COLOR_BGR2GRAY)
    best = None
    for k, (t, m) in enumerate(T):
        r = cv2.matchTemplate(g, t, cv2.TM_SQDIFF_NORMED, mask=m)
        r[~np.isfinite(r)] = 9
        _, _, loc, _ = cv2.minMaxLoc(r); v = r[loc[1], loc[0]]
        if best is None or v < best[0]:
            best = (v, loc[0] + X0 + t.shape[1] // 2, loc[1] + Y0 + t.shape[0] // 2, k)
    out.append([round(i / fps, 3), int(best[1]), int(best[2]), round(float(best[0]), 4), best[3]]); i += 1
dest = config.p(cfg, G["track"])
os.makedirs(os.path.dirname(dest), exist_ok=True)
json.dump(out, open(dest, "w"))
for r in out[::8]:
    print(r)
print(dest, len(out), "frames")
