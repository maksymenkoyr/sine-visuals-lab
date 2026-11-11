# Is one clip the same footage as another? Normalised correlation of low-res luma over candidate time shifts.
# Usage: repeat.py <video> <a0> <a1> <b0> <b1>
import sys
import cv2, numpy as np
video, a0, a1, b0, b1 = sys.argv[1], *map(float, sys.argv[2:6])
cap = cv2.VideoCapture(video); fps = 59.94
def read(t0, t1, every=6):
    out = []
    cap.set(cv2.CAP_PROP_POS_MSEC, t0 * 1000)
    for i in range(int((t1 - t0) * fps)):
        ok, f = cap.read()
        if not ok: break
        if i % every == 0:
            g = cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (96, 54), interpolation=cv2.INTER_AREA).astype(np.float32)
            out.append(((g - g.mean()) / (g.std() + 1e-6)).ravel())
    return np.array(out)
A, B = read(a0, a1), read(b0, b1)
C = A @ B.T / A.shape[1]
i, j = np.unravel_index(np.argmax(C), C.shape)
print(f"A {A.shape[0]} B {B.shape[0]} samples; best r={C.max():.3f} at A t={a0 + i * 0.1:.1f}s B t={b0 + j * 0.1:.1f}s")
# along the best diagonal
L = min(A.shape[0] - i, B.shape[0] - j)
back = min(i, j); d = [C[i + k, j + k] for k in range(-back, L)]
print(f"along that alignment: min r {min(d):.3f}, median r {np.median(d):.3f}, over {len(d)} samples = {len(d) * 0.1:.1f} s")
print("median of all pairs", round(float(np.median(C)), 3))
