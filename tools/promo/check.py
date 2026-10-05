"""Audits a finished promo video against its cut list: sync, repeated frames, loudness, length, safe band, contact sheets.

    uv run -q --with imageio-ffmpeg==0.6.0 --with numpy --with pillow==12.3.0 python tools/promo/check.py --work DIR sync|repeats|loud|length|safe|takes ... [fmt ...]   (several commands in one call)
    uv run -q --with imageio-ffmpeg==0.6.0 --with numpy --with pillow==12.3.0 python tools/promo/check.py --work DIR strip <video> <t1,t2,..> <height> <columns> <out.png>

Reads <work>/cuts.json (which video, its renderer, fps, formats) and the videos the renderer wrote
(<work>/out/<video>-<fmt>.mp4; the graph renderer's cut list sits beside each as .mp4.json). Formats default
to the video's own, from the cuts. Nothing is written except the strip's PNG (put it in the work dir).
PASS is a command that prints no line starting with WARN; a WARN names what to fix.

sync     Does each scene piece's own audio match the bed at its in-point? Graph video: the clip's audio is
         what the app heard, already lag-corrected by the recorder, so in the finished video the bed under
         that clip should line up with it. For each clip piece it cross-correlates one second of the clip's
         audio with the same second of the video's audio and prints the offset in ms; anything beyond a
         frame or two means a cut is off the beat grid. Frames video: runs motion.py (picture motion
         against the song's onsets) on each take in the cuts that heard the song (frames.json has songT0).
repeats  How much of each source reads as a repeated frame? Mean absolute difference between consecutive
         frames of the video at 160x90 (or 90x160); a pair under REPEAT_BELOW counts as a repeat. A recording
         whose content updates below the video's fps (a screen recording, an app on a slow frame) shows up
         here, per source, as a percentage of its pieces.
loud     Integrated loudness and true peak of each output (ffmpeg ebur128); WARN when the true peak is
         above PEAK_MAX_DBTP, where the encode's AAC can clip.
length   The video's total length against style.json videos.<video>.maxSec; WARN when over.
safe     Only for videos whose style.json safeBand is true: every caption and title layer's visible
         pixels (alpha bounding box, at the layer's y) must lie inside storiesBand; WARN names the file.
         Other layers (cards, the list) are not checked.
takes    motion.py on every take in the cuts that has a frames.json, song-fed or synthetic (sync's
         frames mode measures only the song-fed ones).
strip    A contact sheet of one video at the given times, each frame labelled with its time, to look at a
         cut or a camera move at a glance.
"""
import json, os, re, subprocess, sys
import imageio_ffmpeg, numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPEAT_BELOW = 0.05  # mean grey-level change between frames under which a pair counts as a repeat
PEAK_MAX_DBTP = -1.0
MOTION_AFTER_DROP = 3  # beats after the drop where motion.py starts reading a take
MOTION_DEPS = ["--with", "numpy", "--with", "pillow==12.3.0", "--with", "librosa"]

