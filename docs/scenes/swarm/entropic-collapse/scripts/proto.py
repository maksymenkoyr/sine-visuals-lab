# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26", "opencv-python-headless>=4.9"]
# ///
"""Prototype of the swarm physics (our own design, swarmalator-flavoured):
particles with position, velocity and phase. Every pair inside MAXD wants to
sit at a rest length set by their phase difference: in phase -> MIND, anti
phase -> MAXD. Velocity integrates the spring force and loses `drag`;
phases run at OMEGA and pull toward neighbours (Kuramoto, weighted by
closeness) with a little noise (temperature). Renders a contact sheet of the
edge graph over time, in the reference's 870x720 pixel units.

    uv run proto.py <out-prefix> KEY=value ...
"""
import sys, json, numpy as np, cv2

P = dict(N=256, MIND=150., MAXD=400., K_SPRING=2.0, DRAG=0.5, OMEGA=0.0, K_PHASE=1.5,
         NOISE=0.3, REP=4000., EDGE=150., SEED=1, T=40., FPS=30, SUB=2, PULL=0.0,
         MODE=0, OSPREAD=0.0, BREATH=0.0, BPERIOD=0.8, EALPHA=0.35, COLPHASE=0, K2=0.0, GRAV=0.0,
         ATT=400., SHARP=2., REPC=27556., TRAP=1.0, LPH=120., CAUCHY=0, LOCKTAU=0.5)
for a in sys.argv[2:]:
    k, v = a.split("=")
    P[k] = float(v)
N = int(P["N"])
rng = np.random.default_rng(int(P["SEED"]))
W, H = 870, 720
x = np.c_[rng.uniform(80, W - 80, N), rng.uniform(80, H - 80, N)]
v = np.zeros_like(x)
th = rng.uniform(0, 2 * np.pi, N)
omega = P["OMEGA"] + P["OSPREAD"] * (np.clip(rng.standard_cauchy(size=N), -20, 20) if P["CAUCHY"] else rng.normal(size=N))
T_NOW = [0.0]
LOCK = np.zeros(N)
dt = 1 / (P["FPS"] * P["SUB"])
eye = np.eye(N, dtype=bool)


def step():
    global x, v, th
    d = x[None, :, :] - x[:, None, :]  # j - i
    r = np.linalg.norm(d, axis=-1) + np.eye(N)
    u = d / r[..., None]
    dth = th[None, :] - th[:, None]
    inr = (r < P["MAXD"]) & ~eye
    if P["MODE"] in (2, 3):
        # trap + all-pairs 1/r repulsion (sets the rim) + short-range attraction
        # between in-phase pairs (pulls the synced core together); the
        # attraction breathes on the beat, the rim (set by Gauss) does not
        a_t = P["ATT"] * (1 + P["BREATH"] * np.cos(2 * np.pi * T_NOW[0] / P["BPERIOD"]))
        if P["MODE"] == 3:
            # lock-gated: a particle's lock is the EMA of cos(theta - mean
            # phase); drifters average to ~0 and never pull in
            psi = np.angle(np.exp(1j * th).mean())
            LOCK[:] += (np.cos(th - psi) - LOCK) * min(1.0, dt / P["LOCKTAU"])
            lk = np.maximum(0.0, LOCK) ** P["SHARP"]
            s = lk[:, None] * lk[None, :]
        else:
            s = np.maximum(0.0, np.cos(dth)) ** P["SHARP"]
        near = (r < P["MIND"]) & ~eye
        f = np.where(near, a_t * s * (1 - (r / P["MIND"]) ** 2), 0.0)
        f = f - P["REPC"] / np.maximum(r, 6.0) * (~eye)
        F = (f[..., None] * u).sum(1) / N
        F += P["TRAP"] * (x.mean(0) - x)
        v += F * dt
        v *= np.exp(-P["DRAG"] * dt * 4)
        x += v * dt
        w = np.exp(-r / P["LPH"]) * (~eye)
        T_NOW[0] += dt
        th += (omega + P["K_PHASE"] * (w * np.sin(dth)).sum(1) / N) * dt \
            + P["NOISE"] * np.sqrt(dt) * rng.normal(size=N)
        return
    if P["MODE"] == 0:
        mind = P["MIND"] * (1 + P["BREATH"] * 0.5 * (1 - np.cos(2 * np.pi * T_NOW[0] / P["BPERIOD"])))
        r0 = mind + (P["MAXD"] - mind) * 0.5 * (1 - np.cos(dth))
    else:
        # rest length breathes with the *pair's mean phase* (absolute), so a
        # synced swarm breathes as one
        mp = np.angle(np.exp(1j * th[None]) + np.exp(1j * th[:, None]))
        r0 = P["MIND"] * (1 + P["MODE"] * 0.5 * (1 - np.cos(mp)))
    f = np.where(inr, P["K_SPRING"] * (r - r0), 0.0)
    f = f - P["REP"] / r ** 2 * (~eye)
    F = (f[..., None] * u).sum(1) / N
    F += P["PULL"] * (np.array([W / 2, H / 2]) - x)
    gc = x.mean(0) - x
    F += P["GRAV"] * gc / np.maximum(np.linalg.norm(gc, axis=1, keepdims=True), 40.0)
    v += F * dt
    v *= np.exp(-P["DRAG"] * dt * 4)
    x += v * dt
    w = np.where(inr, 1 - r / P["MAXD"], 0.0)
    T_NOW[0] += dt
    th += (omega + (w * (P["K_PHASE"] * np.sin(dth) + P["K2"] * np.sin(2 * dth))).sum(1) / N) * dt \
        + P["NOISE"] * np.sqrt(dt) * rng.normal(size=N)


