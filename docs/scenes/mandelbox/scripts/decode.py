# Decode a window of a video to one uint8 numpy stack (frames x height x width [x 3]) for the hour-long
# passes: hour128.npy (5 fps, 128x72, RGB) feeds huemin.py and filmstrip.py, hour1s.npy (1 fps, 192x108)
# the one-second filmstrips.
# usage: decode.py <video> <out.npy> <start_s> <dur_s> <fps> <width> [gray]
import sys

import numpy as np

from vidio import load

src, out, t0, dur, fps, width = sys.argv[1:7]
f = load(src, t0, dur, fps, int(width), gray=len(sys.argv) > 7)
np.save(out, f)
print(out, f.shape)