args = sys.argv[1:]
WORK = os.path.abspath(args[args.index("--work") + 1])
args = [a for i, a in enumerate(args) if a != "--work" and (i == 0 or args[i - 1] != "--work")]
COMMANDS = ("sync", "repeats", "loud", "length", "safe", "takes", "strip")
cmds = [a for a in args if a in COMMANDS] if "strip" not in args else ["strip"]
args = [a for a in args if a not in COMMANDS] if "strip" not in args else args[1:]
CUTS = json.load(open(f"{WORK}/cuts.json"))
STYLE = json.load(open(f"{HERE}/style.json"))
VIDEO = CUTS["video"]
FPS = CUTS["fps"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
fmts = args or CUTS["formats"]

def video(fmt):
    return f"{WORK}/out/{VIDEO}-{fmt}.mp4"

def pcm(a):
    r = subprocess.run([FF, "-loglevel", "error"] + a + ["-ac", "1", "-ar", "8000", "-f", "s16le", "-"], capture_output=True, check=True)
    return np.frombuffer(r.stdout, np.int16).astype(float)

def pieces(fmt):
    """(source, start s, dur s) of each piece of the video, from the cut list beside it or the cuts."""
    if CUTS["renderer"] == "graph":
        return [tuple(x) for x in json.load(open(video(fmt) + ".json"))["video"]]
    beat = 60.0 / CUTS["song"]["bpm"]
    return [(s["take"], s["start"] * beat, s["beats"] * beat) for s in CUTS["frames"]["segments"]]

def sync(fmt):
    clips = os.path.dirname(pieces(fmt)[-1][0])  # the clips dir: the last piece is a shuffle clip
    vt = 0
    for f, a, d in pieces(fmt):
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
    t = 0; res = {}
    for src, a, dur in pieces(fmt):
        i0, i1 = int(t * FPS), int((t + dur) * FPS); n = os.path.basename(src)
        seg = d[i0:i1 - 1]; r = res.setdefault(n, [0, 0]); r[0] += int((seg < REPEAT_BELOW).sum()); r[1] += len(seg); t += dur
    print(fmt, " ".join(f"{k}:{100 * v[0] / max(1, v[1]):.0f}%" for k, v in res.items()))

def loud(fmt):
    r = subprocess.run([FF, "-hide_banner", "-nostats", "-i", video(fmt), "-af", "ebur128=peak=true", "-f", "null", "-"], capture_output=True, text=True)
    summary = r.stderr[r.stderr.rindex("Summary:"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", summary).group(1))
    peak = float(re.search(r"Peak:\s+(-?[\d.]+) dBFS", summary).group(1))
    print(fmt, f"integrated {lufs:.1f} LUFS, true peak {peak:.1f} dBTP", f"WARN true peak above {PEAK_MAX_DBTP} dBTP" if peak > PEAK_MAX_DBTP else "")

def total(fmt):
    if CUTS["renderer"] == "graph":
        return CUTS["graph"][fmt]["total"]
    return CUTS["frames"]["nFrames"] / FPS

def length(fmt):
    mx = STYLE["videos"][VIDEO]["maxSec"]
    t = total(fmt)
    print(fmt, f"{t:.2f} s", "" if mx is None else f"of at most {mx} s", f"WARN over maxSec {mx}" if mx is not None and t > mx else "")

def safe(fmt):
    if not STYLE["videos"][VIDEO]["safeBand"]:
        print(fmt, "no safe band for this video"); return
    band = STYLE["storiesBand"]; top, bot = band["topPx"], band["bottomPx"]
    bad = 0
    for seg in CUTS["frames"]["segments"]:
        for L in seg["layers"]:
            if L["op"] not in ("caption", "title"):
                continue
            for key in ("png", "prev"):
                if L.get(key) is None:
                    continue
                im = Image.open(f"{WORK}/cards/{L[key]}").convert("RGBA")
                bb = im.getchannel("A").getbbox()
                if bb is None:
                    continue
                if L["op"] == "title": y = 0
                elif L.get("y") is not None: y = L["y"]
                else: y = L["bottom"] - json.load(open(f"{WORK}/cards/meta.json"))["cap"]["h"]
                if y + bb[1] < top or y + bb[3] > bot:
                    bad += 1
                    print(fmt, f"WARN {L[key]} visible rows {y + bb[1]}..{y + bb[3]} outside the Stories band {top}..{bot}")
    if not bad:
        print(fmt, f"captions and titles inside the Stories band {top}..{bot}")

def motion(song_only):
    if CUTS["renderer"] != "frames":
        print("no takes in a graph video"); return
    seen = []
    for seg in CUTS["frames"]["segments"]:
        t = seg["take"]
        if t in seen or seg["backdrop"] == "devices":
            continue
        seen.append(t)
    names = []
    for t in seen:
        fj = f"{WORK}/takes/{t}/frames.json"
        if not os.path.exists(fj):
            continue
        has = json.load(open(fj))["meta"].get("songT0") is not None
        if has or not song_only:
            names.append(t)
    if not names:
        print("no takes to measure"); return
    frm = CUTS["dropBeat"] + MOTION_AFTER_DROP
    env = dict(os.environ, PROMO_WORK=WORK)
    subprocess.run(["uv", "run", "-q"] + MOTION_DEPS + ["python", f"{HERE}/motion.py"] + names + ["--from", str(frm)], env=env, check=True)

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

if not cmds:
    sys.exit(__doc__)
for cmd in cmds:
    if cmd == "sync":
        if CUTS["renderer"] == "frames": motion(True)
        else:
            for fmt in fmts: sync(fmt)
    elif cmd == "repeats":
        for fmt in fmts: repeats(fmt)
    elif cmd == "loud":
        for fmt in fmts: loud(fmt)
    elif cmd == "length":
        for fmt in fmts: length(fmt)
    elif cmd == "safe":
        for fmt in fmts: safe(fmt)
    elif cmd == "takes":
        motion(False)
    elif cmd == "strip":
        strip(args[0], [float(x) for x in args[1].split(",")], int(args[2]), int(args[3]), args[4])
