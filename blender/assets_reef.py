"""Kelp, corals, sponges, anemones, and the reef mounds that gather them. Everything stands on z = 0."""
import math
import random

from mathutils import Vector

from assets_env import blob
from kit import Part, empty, trs


def ribbon(part, material, spine, width, ruffle=0.05, cols=4, twist=0.0):
    """A thin wavy strip following `spine` (a list of Vectors), `width(t)` wide, with ruffled edges."""
    bm = part.bm
    n = len(spine)
    rows = []
    for i, p in enumerate(spine):
        t = i / (n - 1)
        a = spine[min(i + 1, n - 1)] - spine[max(i - 1, 0)]
        a.normalize()
        side = a.cross(Vector((0, 0, 1)))
        if side.length < 1e-3:
            side = Vector((1, 0, 0))
        side.normalize()
        side = side * math.cos(twist * t) + a.cross(side) * math.sin(twist * t)
        normal = a.cross(side).normalized()
        w = width(t)
        row = []
        for c in range(cols):
            u = -1 + 2 * c / (cols - 1)
            wave = math.sin(t * 38 + u * 2.5) * ruffle * abs(u) ** 1.5
            row.append(bm.verts.new(p + side * w * u + normal * wave))
        rows.append(row)
    faces = [bm.faces.new((a[c], a[c + 1], b[c + 1], b[c])) for a, b in zip(rows, rows[1:]) for c in range(cols - 1)]
    part._paint(faces, material, True)


def kelp_stalk(part, P, base, height, rng, lean=0.0):
    """One giant kelp stipe with alternating blades and a gas bladder at the root of each blade."""
    steps = 24
    phase = rng.uniform(0, 6.28)
    spine = []
    for i in range(steps + 1):
        t = i / steps
        spine.append(Vector((base[0] + math.sin(phase + t * 3.0) * 0.25 * t + lean * t * height,
                             base[1] + math.cos(phase + t * 2.3) * 0.15 * t, height * t)))
    part.tube(P["kelp_stipe"], spine, radius=lambda t: 0.055 * (1 - 0.5 * t) + 0.015, segs=6)
    blades = int(height * 2.2)
    for k in range(blades):
        t = 0.12 + 0.86 * k / max(blades - 1, 1)
        idx = min(int(t * steps), steps - 1)
        root = spine[idx]
        side = 1 if k % 2 == 0 else -1
        yaw = rng.uniform(-0.6, 0.6) + (0 if side > 0 else math.pi)
        out = Vector((math.cos(yaw), math.sin(yaw), 0))
        length = rng.uniform(0.9, 1.5) * (1 - 0.3 * t)
        blade = [root + out * 0.08 + out * (length * s * 0.55) + Vector((0, 0, length * s * (0.75 + 0.15 * s)))
                 for s in [j / 9 for j in range(10)]]
        ribbon(part, P["kelp_blade"], blade, lambda s: 0.14 * math.sin(math.pi * min(1.0, s * 1.15 + 0.08)) + 0.015,
               ruffle=0.045, twist=rng.uniform(-1.0, 1.0))
        part.sphere(P["kelp_bladder"], loc=root + out * 0.1, scale=(0.07, 0.07, 0.09), segs=10, rings=8)
    part.sphere(P["kelp_stipe"], loc=(base[0], base[1], 0.05), scale=(0.22, 0.22, 0.1), segs=12, rings=6)


def kelp(P, name, seed, stalks, height):
    rng = random.Random(seed)
    root = empty(name)
    part = Part()
    for s in range(stalks):
        a = rng.uniform(0, 6.28)
        r = rng.uniform(0, 0.6) if s else 0.0
        kelp_stalk(part, P, (math.cos(a) * r, math.sin(a) * r * 0.5), height * rng.uniform(0.65, 1.0), rng,
                   lean=rng.uniform(-0.06, 0.06))
    part.build(f"{name}_mesh", root)
    return root


def kelp_tall(P):
    return kelp(P, "kelp_tall", 3, 3, 8.5)


def kelp_short(P):
    return kelp(P, "kelp_short", 9, 4, 4.5)


def staghorn(part, P, matrix, rng, body="coral_pink", tip="coral_pink_tip", size=1.0, depth=4):
    """Branching coral: tapered arms that fork upward, each tip pale and knobbly."""
    def grow(start, direction, length, radius, level):
        end = start + direction * length
        mid = (start + end) / 2 + Vector((rng.uniform(-0.05, 0.05), rng.uniform(-0.05, 0.05), 0))
        part.tube(P[body], [start, mid, end], radius=lambda t: radius * (1 - 0.35 * t), segs=6, matrix=matrix)
        if level == 0:
            part.sphere(P[tip], matrix=matrix @ trs(end, scale=radius * 0.85), segs=6, rings=4)
            return
        for _ in range(2 if level < depth else 3):
            d = direction + Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.5, 0.5), rng.uniform(0.2, 0.7)))
            grow(end, d.normalized(), length * rng.uniform(0.62, 0.8), radius * 0.72, level - 1)

    for k in range(4):
        a = 2 * math.pi * k / 4 + rng.uniform(-0.4, 0.4)
        start = Vector((math.cos(a) * 0.06 * size, math.sin(a) * 0.06 * size, 0))
        d = Vector((math.cos(a) * 0.45, math.sin(a) * 0.45, 1)).normalized()
        grow(start, d, 0.38 * size * rng.uniform(0.8, 1.1), 0.075 * size, depth)


