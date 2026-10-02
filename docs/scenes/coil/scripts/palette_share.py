# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "pillow>=10.1"]
# ///
"""
Share of pixels nearest to each of the reference's measured colours (ground
plus the k-means stripe clusters from measure_cycle.py), for any set of
images — run it on reference frames and on our screenshots to compare the
colour weights side by side.

    uv run docs/scenes/coil/scripts/palette_share.py img1 [img2 ...]

Crops 10 % off every edge (our screenshots carry UI chrome in the corners).
"""
import sys

import numpy as np
from PIL import Image

REF = {
    "ground": "#aa85bb",
    "red": "#c42d50",
    "purple": "#815690",
    "blue": "#5d8cdc",
    "pink": "#d57b95",
    "lilac": "#bebad7",
    "white": "#e8e6f2",
}


def rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float)


def main():
    names = list(REF)
    cent = np.stack([rgb(REF[k]) for k in names])
    print("image".ljust(28) + "".join(n.rjust(8) for n in names) + "   mean-dist")
    for f in sys.argv[1:]:
        a = np.asarray(Image.open(f).convert("RGB").resize((300, 300))).astype(float)[30:270, 30:270]
        px = a.reshape(-1, 3)
        d = np.linalg.norm(px[:, None, :] - cent[None], axis=-1)
        lab = d.argmin(axis=1)
        share = np.bincount(lab, minlength=len(names)) / len(px)
        print(f.split("/")[-1][:27].ljust(28) + "".join(f"{s:8.2f}" for s in share) + f"   {d.min(axis=1).mean():6.1f}")


if __name__ == "__main__":
    main()
