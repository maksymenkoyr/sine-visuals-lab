# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "pillow>=10.1", "opencv-python-headless>=4.9"]
# ///
"""Coarse survey of a long video: one frame every STEP s, tiled into contact
sheets (COLS x ROWS per sheet) labelled with mm:ss, plus per-frame stats
(mean luma, saturation, dominant hue) to a TSV for clustering views."""
import sys, os, cv2, numpy as np
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
step = float(sys.argv[3]) if len(sys.argv) > 3 else 15.0
os.makedirs(out, exist_ok=True)
import subprocess, tempfile
ENV = dict(os.environ, DYLD_FALLBACK_LIBRARY_PATH=os.environ.get("DYLD_FALLBACK_LIBRARY_PATH", ""))
dur = float(subprocess.run(["ffprobe","-v","error","-show_entries","format=duration","-of","csv=p=0",src],capture_output=True,text=True,env=ENV).stdout)
tmpf = os.path.join(out, "_f.png")
def grab(t):
    subprocess.run(["ffmpeg","-v","error","-y","-ss",f"{t:.2f}","-i",src,"-frames:v","1","-vf","scale=256:144",tmpf],env=ENV,check=True)
    return cv2.imread(tmpf)
TW, TH, COLS, ROWS = 256, 144, 8, 8
tiles, rows = [], []
t = 5.0
while t < dur:
    fr = grab(t)
    if fr is None:
        break
    small = cv2.resize(fr, (TW, TH), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
    luma = float(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).mean())
    sat = float(hsv[..., 1].mean())
    lit = hsv[..., 2] > 60
    hue = float(np.median(hsv[..., 0][lit]) * 2) if lit.any() else -1
    litfrac = float(lit.mean())
    rows.append(f"{t:.0f}\t{luma:.1f}\t{sat:.1f}\t{hue:.0f}\t{litfrac:.3f}")
    im = Image.fromarray(cv2.cvtColor(small, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(im)
    lab = f"{int(t)//60:02d}:{int(t)%60:02d}"
    d.rectangle([0, 0, 44, 12], fill=(0, 0, 0))
    d.text((2, 0), lab, fill=(255, 255, 0))
    tiles.append(im)
    t += step
per = COLS * ROWS
for s in range(0, len(tiles), per):
    sheet = Image.new("RGB", (COLS * TW, ROWS * TH))
    for i, im in enumerate(tiles[s:s + per]):
        sheet.paste(im, ((i % COLS) * TW, (i // COLS) * TH))
    sheet.save(f"{out}/survey_{s // per:02d}.jpg", quality=80)
open(f"{out}/survey.tsv", "w").write("t\tluma\tsat\thue\tlit\n" + "\n".join(rows) + "\n")
print(f"{len(tiles)} frames, {dur:.0f}s, {(len(tiles)+per-1)//per} sheets -> {out}")