def table_coral(part, P, matrix, rng, size=1.0, color="coral_teal"):
    """A stalk carrying stacked wavy plates."""
    part.cylinder(P[color], matrix=matrix, loc=(0, 0, 0.25 * size), radius=0.1 * size, radius2=0.07 * size,
                  depth=0.5 * size, segs=10)
    for tier, (z, r) in enumerate(((0.45, 0.85), (0.62, 0.55))):
        ring = [(z * size + 0.05 * math.sin(t * 9) * t, rr) for t, rr in [(i / 12, (i / 12) * r * size) for i in range(13)]]
        prof = [(z * size - 0.03, 0.0)] + [(h - 0.03, rr) for h, rr in ring] + [(h + 0.03, rr) for h, rr in reversed(ring)]
        part.lathe(P[color], prof + [(z * size + 0.03, 0.0)],
                   matrix=matrix @ trs(rot=(0, -math.pi / 2, 0)) @ trs((0, 0, 0), (0.06 * tier, 0, 0)), segs=28)


def sea_fan(part, P, matrix, rng, size=1.0, color="coral_purple"):
    """A flat fan of fine branches spreading in one plane."""
    def grow(start, angle, length, radius, level):
        end = start + Vector((math.cos(angle) * length, 0, math.sin(angle) * length))
        part.tube(P[color], [start, (start + end) / 2 + Vector((0, rng.uniform(-0.02, 0.02), 0)), end],
                  radius=lambda t: radius * (1 - 0.3 * t), segs=4, matrix=matrix)
        if level == 0:
            return
        for spread in (-0.35, 0.35):
            grow(end, angle + spread + rng.uniform(-0.12, 0.12), length * 0.78, radius * 0.75, level - 1)

    grow(Vector((0, 0, 0)), math.pi / 2, 0.5 * size, 0.045 * size, 5)


def tube_sponge(part, P, matrix, rng, size=1.0, color="sponge_orange"):
    """A cluster of upright tubes that flare at the lip, each with a dark opening."""
    for k in range(rng.randint(3, 5)):
        a = rng.uniform(0, 6.28)
        d = (0.0 if k == 0 else rng.uniform(0.12, 0.24)) * size
        h = rng.uniform(0.45, 0.95) * size * (1.2 if k == 0 else 1.0)
        r = rng.uniform(0.08, 0.12) * size
        m = matrix @ trs((math.cos(a) * d, math.sin(a) * d, 0), (rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), 0))
        prof = [(0.0, 0.0), (0.0, r * 1.1), (h * 0.3, r * 0.95), (h * 0.75, r), (h * 0.95, r * 1.2), (h, r * 1.3),
                (h, 0.0)]
        part.lathe(P[color], prof, matrix=m @ trs(rot=(0, -math.pi / 2, 0)), segs=12, sharp=(5,))
        part.cylinder(P["sponge_inner"], matrix=m, loc=(0, 0, h + 0.002), radius=r * 1.05, depth=0.004, segs=18)
        for j in range(6):
            pa = rng.uniform(0, 6.28)
            pz = rng.uniform(0.1, 0.85) * h
            part.sphere(P[color], matrix=m @ trs((math.cos(pa) * r, math.sin(pa) * r, pz), scale=r * 0.25), segs=6, rings=4)


def anemone(part, P, matrix, rng, size=1.0):
    """A soft column topped by a ring of curling tentacles."""
    column = [(0.0, 0.0), (0.0, 0.2), (0.12, 0.17), (0.26, 0.19), (0.34, 0.25), (0.37, 0.24), (0.37, 0.0)]
    part.lathe(P["anemone_body"], [(h * size, rr * size) for h, rr in column],
               matrix=matrix @ trs(rot=(0, -math.pi / 2, 0)), segs=20)
    part.cylinder(P["anemone_disc"], matrix=matrix, loc=(0, 0, 0.372 * size), radius=0.22 * size, depth=0.01, segs=20)
    for k in range(28):
        a = 2 * math.pi * k / 28 + rng.uniform(-0.05, 0.05)
        ring = 0.12 + 0.1 * (k % 2)
        base = Vector((math.cos(a) * ring * size, math.sin(a) * ring * size, 0.37 * size))
        out = Vector((math.cos(a), math.sin(a), 0))
        length = rng.uniform(0.35, 0.55) * size
        pts = [base + out * (length * 0.5 * s) + Vector((0, 0, length * (s - 0.35 * s * s))) for s in
               (0, 0.33, 0.66, 1.0)]
        part.tube(P["anemone_tentacle"], pts, radius=lambda t: 0.03 * size * (1 - 0.5 * t), segs=4, matrix=matrix)
        part.sphere(P["anemone_tip"], matrix=matrix @ trs(pts[-1], scale=0.028 * size), segs=5, rings=3)


