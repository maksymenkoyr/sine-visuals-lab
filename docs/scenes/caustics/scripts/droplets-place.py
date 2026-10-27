# Where Droplets' drops sit, from single frames shot with Beat flash and Level glow at 0 (the pool then stays saturated pink and
# purple): drop pixels are the unsaturated light ones, and each scores the brightest non-drop pixel within RADIUS as a percentile
# of the frame's non-drop pixels. Prints the share beside the brightest fifth and tenth.
# uv run -q --with pillow --with numpy python docs/scenes/caustics/scripts/droplets-place.py <png>...
import sys
import numpy as np
from PIL import Image

RADIUS = 3
allv = []
for path in sys.argv[1:]:
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    h, w, _ = im.shape
    mx = im.max(axis=2)
    mn = im.min(axis=2)
    drop = (mn > 40) & ((mx - mn) < 0.35 * mx)
    drop[:60, :] = False  # the top bar
    drop[-60:, :] = False  # the bottom bar
    luma = im @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    pool = np.where(drop, -1.0, luma)
    srt = np.sort(pool[pool >= 0])
    pad = np.pad(pool, RADIUS, mode="edge")
    near = np.full_like(pool, -1.0)
    for dy in range(-RADIUS, RADIUS + 1):
        for dx in range(-RADIUS, RADIUS + 1):
            near = np.maximum(near, pad[RADIUS + dy : RADIUS + dy + h, RADIUS + dx : RADIUS + dx + w])
    s = np.searchsorted(srt, near[drop]) / max(1, srt.size)
    allv.append(s)
    print(f"{path}: {drop.sum()} drop px, top 20%: {(s >= 0.8).mean():.1%}, top 10%: {(s >= 0.9).mean():.1%}, bottom half: {(s < 0.5).mean():.1%}")
a = np.concatenate(allv)
print(f"all: {a.size} px, top 20%: {(a >= 0.8).mean():.1%}, top 10%: {(a >= 0.9).mean():.1%}, bottom half: {(a < 0.5).mean():.1%}")
