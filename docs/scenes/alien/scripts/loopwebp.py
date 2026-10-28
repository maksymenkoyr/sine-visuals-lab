# uv run -q --with pillow python loopwebp.py <framesDir> <outDir>
# Each loop<n>/ folder loopframes.mjs wrote → <outDir>/loop<n>.webp, an
# endless animation at the clip's captured speed (info.json's seconds).
# No ffmpeg needed (Homebrew's was broken on 2026-10-26).
import sys, json, glob, os
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
info = json.load(open(os.path.join(src, "info.json")))
for d in sorted(glob.glob(os.path.join(src, "loop*"))):
    if not os.path.isdir(d):
        continue
    n = int(os.path.basename(d)[4:])
    frames = [Image.open(p).convert("RGB") for p in sorted(glob.glob(os.path.join(d, "f*.png")))]
    ms = round(info["loops"][n]["seconds"] * 1000 / len(frames))
    path = os.path.join(out, f"loop{n}.webp")
    frames[0].save(path, save_all=True, append_images=frames[1:], duration=ms, loop=0, quality=72, method=6)
    print(path, info["loops"][n]["clip"], len(frames), "frames", ms, "ms", os.path.getsize(path) // 1024, "kB")
