"""Cuts the showcase promo from captured clips and a bed song: one timeline, two formats.

    uv run --with imageio-ffmpeg --with pyloudnorm --with soundfile python tools/promo/showcase/edit.py <showcase.json> v|h [--no-audio] [--out X.mp4]

Writes <work>/out/promo-<fmt>.mp4 (v = 1080x1920, h = 1920x1080) and X.mp4.json beside it: the cut list
{total, bed_len, video: [file, in, dur], audio: [song, start, dur], captions} that check.py reads.

The showcase pipeline, every piece reading one config (showcase.example.json is the schema, a copy of it
with real values lives in the work dir, default tools/.cache/showcase/, gitignored; nothing here ever
commits media):

  1. the recorder (tools/promo/capture.mjs and the shots/ scripts) writes scene clips, a few windows of
     songs, and wiring takes into the work dir (or wherever the config's "clips" and "wiring" point);
  2. intro.py      camera-move intro (mic + screen-share prompts) from a screen recording;
  3. track_pointer.py + gallery.py   gallery → scene shot from a screen recording, pointer-following zoom;
  4. camera.py     camera moves over the horizontal wiring take;
  5. captions.mjs  caption overlays and the end card (PNGs);
  6. this file     the cut, the captions, the bed audio and the shuffle; check.py then audits it
     (clip audio against the bed, repeated frames, contact sheets).

How the cut is built. Every scene clip covers a window of its song (clip t=0 == song time of its
"clips.windows" entry), already shifted for the app's reaction lag by the recorder, so a piece cut from
it at song time s is in sync with the bed when the bed plays the same song at s. UI jump cuts skip whole
beats of the bed (config "bed.bpm") so the kicks in the picture stay on the kicks in the audio.
The timeline: intro shots, the gallery shot, the drop (shots of whole or half bars starting at the bed's
drop time), the wiring (starts where the drop ends, keeps the beat grid), then the shuffle (each shot
starts on a strong bass hit of its own song) and the end card. Songs are loudness-matched to
"loudnessLufs" (integrated LUFS of the whole file) so the shuffle does not jump; the bed fades in, the
last shuffle song runs through the end card with no fade (a short click guard only), and a limiter
catches the peaks.
"""
import json, os, subprocess, sys
import imageio_ffmpeg, soundfile as sf, pyloudnorm as pyln
import config

cfg = config.load(sys.argv[1])
fmt = sys.argv[2]
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H = config.size(fmt)
NOAUDIO = "--no-audio" in sys.argv
OUT = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else config.p(cfg, f"out/promo-{fmt}.mp4")
CAPS = config.p(cfg, "caps") + "/"
SONGS = {k: config.p(cfg, v) for k, v in cfg["songs"].items()}

BED = cfg["bed"]
BEAT = 60 / BED["bpm"]
BAR = 4 * BEAT
DROP = BED["drop"]  # song time where the bass enters, on the beat grid

def clip(name):
    return f"{config.p(cfg, cfg['clips']['dir'])}/{name}-{fmt}.mp4"

WIN = cfg["clips"]["windows"]  # song time at clip t=0

# --- video pieces: (file, in, dur)
V = []
# 1. the intro: the recording's camera-move shots (mic prompt, screen-share picker), intro.py
_im = json.load(open(config.p(cfg, f"intro-{fmt}.mp4.json")))
INTRO_ZOOM, MARKS = _im["dur"], _im["marks"]  # MARKS: where each intro shot starts, and the end
V.append((config.p(cfg, f"intro-{fmt}.mp4"), 0, INTRO_ZOOM))
# 2. the gallery recording → a scene (pointer erased), gallery.py
GAL_DUR = json.load(open(config.p(cfg, f"gallery-{fmt}.mp4.json")))["dur"]
V.append((config.p(cfg, f"gallery-{fmt}.mp4"), 0, GAL_DUR))
INTRO = INTRO_ZOOM + GAL_DUR
# 3. the drop: shots of whole or half bars, each cut at the song time the drop has reached
s = DROP
for name, bars in cfg["drop"]["shots"]:
    d = bars * BAR
    V.append((clip(name), s - WIN[name], d))
    s += d
drop_bars = sum(bars for _, bars in cfg["drop"]["shots"])
assert abs(s - (DROP + drop_bars * BAR)) < 1e-6
# 4. wiring: song time T0 at take t=0, from the drop's end, on the beat grid. Horizontal is one camera-moved
# take (camera.py); vertical cuts between two takes by (column, from beat, to beat).
WR = cfg["wiring"]
w0 = s - WR["t0"]
if fmt == "h":
    V.append((config.p(cfg, WR["h"]["cam"]), w0, WR["beats"] * BEAT))
