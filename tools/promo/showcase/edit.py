"""Renders the showcase promo from the resolved cut list and the captured clips: one timeline, two formats.

    uv run -q --with imageio-ffmpeg==0.6.0 --with pyloudnorm --with soundfile python tools/promo/showcase/edit.py --work DIR v|h [--no-audio] [--out X.mp4] [--print-args]

Reads <work>/cuts.json (graph section: written by shapes/explainer.py from <work>/showcase.json, which
promo.mjs plan runs) and writes <work>/out/explainer-<fmt>.mp4 (v = 1080x1920, h = 1920x1080) and X.mp4.json
beside it: the cut list {total, bed_len, video: [file, in, dur], audio: [song, start, dur], captions}
that check.py reads. --print-args prints the ffmpeg argument list as JSON and stops before encoding.

The showcase pipeline, every piece reading one config (showcase.example.json is the schema, a copy of it
with real values lives in the work dir; nothing here ever commits media):

  1. the recorder (tools/promo/capture.mjs and the shots/ scripts) writes scene clips, a few windows of
     songs, and wiring takes into the work dir (or wherever the config's "clips" and "wiring" point);
  2. intro.py      camera-move intro (mic + screen-share prompts) from a screen recording;
  3. track_pointer.py + gallery.py   gallery -> scene shot from a screen recording, pointer-following zoom;
  4. camera.py     camera moves over the horizontal wiring take;
  5. cards.mjs     caption overlays and the end card (PNGs), through cards/explainer.mjs;
  6. shapes/explainer.py   the cut: which piece of which clip or song plays when, and the caption times;
  7. this file     the encode: the pieces, the captions, the bed audio and the shuffle; check.py then audits
     it (clip audio against the bed, repeated frames, loudness, contact sheets).

How the cut is built (in shapes/explainer.py). Every scene clip covers a window of its song (clip t=0 ==
song time of its "clips.windows" entry), already shifted for the app's reaction lag by the recorder, so a
piece cut from it at song time s is in sync with the bed when the bed plays the same song at s. UI jump
cuts skip whole beats of the bed (config "bed.bpm") so the kicks in the picture stay on the kicks in the
audio. The timeline: intro shots, the gallery shot, the drop (shots of whole or half bars starting at the
bed's drop time), the wiring (starts where the drop ends, keeps the beat grid), then the shuffle (each shot
starts on a strong bass hit of its own song) and the end card. Songs are loudness-matched to the cuts'
loudnessLufs (integrated LUFS of the whole file) so the shuffle does not jump; the bed fades in, the last
shuffle song runs through the end card with no fade (a short click guard only), and a limiter catches the
peaks.
"""
import json, os, subprocess, sys
import imageio_ffmpeg, soundfile as sf, pyloudnorm as pyln

argv = sys.argv[1:]
WORK = os.path.abspath(argv[argv.index("--work") + 1])
fmt = [a for i, a in enumerate(argv) if a in ("v", "h") and argv[i - 1] != "--work"][0]
cuts = json.load(open(f"{WORK}/cuts.json"))
g = cuts["graph"]
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H = (1080, 1920) if fmt == "v" else (1920, 1080)
NOAUDIO = "--no-audio" in argv
OUT = argv[argv.index("--out") + 1] if "--out" in argv else f"{WORK}/out/explainer-{fmt}.mp4"
CAPS = g["caps"] + "/"
SONGS = g["songs"]

# --- the cut, resolved by shapes/explainer.py: video (file, in, dur), audio (song, start, dur), captions (id, from, to)
V = [tuple(x) for x in g[fmt]["V"]]
A = [tuple(x) for x in g[fmt]["A"]]
C = [tuple(x) for x in g[fmt]["C"]]
FADE = g[fmt]["FADE"]
END = g[fmt]["END"]
bed_len = g[fmt]["bed_len"]
total = g[fmt]["total"]

# loudness match songs (integrated LUFS of the whole stereo file)
gain = {}
for sid in {a[0] for a in A}:
    data, rate = sf.read(SONGS[sid])
    gain[sid] = g["loudnessLufs"] - pyln.Meter(rate).integrated_loudness(data)

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
if "--print-args" in argv:
    print(json.dumps(args, indent=1))
    sys.exit(0)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
subprocess.run(args, check=True)
json.dump({"total": total, "bed_len": bed_len, "video": V, "audio": A, "captions": C}, open(OUT + ".json", "w"), indent=1)
print(OUT, f"{total:.2f}s")