def render():
    img = np.zeros((H, W, 3), np.float32)
    d = np.linalg.norm(x[None] - x[:, None], axis=-1)
    ii, jj = np.nonzero(np.triu(d < P["EDGE"], 1))
    deg = (d < P["EDGE"]).sum(1) - 1
    dens = np.clip(deg / 60, 0, 1)
    off = np.array([W / 2, H / 2]) - x.mean(0)
    for i, j in zip(ii, jj):
        a = 0.35 * (1 - d[i, j] / P["EDGE"])
        dn = 0.5 * (dens[i] + dens[j])
        col = np.array([0.95, 0.25, 0.85]) * (1 - dn) + np.array([1, 1, 1]) * dn  # BGR
        layer = np.zeros_like(img)
        p0 = tuple(int(c) for c in x[i] + off)
        p1 = tuple(int(c) for c in x[j] + off)
        cv2.line(layer, p0, p1, tuple(float(c) for c in col * a), 1, cv2.LINE_AA)
        img += layer
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


def render_fast():
    # additive lines via accumulation in one layer per batch (cv2.line overwrites)
    img = np.zeros((H, W, 3), np.float32)
    d = np.linalg.norm(x[None] - x[:, None], axis=-1)
    ii, jj = np.nonzero(np.triu(d < P["EDGE"], 1))
    deg = (d < P["EDGE"]).sum(1) - 1
    dens = np.clip(deg / 60, 0, 1)
    off = np.array([W / 2, H / 2]) - x.mean(0)
    order = np.random.default_rng(0).permutation(len(ii))
    batch = 64
    for b in range(0, len(order), batch):
        layer = np.zeros_like(img)
        for k in order[b:b + batch]:
            i, j = ii[k], jj[k]
            a = P["EALPHA"] * (1 - d[i, j] / P["EDGE"])
            if P["COLPHASE"]:
                psi = np.angle(np.exp(1j * th).mean())
                off_ = 0.5 * (np.abs(np.angle(np.exp(1j * (th[i] - psi)))) + np.abs(np.angle(np.exp(1j * (th[j] - psi))))) / np.pi
                # 0 = in phase (white) -> 0.25 magenta -> 0.5 orange -> 1 green  (BGR)
                stops = np.array([[1, 1, 1], [0.9, 0.25, 0.95], [0.1, 0.45, 1.0], [0.2, 0.9, 0.5]])
                q = min(off_ * 3, 2.999); k0 = int(q); fr = q - k0
                col = stops[k0] * (1 - fr) + stops[k0 + 1] * fr
            else:
                dn = 0.5 * (dens[i] + dens[j])
                col = np.array([0.95, 0.25, 0.85]) * (1 - dn) + dn
            cv2.line(layer, tuple(int(c) for c in x[i] + off), tuple(int(c) for c in x[j] + off),
                     tuple(float(c) for c in col * a), 1, cv2.LINE_AA)
        img += layer
    for i in range(N):
        cv2.circle(img, tuple(int(c) for c in x[i] + off), 1, (0.9, 0.5, 1.0), -1, cv2.LINE_AA)
    return (np.clip(img, 0, 1) * 255).astype(np.uint8)


times = [float(t) for t in "0,2,5,10,15,20,25,30,35,40".split(",") if float(t) <= P["T"]]
extra = [P["T"] - 0.8 + k * 0.2 for k in range(5)]  # one breath at the end, 0.2 s apart
tiles = []
trace = []
frames = int(round(P["T"] * P["FPS"]))
for fi in range(frames + 1):
    t = fi / P["FPS"]
    c = x.mean(0)
    rr = np.linalg.norm(x - c, axis=1) / (H / 2)
    lockd = LOCK > 0.6
    core90 = float(np.percentile(rr[lockd], 90)) if lockd.sum() > 10 else float("nan")
    trace.append([t, float(np.percentile(rr, 50)), float(np.percentile(rr, 90)),
                  float(np.abs(np.exp(1j * th).mean())), core90, float(lockd.mean())])
    if any(abs(t - tt) < 0.5 / P["FPS"] for tt in times + extra):
        im = cv2.resize(render_fast(), (290, 240))
        cv2.putText(im, f"{t:.1f}s", (5, 20), 0, 0.6, (0, 255, 255), 1)
        tiles.append(im)
    for _ in range(int(P["SUB"])):
        step()
while len(tiles) % 5:
    tiles.append(np.zeros_like(tiles[0]))
sheet = np.vstack([np.hstack(tiles[i:i + 5]) for i in range(0, len(tiles), 5)])
cv2.imwrite(sys.argv[1] + ".png", sheet)
tr = np.array(trace)
last = tr[tr[:, 0] > P["T"] - 10]
r90 = last[:, 2]
# breath period from r90 zero crossings
z = r90 - r90.mean()
cross = np.nonzero((z[:-1] < 0) & (z[1:] >= 0))[0]
per = np.median(np.diff(last[cross, 0])) if len(cross) > 2 else float("nan")
print("last10s r50 p10/p90", np.percentile(last[:, 1], [10, 90]).round(2),
      "r90 p10/p90", np.percentile(r90, [10, 90]).round(2),
      "sync R", last[:, 3].mean().round(2), "period", round(float(per), 2),
      "core90 p10/p90", np.nanpercentile(last[:, 4], [10, 90]).round(2), "locked", last[:, 5].mean().round(2))
json.dump(tr.tolist(), open(sys.argv[1] + ".json", "w"))