else:
    beat = lambda k: w0 + k * BEAT
    for col, k0, k1 in WR["v"]["plan"]:
        V.append((config.p(cfg, WR["v"]["takes"][col]), beat(k0), beat(k1) - beat(k0)))
bed_len = sum(d for _, _, d in V)
# 5. shuffle: each shot starts on a strong bass hit of its own song
SHOT = cfg["shuffle"]["shot"]
END = cfg["end"]["length"]
shuffle = [tuple(x) for x in cfg["shuffle"]["shots"]]
for name, _, st in shuffle:
    V.append((clip(name), st - WIN[name], SHOT))
total = sum(d for _, _, d in V) + END

# --- audio pieces: (song, start, dur)
A = [(BED["song"], DROP - INTRO, bed_len)] + [(sid, st, SHOT) for _, sid, st in shuffle]
A[-1] = (A[-1][0], A[-1][1], SHOT + END)

# loudness match songs (integrated LUFS of the whole stereo file)
gain = {}
for sid in {a[0] for a in A}:
    data, rate = sf.read(SONGS[sid])
    gain[sid] = cfg["loudnessLufs"] - pyln.Meter(rate).integrated_loudness(data)

# --- captions: (id, from, to), timed on anchors of the timeline
ANCHORS = {"start": 0.0, "introCut": MARKS[1], "introEnd": MARKS[2], "galleryEnd": INTRO,
           "wiringStart": INTRO + drop_bars * BAR, "shuffleStart": bed_len}
C = [(c["id"], ANCHORS[c["from"][0]] + c["from"][1], ANCHORS[c["to"][0]] + c["to"][1]) for c in cfg["captions"]["items"]]
FADE = {c["id"]: c["fade"] for c in cfg["captions"]["items"]}

args = [FF, "-y", "-loglevel", "error"]
fl = []
n = 0
vlabels = []
for i, (f, a, d) in enumerate(V):
    args += ["-ss", f"{a:.4f}", "-t", f"{d:.4f}", "-i", f]
    extra = ""
    if i == len(V) - 1:
        extra = f",fade=out:st={d - 0.25:.3f}:d=0.25"
    fl.append(f"[{n}:v]setpts=PTS-STARTPTS,fps=60,scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,format=yuv420p,trim=duration={d:.4f}{extra}[v{i}]")
    vlabels.append(f"[v{i}]")
    n += 1
args += ["-loop", "1", "-framerate", "60", "-t", f"{END}", "-i", f"{CAPS}end-{fmt}.png"]
fl.append(f"[{n}:v]scale={W}:{H},setsar=1,format=yuv420p,fade=in:st=0:d=0.3[vend]")
vlabels.append("[vend]")
n += 1
fl.append(f"{''.join(vlabels)}concat=n={len(vlabels)}:v=1:a=0[vcat]")
last = "vcat"
for k, (cid, a, b) in enumerate(C):
    args += ["-loop", "1", "-framerate", "60", "-t", f"{total:.3f}", "-i", f"{CAPS}{cid}-{fmt}.png"]
    fd = FADE[cid]
    fl.append(f"[{n}:v]format=rgba,fade=in:st={a}:d={fd}:alpha=1,fade=out:st={b - fd:.3f}:d={fd}:alpha=1[c{k}]")
    fl.append(f"[{last}][c{k}]overlay=0:0:enable='between(t,{a},{b})'[o{k}]")
    last = f"o{k}"
    n += 1
maps = ["-map", f"[{last}]"]
if not NOAUDIO:
    alabels = []
    for j, (sid, st, d) in enumerate(A):
        args += ["-ss", f"{st:.4f}", "-t", f"{d:.4f}", "-i", SONGS[sid]]
        fo = 0.03 if j == len(A) - 1 else 0.008  # no fade at the end, just a click guard
        fi = 0.25 if j == 0 else 0.004
        fl.append(f"[{n}:a]asetpts=PTS-STARTPTS,volume={gain[sid]:.2f}dB,afade=in:d={fi},afade=out:st={d - fo:.4f}:d={fo}[a{j}]")
        alabels.append(f"[a{j}]")
        n += 1
    fl.append(f"{''.join(alabels)}concat=n={len(alabels)}:v=0:a=1,alimiter=limit=0.89[aout]")
    maps += ["-map", "[aout]", "-c:a", "aac", "-b:a", "320k", "-ar", "48000"]
args += ["-filter_complex", ";".join(fl)] + maps + [
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", "60",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-movflags", "+faststart", "-t", f"{total:.3f}", OUT]
os.makedirs(os.path.dirname(OUT), exist_ok=True)
subprocess.run(args, check=True)
json.dump({"total": total, "bed_len": bed_len, "video": V, "audio": A, "captions": C}, open(OUT + ".json", "w"), indent=1)
print(OUT, f"{total:.2f}s")
