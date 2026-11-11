# Collects every number the study page draws or prints, into page/data.json.
import json
import numpy as np
root = "/Users/yaro/.claude/jobs/43f57e00/tmp/oil/out/"
an = {w: json.load(open(root + f"an_{w}.json")) for w in ("A1", "A2", "B")}
fl = {w: json.load(open(root + f"fl_{w}.json")) for w in ("A1", "A2", "B")}
fi = {w: json.load(open(root + f"field_{w}.json")) for w in ("A1", "A2", "B")}
pr = {w: json.load(open(root + f"pr_{w}.json")) for w in ("A1", "A2", "B")}
rho = pr["B"]["rho"]
def curve(windows, fam):
    Ys = [[np.nan if v is None else v for v in t["Y"]] for w in windows for t in pr[w]["tracks_detail"] if t["fam"] == fam]
    a = np.array(Ys, float)
    with np.errstate(all="ignore"):
        import warnings; warnings.simplefilter("ignore", RuntimeWarning)
        m = np.nanmedian(a, axis=0); lo = np.nanpercentile(a, 25, axis=0); hi = np.nanpercentile(a, 75, axis=0)
    cov = np.isfinite(a).mean(axis=0)
    out = lambda v: [None if (not np.isfinite(x) or c < 0.5) else round(float(x), 3) for x, c in zip(v, cov)]
    return {"n": len(Ys), "p50": out(m), "p25": out(lo), "p75": out(hi)}
data = {
    "rho": rho,
    "profiles": {"Red drops, clip A": curve(("A1", "A2"), "red"), "Pink drops, clip B": curve(("B",), "pink/magenta"), "Orange drops, clip B": curve(("B",), "orange"), "Yellow drops, clip B": curve(("B",), "yellow")},
    "bins": ["3–6", "6–12", "12–24", "24–48", "48–96", "96+"],
    "counts": {"Clip A, 1:10:03": list(an["A1"]["counts_median_per_frame"].values()), "Clip A, 1:12:44": list(an["A2"]["counts_median_per_frame"].values()), "Clip B, 1:11:50": list(an["B"]["counts_median_per_frame"].values())},
    "table": {w: {
        "drops": an[w]["count_all_median"], "drops12": an[w]["count_r12plus_median"], "cover": an[w]["coverage_share_median"], "rad": an[w]["radius_pct_of_width"],
        "speed": an[w]["speed_pct_per_s"], "corr": an[w]["velocity_correlation_by_separation"], "touch": an[w]["contacts_per_drop_r12plus"], "inner": an[w]["drops_r24plus_with_inner_share"], "innerR": an[w]["inner_over_outer_radius_p10_p50_p90"], "innerN": an[w]["inner_drops_median_per_frame"],
        "paint": fl[w]["paint_speed_pct_per_s_p50_p90_p99"], "ride": fl[w]["drop_vs_local_paint"],
        "field": {k: fi[w][k] for k in ("translation_r2", "similarity_r2", "affine_r2")}, "per3": [s["r2"] for s in fi[w]["per_3s"]], "sim": fi[w]["similarity"], "straight": an[w]["straightness_net_over_path_tracks3s_p50"], "err": an[w]["rim_fit_error_share_of_r_p50"], "rcv": an[w]["radius_cv_p50"],
    } for w in ("A1", "A2", "B")},
    "groups": {w: {k: {kk: g[kk] for kk in g if not kk.startswith("profile") and kk != "S_profile_delta_p50"} for k, g in pr[w]["groups"].items()} for w in ("A1", "A2", "B")},
}
s = json.dumps(data, default=lambda o: None).replace("NaN", "null"); open(root + "../page/data.json", "w").write(s)
t = data["table"]
for w in t: print(w, t[w]["drops"], t[w]["drops12"], t[w]["cover"], t[w]["speed"]["all_p50"], t[w]["speed"]["after_removing_pan_p50"], t[w]["paint"][0], t[w]["ride"]["slope"], t[w]["ride"]["r2"], t[w]["field"], t[w]["per3"])
