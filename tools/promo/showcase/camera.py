"""Camera moves over the horizontal wiring take: eased crops of the 1.5x take rendered to 1920x1080.

    uv run --with pillow --with imageio-ffmpeg python tools/promo/showcase/camera.py <showcase.json>

Reads config "camera" and "wiring.h". Views are (centre x, centre y, crop width) in source pixels, keys
are (clip time, view); the crop is 16:9 and eased between keys. The keys were aimed from the take's
logged action times and boxes (the recorder's .log beside it): port, jack (cable drawn), strength,
threshold, monitors scrolled to Hits/Tempo/Character, then the scene's own settings.
Writes <work>/<wiring.h.cam>, which keeps the take's timebase and audio, so edit.py cuts it exactly
like the raw take.
"""
import os, subprocess, sys
import imageio_ffmpeg
from PIL import Image
import config

cfg = config.load(sys.argv[1])
FF = imageio_ffmpeg.get_ffmpeg_exe()
SRC, OUT = config.p(cfg, cfg["wiring"]["h"]["take"]), config.p(cfg, cfg["wiring"]["h"]["cam"])
SW, SH = cfg["camera"]["sourceSize"]
W, H = config.size("h")
VIEWS = cfg["camera"]["views"]
KEYS = [(t, *VIEWS[v]) for t, v in cfg["camera"]["keys"]]

def ease(k):
    return k * k * (3 - 2 * k)

def rect(t):
    for a, b in zip(KEYS, KEYS[1:]):
        if a[0] <= t <= b[0]:
            k = ease((t - a[0]) / (b[0] - a[0]))
            cx, cy, cw = (a[j] + (b[j] - a[j]) * k for j in (1, 2, 3))
            break
    else:
        cx, cy, cw = KEYS[-1][1:]
    ch = cw * H / W
    x0 = min(max(cx - cw / 2, 0), SW - cw); y0 = min(max(cy - ch / 2, 0), SH - ch)
    return x0, y0, x0 + cw, y0 + ch

os.makedirs(os.path.dirname(OUT), exist_ok=True)
dec = subprocess.Popen([FF, "-loglevel", "error", "-i", SRC, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
enc = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "60", "-i", "-",
                        "-i", SRC, "-map", "0:v", "-map", "1:a?", "-c:a", "copy",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
                        "-color_primaries", "bt709", "-color_trc", "bt709", OUT], stdin=subprocess.PIPE)
i = 0
while True:
    buf = dec.stdout.read(SW * SH * 3)
    if len(buf) < SW * SH * 3:
        break
    im = Image.frombytes("RGB", (SW, SH), buf)
    enc.stdin.write(im.resize((W, H), Image.LANCZOS, box=rect(i / 60)).tobytes())
    i += 1
enc.stdin.close(); enc.wait()
print(OUT, i, "frames")
