# Cuts several songs into one soundtrack on a single beat grid → <work>/song.wav + song.json, which the
# rest of the promo then treats as one song (the scene takes hear it, compose and encode cut by it).
#
#   uv run -q --with numpy --with soundfile python tools/promo/mix.py      (promo.mjs song runs this
#                                                                          when <work>/mix.json exists)
#
# <work>/mix.json, written by hand from each song's song.py reading:
#   { "bpm": 175,
#     "parts": [ { "file": "a.wav", "drop": 54.93, "bpm": 175.012, "at": 4 },
#                { "file": "b.wav", "drop": 64.21, "bpm": 174.026, "at": 36, "from": -4 }, … ] }
# A part's drop (seconds into its file) lands on video beat `at`; it comes in `from` beats before or after
# its drop (default 0) and plays until the next part comes in, so every switch is a hard cut on a beat.
# The first part also plays the lead-in before the video starts, which the app's analyser settles on.
# Each part is stretched to the grid's bpm (keeping its pitch), brought to one loudness, and the whole
# runs through a peak limiter. Songs a few bpm apart mix cleanly; a big stretch sounds wrong, so pick
# songs on one tempo.
import json, os, subprocess, tempfile
import numpy as np
import soundfile as sf

WORK = os.environ["PROMO_WORK"]
FF = os.environ.get("FFMPEG", "ffmpeg")
SR = 44100
LEAD = 48           # beats of the first part before video beat 0 (record.mjs needs a few bars of lead-in)
TAIL = 160          # beats the last part runs past its entry, longer than any video
TARGET_DB = -11.0   # each part's loudness (rms over its stretch in the video), before the limiter

mix = json.load(open(f"{WORK}/mix.json"))
P = 60.0 / mix["bpm"]
parts = mix["parts"]

def decode(path, t0, t1, tempo):
    # [t0, t1) of `path`, stretched by `tempo` without changing pitch, as float stereo at SR
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f: out = f.name
    subprocess.run([FF, "-y", "-loglevel", "error", "-ss", f"{max(0.0, t0):.5f}", "-t", f"{t1 - max(0.0, t0):.5f}", "-i", path,
                    "-af", f"atempo={tempo:.6f}", "-ac", "2", "-ar", str(SR), "-c:a", "pcm_f32le", out], check=True)
    y, _ = sf.read(out, dtype="float32", always_2d=True)
    os.unlink(out)
    return y

chunks, levels = [], []
starts = [-LEAD if i == 0 else p["at"] + p.get("from", 0) for i, p in enumerate(parts)]
for i, p in enumerate(parts):
    s = starts[i]
    e = starts[i + 1] if i + 1 < len(parts) else s + TAIL
    pb = 60.0 / p["bpm"]
    t0, t1 = p["drop"] + (s - p["at"]) * pb, p["drop"] + (e - p["at"]) * pb
    if t0 < 0: raise SystemExit(f"part {i + 1}: starts {-t0:.2f}s before its file does; give it a later `at` or `from`")
    y = decode(p["file"], t0, t1, mix["bpm"] / p["bpm"])   # atempo > 1 plays faster
    n = round((e - s) * P * SR)
    y = y[:n] if len(y) >= n else np.pad(y, ((0, n - len(y)), (0, 0)))
    if i + 1 == len(parts) and len(y) and not y[-SR:].any(): print(f"part {i + 1}: its file ends before the tail does")
    # loudness over the part's stretch inside the video (the first part's lead-in doesn't count)
    k0 = round((max(s, 0) - s) * P * SR)
    seg = y[k0:k0 + round(32 * P * SR)]
    rms = float(np.sqrt((seg ** 2).mean())) if len(seg) else 1.0
    gain = 10 ** ((TARGET_DB - 20 * np.log10(rms + 1e-9)) / 20)
    levels.append((i + 1, 20 * np.log10(rms + 1e-9)))
    y = y * gain
    ramp = min(len(y), round(0.004 * SR))   # 4 ms at each cut: no click, too short to hear as a fade
    if i > 0: y[:ramp] *= np.linspace(0, 1, ramp)[:, None]
    if i + 1 < len(parts): y[len(y) - ramp:] *= np.linspace(1, 0, ramp)[:, None]
    chunks.append(y)

raw = os.path.join(WORK, "mix.raw.wav")
sf.write(raw, np.concatenate(chunks), SR, subtype="FLOAT")
wav = os.path.join(WORK, "song.wav")
subprocess.run([FF, "-y", "-loglevel", "error", "-i", raw, "-af", "alimiter=limit=0.89:attack=2:release=60:level=false",
                "-c:a", "pcm_s16le", wav], check=True)
os.unlink(raw)
dur = sf.info(wav).duration
song = dict(file=wav, bpm=mix["bpm"], period=round(P, 6), phi=0.0, dropTime=round((LEAD + parts[0]["at"]) * P, 4),
            duration=round(dur, 1), mix=True)
json.dump(song, open(os.path.join(WORK, "song.json"), "w"), indent=1)
for k, db in levels: print(f"part {k}: {db:.1f} dB rms before matching")
print(json.dumps(song, indent=1))
