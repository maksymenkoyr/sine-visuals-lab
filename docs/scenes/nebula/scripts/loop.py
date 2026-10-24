# Loop period + hue drift of the reference: decode small frames, find the
# geometry period by gradient-map correlation to frame 0, and the lit hue /
# brightness over the whole video.
#   uv run --with numpy python -I loop.py <video> <ffmpeg> period|hue
import subprocess, sys, numpy as np, colorsys

V = sys.argv[1]
FF = sys.argv[2]
mode = sys.argv[3]
W, H = 160, 90


def decode(start, dur, fps):
    cmd = [FF, "-v", "error", "-ss", str(start), "-t", str(dur), "-i", V, "-vf",
           f"fps={fps},scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3).astype(np.float32) / 255


def grad(f):
    g = f.mean(-1)
    gx = np.diff(g, axis=1)[:-1]
    gy = np.diff(g, axis=0)[:, :-1]
    m = np.hypot(gx, gy)
    m = m - m.mean()
    return m / (np.linalg.norm(m) + 1e-9)


if mode == "period":
    fr = decode(0, 700, 2)
    g0 = grad(fr[0])
    c = np.array([float((grad(f) * g0).sum()) for f in fr])
    order = np.argsort(-c)
    print("frames", len(fr))
    for i in order[:15]:
        print(f"t={i/2:.1f}s r={c[i]:.3f}")
    # also against frame at 100 s
    g1 = grad(fr[200])
    c1 = np.array([float((grad(f) * g1).sum()) for f in fr])
    print("vs t=100:", [(i / 2, round(c1[i], 3)) for i in np.argsort(-c1)[:10]])
elif mode == "hue":
    # one frame every 60 s across the video, lit pixels' circular mean hue
    for t in range(0, 7200, 120):
        f = decode(t, 0.5, 2)[0]
        hsv = np.array([colorsys.rgb_to_hsv(*p) for p in f.reshape(-1, 3)[::3]])
        lit = hsv[:, 2] > np.quantile(hsv[:, 2], 0.85)
        h = hsv[lit, 0] * 2 * np.pi
        mh = (np.degrees(np.arctan2(np.sin(h).mean(), np.cos(h).mean())) + 360) % 360
        print(f"t={t:5d}s luma={f.mean():.3f} lit_hue={mh:5.0f} sat={hsv[lit,1].mean():.2f}")
