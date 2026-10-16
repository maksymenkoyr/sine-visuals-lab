# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10.1"]
# ///
"""Reference frames over ours at the same seconds — the side-by-side Tangle
was judged by (2026-10-05). The output holds the reference's pixels, so it
stays in the local cache or a scratch folder, never in this repo.

    uv run docs/scenes/tangle/scripts/compare.py OUT.png REF_VIDEO OURS_PREFIX [times...]

OURS_PREFIX is shot.mjs's: frames named <prefix>-<t with _ for .>.png.
ffmpeg comes from $FFMPEG or PATH (`uvx --from static-ffmpeg
static_ffmpeg_paths` prints a working one when Homebrew's is broken).
"""
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

out, video, ours = sys.argv[1], sys.argv[2], sys.argv[3]
times = sys.argv[4:] or ["0.17", "0.57", "1.37", "2.97", "11"]
ff = os.environ.get("FFMPEG", "ffmpeg")
W = 320
sheet = Image.new("RGB", (W * len(times), 2 * W + 36), (20, 20, 24))
d = ImageDraw.Draw(sheet)
with tempfile.TemporaryDirectory() as tmp:
    for i, t in enumerate(times):
        ref = os.path.join(tmp, f"ref_{t}.png")
        subprocess.run([ff, "-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", ref], check=True)
        sheet.paste(Image.open(ref).convert("RGB").resize((W, W)), (i * W, 16))
        o = Image.open(f"{ours}-{t.replace('.', '_')}.png").convert("RGB")
        s = min(o.size)
        o = o.crop(((o.width - s) // 2, (o.height - s) // 2, (o.width + s) // 2, (o.height + s) // 2))
        sheet.paste(o.resize((W, W)), (i * W, W + 36))
        d.text((i * W + 4, 2), f"reference {t}s", fill=(220, 220, 220))
        d.text((i * W + 4, W + 20), f"ours {t}s", fill=(220, 220, 220))
sheet.save(out)
print("wrote", out)
