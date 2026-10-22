# Frame-mean blue and frame contrast (std) over a set of frames: does the
# picture breathe in brightness or contrast as it churns?
import sys, glob
import numpy as np
from PIL import Image

for name, pat in zip(sys.argv[1::2], sys.argv[2::2]):
    m, s = [], []
    for p in sorted(glob.glob(pat)):
        b = np.asarray(Image.open(p).convert("RGB").resize((320, 180)))[..., 2] / 255
        m.append(b.mean()); s.append(b.std())
    m, s = np.array(m), np.array(s)
    print(f"{name}: mean {m.mean():.3f} ± {m.std():.3f} (min {m.min():.3f} max {m.max():.3f}); contrast {s.mean():.3f} ± {s.std():.3f}")
