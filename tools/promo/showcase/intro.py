"""Mic / screen-share intro from a screen recording of the app: one continuous shot per input.

    uv run --with pillow --with imageio-ffmpeg python tools/promo/showcase/intro.py <showcase.json> v|h

Input: config "intro" (the recording, its pixel size, the shots) and the recording itself, a screen
recording of the real app asking for the mic and for screen sharing.
Output: <work>/intro-<fmt>.mp4 plus intro-<fmt>.mp4.json {marks, dur}; edit.py reads the json for the
shot boundaries (caption timing) and the length.

Each shot is one stretch of the recording with a moving camera (eased crop keyframes in source pixels:
button -> pull back -> glide to the browser's prompt) and an eased speed curve: a smooth fast-forward
where nothing happens, and an ease-in/out slow-down around the final click (Allow / Share with audio).
The brief was camera moves instead of cuts and slow-downs instead of freezes. Each shot is rendered at
1x, motion-interpolated to 240 fps (smooth slow motion), then retimed along the speed curve.
Other windows' thumbnails in the share picker and the room badge are blurred before cropping (config
"intro.blur": time range + box, source pixels).
"""
import json, math, os, subprocess, sys, tempfile
import imageio_ffmpeg
from PIL import Image, ImageFilter
import config

cfg = config.load(sys.argv[1])
fmt = sys.argv[2]
I = cfg["intro"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H = config.size(fmt)
SW, SH = I["size"]
SRC = config.p(cfg, I["recording"])
OUT = config.p(cfg, f"intro-{fmt}.mp4")
os.makedirs(os.path.dirname(OUT), exist_ok=True)

BLUR = [(b["from"], b["to"], *b["box"]) for b in I["blur"]]
POINTS = {k: config.pick(v, fmt) for k, v in I["points"].items()}
SLOW_MIN = I["slow"]["min"]
SLOW_EXTRA = I["slow"]["extra"]

# (src0, src1, camera keys [(t, cx, cy, width, swell)], base speed keys [(t, speed)], click time)
# Between two camera keys the camera moves in one smootherstep glide; `swell` widens the crop mid-glide (a soft
# pull-back) without stopping, so button -> prompt is one continuous move.
SHOTS = []
for s in I["shots"]:
    cam = [(t, *POINTS[pt], config.pick(w, fmt), config.pick(sw, fmt)) for t, pt, w, sw in s["camera"]]
    SHOTS.append((s["src"][0], s["src"][1], cam, [tuple(k) for k in s["speed"]], s["click"]))

def ease(k):
    return k * k * (3 - 2 * k)

def interp(keys, t, n):
    if t <= keys[0][0]:
        return keys[0][1:1 + n]
    if t >= keys[-1][0]:
        return keys[-1][1:1 + n]
    for a, b in zip(keys, keys[1:]):
        if a[0] <= t <= b[0]:
            k = ease((t - a[0]) / (b[0] - a[0]))
            return tuple(a[j] + (b[j] - a[j]) * k for j in range(1, 1 + n))

def smoother(k):
    return k * k * k * (k * (6 * k - 15) + 10)

def cam_at(cam, t):
    if t <= cam[0][0]:
        return cam[0][1:4]
    if t >= cam[-1][0]:
        return cam[-1][1:4]
    for a, b in zip(cam, cam[1:]):
        if a[0] <= t <= b[0]:
            u = (t - a[0]) / (b[0] - a[0]); k = smoother(u)
            cx, cy, cw = (a[j] + (b[j] - a[j]) * k for j in (1, 2, 3))
            return cx, cy, cw + b[4] * math.sin(math.pi * u) ** 2

def rect(t, cam):
    cx, cy, cw = cam_at(cam, t)
    ch = cw * H / W
    if ch > SH:
        ch = SH; cw = ch * W / H
    if cw > SW:
        cw = SW; ch = cw * H / W
    x0 = min(max(cx - cw / 2, 0), SW - cw); y0 = min(max(cy - ch / 2, 0), SH - ch)
    return x0, y0, x0 + cw, y0 + ch

def retime(s0, s1, base, c):
    """Source times of the output frames: the base speed curve, slowed around the click by a cosine dip whose
    width is searched so the shot gains SLOW_EXTRA seconds over the plain base curve."""
    def speed(t, w):
        b = interp(base, t, 1)[0]
        if abs(t - c) < w:
            b *= 1 - (1 - SLOW_MIN) * 0.5 * (1 + math.cos(math.pi * (t - c) / w))
        return b
    def run(w):
        ts, t = [], s0
        while t < s1:
            ts.append(t); t += speed(t, w) / 60
        return ts
    plain = len(run(0.0))
    w = min((abs(len(run(x / 100)) - plain - SLOW_EXTRA * 60), x / 100) for x in range(10, 120))[1]
    return run(w)

def frames_1x(s0, s1, cam):
    n = round((s1 - s0) * 60)
    dec = subprocess.Popen([FF, "-loglevel", "error", "-ss", f"{s0:.3f}", "-i", SRC, "-t", f"{s1 - s0 + 0.2:.3f}",
                            "-vf", "fps=60,format=rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    for i in range(n):
        buf = dec.stdout.read(SW * SH * 3)
        if len(buf) < SW * SH * 3:
            break
        im = Image.frombytes("RGB", (SW, SH), buf)
        t = s0 + i / 60
        for b0, b1, x0, y0, x1, y1 in BLUR:
            if b0 <= t <= b1:
                box = (x0, y0, x1, y1)
                im.paste(im.crop(box).filter(ImageFilter.GaussianBlur(14)), box)
        yield im.resize((W, H), Image.LANCZOS, box=rect(t, cam)).tobytes()
    dec.kill()

enc = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "60", "-i", "-",
                        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
                        "-color_primaries", "bt709", "-color_trc", "bt709", OUT], stdin=subprocess.PIPE)
total, marks = 0, []
for s0, s1, cam, base, click in SHOTS:
    marks.append(total / 60)
    tmp = tempfile.mktemp(suffix=".mp4", dir=os.path.dirname(OUT))
    mid = subprocess.Popen([FF, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "60", "-i", "-",
                            "-c:v", "libx264", "-crf", "10", "-preset", "fast", "-pix_fmt", "yuv444p", tmp], stdin=subprocess.PIPE)
    for fr in frames_1x(s0, s1, cam):
        mid.stdin.write(fr)
    mid.stdin.close(); mid.wait()
    hi = subprocess.Popen([FF, "-loglevel", "error", "-i", tmp, "-vf",
                           "minterpolate=fps=240:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=rgb24",
                           "-f", "rawvideo", "-"], stdout=subprocess.PIPE)
    idx, cur = -1, None
    for t in retime(s0, s1, base, click):
        k = round((t - s0) * 240)
        while idx < k:
            buf = hi.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break
            cur, idx = buf, idx + 1
        enc.stdin.write(cur); total += 1
    hi.kill(); os.remove(tmp)
enc.stdin.close(); enc.wait()
marks.append(total / 60)
json.dump({"marks": marks, "dur": total / 60}, open(OUT + ".json", "w"))
print(OUT, total, "frames", f"{total / 60:.2f}s", [round(m, 3) for m in marks])