def brain_coral(part, P, matrix, size=1.0, seed=4):
    m = matrix @ trs((0, 0, 0.3 * size))
    blob(part, P["coral_purple"], loc=m.to_translation(), scale=(0.6 * size, 0.55 * size, 0.42 * size), seed=seed,
         amount=0.1, freq=2.0, subdiv=3)


def coral_staghorn(P):
    root = empty("coral_staghorn")
    part = Part()
    staghorn(part, P, trs(), random.Random(5))
    part.build("coral_staghorn_mesh", root)
    return root


def coral_fan(P):
    root = empty("coral_fan")
    part = Part()
    sea_fan(part, P, trs(), random.Random(8), size=1.6)
    part.cylinder(P["rock"], loc=(0, 0, 0.05), radius=0.18, radius2=0.1, depth=0.12, segs=10)
    part.build("coral_fan_mesh", root)
    return root


def coral_table(P):
    root = empty("coral_table")
    part = Part()
    table_coral(part, P, trs(), random.Random(3), size=1.3)
    part.build("coral_table_mesh", root)
    return root


def sponge_cluster(P):
    root = empty("sponge_cluster")
    part = Part()
    tube_sponge(part, P, trs(), random.Random(6), size=1.2, color="sponge_purple")
    part.build("sponge_cluster_mesh", root)
    return root


def anemone_patch(P):
    root = empty("anemone_patch")
    part = Part()
    rng = random.Random(12)
    for x, y, s in ((0, 0, 1.0), (0.45, 0.1, 0.7), (-0.4, 0.15, 0.8)):
        anemone(part, P, trs((x, y, 0)), rng, size=s)
    part.build("anemone_patch_mesh", root)
    return root


def reef(P, name, seed, width):
    """A low rock mound crowded with corals, sponges, anemones, and little encrusting polyps."""
    rng = random.Random(seed)
    root = empty(name)
    part = Part()

    def mound(x):
        return 0.1 + 0.45 * max(0.0, 1 - (2 * x / width) ** 2)

    for k in range(4):
        x = (k - 1.5) * width * 0.26 + rng.uniform(-0.15, 0.15)
        blob(part, P["rock"], loc=(x, rng.uniform(-0.15, 0.15), 0.05), scale=(width * 0.22, 0.7, mound(x) + 0.12),
             seed=seed + k, amount=0.28, freq=1.5, subdiv=2)
    for _ in range(int(width * 18)):
        x = rng.uniform(-width / 2, width / 2) * 0.95
        y = rng.uniform(-0.55, 0.55)
        part.sphere(P[rng.choice(("polyp_green", "polyp_orange", "coral_pink_tip", "coral_teal"))],
                    loc=(x, y, mound(x) + rng.uniform(0.0, 0.12)), scale=rng.uniform(0.04, 0.08), segs=6, rings=4)
    pieces = ["staghorn", "table", "fan", "sponge", "anemone", "brain", "staghorn", "fan", "sponge", "staghorn"]
    count = int(width * 4.2)
    for k in range(count):
        x = -width / 2 + width * (k + 0.5) / count + rng.uniform(-0.12, 0.12)
        y = rng.uniform(-0.4, 0.4)
        m = trs((x, y, mound(x)), (0, 0, rng.uniform(0, 6.28)))
        kind = pieces[(k * 7 + seed) % len(pieces)]
        s = rng.uniform(0.75, 1.3)
        if kind == "staghorn":
            body, tip = rng.choice((("coral_pink", "coral_pink_tip"), ("coral_orange", "coral_orange_tip"),
                                    ("coral_yellow", "coral_pink_tip")))
            staghorn(part, P, m, rng, body=body, tip=tip, size=s, depth=3)
        elif kind == "table":
            table_coral(part, P, m, rng, size=s, color=rng.choice(("coral_teal", "coral_yellow")))
        elif kind == "fan":
            sea_fan(part, P, m, rng, size=s * 1.3, color=rng.choice(("coral_purple", "coral_red")))
        elif kind == "sponge":
            tube_sponge(part, P, m, rng, size=s, color=rng.choice(("sponge_orange", "sponge_purple")))
        elif kind == "anemone":
            anemone(part, P, m, rng, size=s * 0.8)
        else:
            brain_coral(part, P, m, size=s * 0.75, seed=seed + k)
    part.build(f"{name}_mesh", root)
    return root


def reef_small(P):
    return reef(P, "reef_small", 21, 2.4)


def reef_large(P):
    return reef(P, "reef_large", 34, 4.2)


REEF_ASSETS = ("kelp_tall", "kelp_short", "coral_staghorn", "coral_fan", "coral_table", "sponge_cluster",
               "anemone_patch", "reef_small", "reef_large")
