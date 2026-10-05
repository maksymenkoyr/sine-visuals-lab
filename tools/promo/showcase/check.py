"""Audits a finished showcase video against its cut list: sync, repeated frames, contact sheets.

    uv run --with imageio-ffmpeg --with numpy --with pillow python tools/promo/showcase/check.py <showcase.json> sync   [v|h ...]
    uv run --with imageio-ffmpeg --with numpy --with pillow python tools/promo/showcase/check.py <showcase.json> repeats [v|h ...]
    uv run --with imageio-ffmpeg --with numpy --with pillow python tools/promo/showcase/check.py <showcase.json> strip <video> <t1,t2,..> <height> <columns> <out.png>

Inputs: the videos edit.py wrote (<work>/out/promo-<fmt>.mp4) and the cut list beside each (.mp4.json);
`sync` also reads the scene clips the cut list names. Formats default to both. Nothing is written
except the strip's PNG (put it in the work dir).

sync     Does each scene clip's own audio match the bed at its in-point? The clip's audio is what the app
         heard, already lag-corrected by the recorder, so in the finished video the bed under that clip
         should line up with it. For each scene piece it cross-correlates one second of the clip's audio
         with the same second of the video's audio and prints the offset in ms; anything beyond a frame
         or two means a cut is off the beat grid.
repeats  How much of each source reads as a repeated frame? Mean absolute difference between consecutive
         frames of the video at 160x90 (or 90x160); a pair under 0.05 counts as a repeat. A recording
         whose content updates below 60 fps (a screen recording, an app on a slow frame) shows up here,
         per source file, as a percentage of its pieces.
strip    A contact sheet of one video at the given times, each frame labelled with its time, to look at a
         cut or a camera move at a glance.
"""
import json, os, subprocess, sys
import imageio_ffmpeg, numpy as np
from PIL import Image, ImageDraw
import config

cfg = config.load(sys.argv[1])
cmd = sys.argv[2]
FF = imageio_ffmpeg.get_ffmpeg_exe()
fmts = (sys.argv[3:] or ["v", "h"]) if cmd != "strip" else []

def video(fmt):
    return config.p(cfg, f"out/promo-{fmt}.mp4")

def pcm(args):
    r = subprocess.run([FF, "-loglevel", "error"] + args + ["-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, np.int16).astype(float)

def sync(fmt):
    E = json.load(open(video(fmt) + ".json"))
    clips = config.p(cfg, cfg["clips"]["dir"])
    vt = 0
    for f, a, d in E["video"]:
        if os.path.dirname(f) == clips:
            c = pcm(["-ss", f"{a}", "-t", "1.0", "-i", f])
            b = pcm(["-ss", f"{vt}", "-t", "1.0", "-i", video(fmt)])
            n = min(len(c), len(b)); c, b = c[:n], b[:n]
            x = np.correlate(b - b.mean(), (c - c.mean())[200:-200], "valid"); lag = (np.argmax(x) - 200) / 8.0
            print(fmt, os.path.basename(f), f"v={vt:.2f} offset {lag:+.1f} ms")
        vt += d

def repeats(fmt):
    f = video(fmt); W, H = (90, 160) if fmt == "v" else (160, 90)
    raw = subprocess.run([FF, "-loglevel", "error", "-i", f, "-vf", f"scale={W}:{H},format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.int16); d = np.abs(np.diff(fr, axis=0)).mean(axis=(1, 2))
    E = json.load(open(f + ".json")); t = 0; res = {}
    for src, a, dur in E["video"]:
        i0, i1 = int(t * 60), int((t + dur) * 60); n = os.path.basename(src)
        seg = d[i0:i1 - 1]; r = res.setdefault(n, [0, 0]); r[0] += int((seg < 0.05).sum()); r[1] += len(seg); t += dur
    print(fmt, " ".join(f"{k}:{100 * v[0] / max(1, v[1]):.0f}%" for k, v in res.items()))

def strip(f, ts, h, cols, out):
    ims = []
    for t in ts:
        p = f"{out}.{t}.tmp.png"
        subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(t), "-i", f, "-frames:v", "1", "-vf", f"scale=-2:{h}", p], check=True)
        im = Image.open(p).convert("RGB"); os.remove(p)
        ImageDraw.Draw(im).text((6, 4), f"{t:.2f}", fill=(255, 255, 0)); ims.append(im)
    w = ims[0].width
    S = Image.new("RGB", (w * cols, h * ((len(ims) + cols - 1) // cols)))
    for k, i in enumerate(ims):
        S.paste(i, ((k % cols) * w, (k // cols) * h))
    S.save(out)

if cmd == "sync":
    for fmt in fmts: sync(fmt)
elif cmd == "repeats":
    for fmt in fmts: repeats(fmt)
elif cmd == "strip":
    strip(sys.argv[3], [float(x) for x in sys.argv[4].split(",")], int(sys.argv[5]), int(sys.argv[6]), sys.argv[7])
else:
    sys.exit(__doc__)
