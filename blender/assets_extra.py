"""Scenery with character: a sunken enemy submarine broken in two, and a seagull."""
import math
import random

import bmesh
from mathutils import Vector

from assets_deep import sculpt as sculpt_shape, smooth
from assets_player import propeller
from body import Body
from kit import Part, empty, trs


def jagged_rim(part, material, body, x, sign, rng, count=26):
    """Torn metal teeth around a hull break, pointing away along `sign`."""
    r = body.r(x)
    for i in range(count):
        a = 2 * math.pi * (i + rng.uniform(-0.3, 0.3)) / count
        length = rng.uniform(0.15, 0.6)
        width = rng.uniform(0.18, 0.35)
        tooth = [(0, -width / 2), (sign * length, rng.uniform(-0.08, 0.08)), (0, width / 2)]
        m = trs((x, -r * math.cos(a) * 0.99, r * math.sin(a) * 0.99), (a + math.pi / 2, 0, 0))
        part.extrude(material, tooth, depth=0.05, matrix=m @ trs(rot=(math.pi / 2, 0, 0)), bevel=0.01)


def crust(part, P, body, x_range, rng, holes=6, rust=10, barnacles=14, moss=6):
    for _ in range(holes):
        f = body.frame(rng.uniform(*x_range), rng.uniform(-1.2, 1.4))
        part.cylinder(P["wreck_dark"], matrix=f, radius=rng.uniform(0.12, 0.35), depth=0.06, segs=14)
    for _ in range(rust):
        f = body.frame(rng.uniform(*x_range), rng.uniform(0, 2 * math.pi), lift=0.01)
        part.sphere(P["rust_patch"], matrix=f @ trs(scale=(rng.uniform(0.3, 0.7), rng.uniform(0.2, 0.5), 0.03)),
                    segs=12, rings=6)
    for _ in range(barnacles):
        f = body.frame(rng.uniform(*x_range), rng.uniform(-0.6, 2.2))
        for k in range(rng.randint(2, 5)):
            off = (rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), 0.03)
            part.cylinder(P["barnacle"], matrix=f @ trs(off), radius=0.05, radius2=0.025, depth=0.07, segs=8)
    for _ in range(moss):
        f = body.frame(rng.uniform(*x_range), rng.uniform(1.2, 1.9), lift=0.02)
        part.sphere(P["moss"], matrix=f @ trs(scale=(rng.uniform(0.4, 0.8), rng.uniform(0.3, 0.6), 0.05)),
                    segs=12, rings=6)


def wreck_sub(P):
    rng = random.Random(7)
    root = empty("wreck_sub")
    b = Body(length=9.0, radius=1.9, p_front=2.2, p_back=2.6)
    brk_front, brk_rear = -0.3, 0.45

    front = Part()
    prof = [(x, r) for x, r in b.profile() if x < brk_front] + [(brk_front, b.r(brk_front))]
    front.lathe(P["wreck_hull"], prof, segs=40, caps=False)
    front.cylinder(P["wreck_dark"], loc=(brk_front - 0.2, 0, 0), radius=b.r(brk_front - 0.2) * 0.97, depth=0.04,
                   rot=(0, math.pi / 2, 0), segs=40)
    jagged_rim(front, P["wreck_hull"], b, brk_front, 1, rng)
    crust(front, P, b, (-4.0, -0.6), rng)
    tx = -1.4
    front.cylinder(P["wreck_hull"], loc=(tx, 0, b.r(tx) + 0.45), radius=0.7, depth=1.3, scale=(1.4, 0.8, 1),
                   rot=(0.12, 0.1, 0), segs=28, bevel=0.08)
    front.tube(P["rust"], [(tx + 0.2, 0, b.r(tx) + 1.0), (tx + 0.25, 0, b.r(tx) + 1.6), (tx + 0.7, 0.1, b.r(tx) + 1.75),
                            (tx + 0.9, 0.3, b.r(tx) + 1.5)], radius=0.08, segs=10)
    for i, x in enumerate((-3.2, -2.6)):
        front.cylinder(P["wreck_dark"], loc=(x, -b.r(x) * 0.4, b.r(x) * 0.9), radius=0.12, depth=0.04,
                       rot=(math.pi / 2, 0, 0), segs=12)
    front.build("wreck_front", root)

    rear = Part()
    prof = [(brk_rear, b.r(brk_rear))] + [(x, r) for x, r in b.profile() if x > brk_rear]
    rear.lathe(P["wreck_hull"], prof, segs=40, caps=False)
    rear.cylinder(P["wreck_dark"], loc=(brk_rear + 0.2, 0, 0), radius=b.r(brk_rear + 0.2) * 0.97, depth=0.04,
                  rot=(0, math.pi / 2, 0), segs=40)
    jagged_rim(rear, P["wreck_hull"], b, brk_rear, -1, rng)
    crust(rear, P, b, (0.7, 3.8), rng, holes=4, rust=8, barnacles=10, moss=4)
    rear.lathe(P["wreck_red"], [(1.8, b.r(1.8) * 0.9), (1.8, b.r(1.8) + 0.03), (2.1, b.r(2.1) + 0.03),
                                (2.1, b.r(2.1) * 0.9)], segs=40, loop=True)
    fin = [(3.5, 0.5), (4.2, 2.3), (5.1, 2.4), (5.0, 0.5)]
    rear.extrude(P["wreck_hull"], fin, depth=0.16, rot=(math.pi / 2, 0, 0), bevel=0.04)
    rear.extrude(P["wreck_hull"], [(x, -z * 0.55) for x, z in fin], depth=0.16, rot=(math.pi / 2, 0, 0), bevel=0.04)
    rear.extrude(P["wreck_hull"], [(x, z * 0.8) for x, z in fin], depth=0.16, bevel=0.04)
    rear_obj = rear.build("wreck_rear", root, location=(0.9, 0.2, -0.45))
    rear_obj.rotation_euler = (0.35, 0.12, -0.22)
    prop = propeller(P, "wreck_prop", rear_obj, (4.85, 0, 0), size=2.4, blades=2, hub_mat="rust", blade_mat="rust")
    prop.rotation_euler = (0.6, 0, 0)

    debris = Part()
    for _ in range(9):
        x = rng.uniform(-1.5, 2.5)
        y = rng.uniform(-2.5, 2.5)
        debris.box(P["wreck_hull"], loc=(x, y, -1.75), size=(rng.uniform(0.3, 0.9), rng.uniform(0.3, 0.7), 0.06),
                   rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(0, 3)), bevel=0.02)
    debris.cylinder(P["rust"], loc=(1.6, 2.0, -1.5), radius=0.3, depth=0.8, rot=(math.pi / 2, 0, 0.4), bevel=0.04)
    debris.build("wreck_debris", root)
    return root


def spine_body(part, materials, samples, ring=32):
    """Skin a body around a curved spine. `samples` are (x, z_center, radius_y, radius_z); `materials(point, up)`
    picks each face's material from its center and how much it faces upward."""
    bm = part.bm
    rings = []
    for i, (x, zc, ry, rz) in enumerate(samples):
        if ry <= 1e-4:
            rings.append([bm.verts.new((x, 0.0, zc))])
            continue
        rings.append([bm.verts.new((x, ry * math.cos(2 * math.pi * j / ring), zc + rz * math.sin(2 * math.pi * j / ring)))
                      for j in range(ring)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for j in range(ring):
            k = (j + 1) % ring
            if len(a) == 1:
                faces.append(bm.faces.new((a[0], b[k], b[j])))
            elif len(b) == 1:
                faces.append(bm.faces.new((a[j], a[k], b[0])))
            else:
                faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    groups = {}
    for f in faces:
        f.normal_update()
        groups.setdefault(materials(f.calc_center_median(), f.normal.z), []).append(f)
    for material, group in groups.items():
        part._paint(group, material, True)


def catmull_rom(keys, steps):
    """Smoothly interpolate a list of equal-length tuples with a Catmull-Rom spline."""
    pts = [keys[0]] + list(keys) + [keys[-1]]
    out = []
    for i in range(steps + 1):
        t = i / steps * (len(keys) - 1)
        k = min(int(t), len(keys) - 2)
        f = t - k
        p0, p1, p2, p3 = pts[k], pts[k + 1], pts[k + 2], pts[k + 3]
        out.append(tuple(0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f ** 3)
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def gull_spine(steps=64):
    """Tail tip to beak root: plump chest, slim neck rising into a round head."""
    keys = [(-0.42, 0.15, 0.0, 0.0), (-0.38, 0.15, 0.035, 0.025), (-0.26, 0.14, 0.09, 0.075), (-0.1, 0.13, 0.145, 0.13),
            (0.04, 0.135, 0.16, 0.145), (0.14, 0.17, 0.12, 0.12), (0.21, 0.24, 0.08, 0.085), (0.26, 0.3, 0.095, 0.1),
            (0.32, 0.315, 0.09, 0.09), (0.37, 0.31, 0.055, 0.055), (0.395, 0.305, 0.0, 0.0)]
    return [(x, z, max(0.0, ry), max(0.0, rz)) for x, z, ry, rz in catmull_rom(keys, steps)]


def gull_ring(x):
    """Body half-widths and centre height at x, from the same spine used to skin the body."""
    spine = gull_spine(64)
    best = min(spine, key=lambda k: abs(k[0] - x))
    return best[1], best[2], best[3]


def grid_patch(part, P, rows, cols, point, color, facing):
    """Build a smooth quad patch from point(u, v) -> (Vector, material key) over a rows x cols grid. The patch is open,
    so its faces are turned to point along `facing` (a fixed Vector) instead of trusting automatic normals."""
    bm = part.bm
    verts = [[None] * cols for _ in range(rows)]
    mats = [[None] * cols for _ in range(rows)]
    for i in range(rows):
        for j in range(cols):
            co, mkey = point(i / (rows - 1), j / (cols - 1))
            verts[i][j] = bm.verts.new(co)
            mats[i][j] = mkey
    groups = {}
    for i in range(rows - 1):
        for j in range(cols - 1):
            f = bm.faces.new((verts[i][j], verts[i][j + 1], verts[i + 1][j + 1], verts[i + 1][j]))
            groups.setdefault(color(mats, i, j), []).append(f)
    faces = [f for g in groups.values() for f in g]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.normal_update()
    if sum(f.normal.dot(facing) for f in faces) < 0:
        bmesh.ops.reverse_faces(bm, faces=faces)
    for key, group in groups.items():
        part._paint(group, P[key], True)


def gull_folded_wing(part, P, side):
    """A wing folded along the flank as a curved shell, its black-and-white tip crossing over the tail."""
    def point(u, v):
        x = 0.13 - u * 0.62
        zc, ry, rz = gull_ring(max(x, -0.37))
        tail = max(0.0, -0.3 - x) / 0.19
        a = math.radians(108 - v * (98 - 60 * tail))
        thick = 0.022 * (1 - 0.6 * u)
        r_out = 1.0 + thick * 6
        ry2 = max(ry, 0.06 + 0.02 * (1 - tail)) * r_out
        rz2 = max(rz, 0.05) * r_out
        y = side * (ry2 * math.cos(a) * (1 - 0.55 * tail) + 0.005)
        z = zc + rz2 * math.sin(a) + 0.03 * tail
        key = "black" if u > 0.66 else ("gull_white" if v > 0.86 else "gull_gray")
        if u > 0.8 and 0.3 < v < 0.5 and (abs(u - 0.86) < 0.025 or abs(u - 0.94) < 0.02):
            key = "gull_white"
        return Vector((x, y, z)), key

    grid_patch(part, P, 30, 10, point, lambda mats, i, j: mats[i][j], Vector((0, side, 0.7)))


def gull_flying_wing(part, P, side):
    """A spread wing along +Y (left) or -Y (right): cambered grey arm, white trailing edge, fingered black tips."""
    def point(u, v):
        span = u * 0.46
        lead = 0.075 - 0.07 * u ** 2
        trail = -0.12 + 0.03 * u
        x = lead + (trail - lead) * v
        z = 0.035 * math.sin(math.pi * v) * (1 - 0.5 * u) + 0.04 * u
        key = "gull_white" if v > 0.82 else "gull_gray"
        return Vector((x, side * span, z)), key

    grid_patch(part, P, 16, 8, point, lambda mats, i, j: mats[i][j], Vector((0, 0, 1)))
    for k in range(5):
        a = -0.15 - k * 0.2
        base = Vector((0.02 - k * 0.032, side * (0.44 + k * 0.006), 0.04))
        d = Vector((math.sin(a) * 0.55, side * math.cos(a), 0.01 * k)).normalized()
        n = Vector((-d.y, d.x, 0)).normalized()
        length = 0.25 - k * 0.022
        w = 0.05 - k * 0.003

        def feather_point(u, v, base=base, d=d, n=n, length=length, w=w):
            taper = (1 - u ** 1.6) * 0.5 + 0.08
            co = base + d * (u * length) + n * (v - 0.5) * w * taper * 2 + Vector((0, 0, 0.01 * math.sin(math.pi * v)))
            key = "black" if u > 0.35 else "gull_gray"
            if k < 2 and abs(u - 0.82) < 0.06 and abs(v - 0.5) < 0.25:
                key = "gull_white"
            return co, key

        grid_patch(part, P, 10, 4, feather_point, lambda mats, i, j: mats[i][j], Vector((0, 0, 1)))


def seagull(P):
    root = empty("seagull")
    body = Part()
    white, grey = P["gull_white"], P["gull_gray"]
    spine_body(body, lambda c, up: grey if up > 0.6 and -0.3 < c.x < 0.1 else white, gull_spine())
    beak_m = trs((0, 0, 0.29), scale=(1, 0.62, 1))
    body.lathe(P["beak"], [(0.33, 0.0), (0.33, 0.045), (0.4, 0.04), (0.46, 0.03), (0.52, 0.018), (0.55, 0.0)],
               matrix=beak_m @ trs((0, 0, 0.008)), segs=18)
    body.lathe(P["beak"], [(0.34, 0.0), (0.34, 0.032), (0.42, 0.026), (0.49, 0.014), (0.51, 0.0)],
               matrix=beak_m @ trs((0, 0, -0.018), scale=(1, 0.95, 0.8)), segs=16)
    body.tube(P["beak"], [(0.52, 0, 0.306), (0.555, 0, 0.298), (0.565, 0, 0.278)],
              radius=lambda t: 0.013 * (1 - t) + 0.003, segs=8)
    body.sphere(P["red"], loc=(0.47, 0, 0.262), scale=(0.016, 0.017, 0.011), segs=8, rings=6)
    body.tube(P["black"], [(0.34, -0.03, 0.29), (0.47, -0.022, 0.288)], radius=0.004, segs=4)
    body.tube(P["black"], [(0.34, 0.03, 0.29), (0.47, 0.022, 0.288)], radius=0.004, segs=4)
    for side in (-1, 1):
        eye = trs((0.33, side * 0.068, 0.338), (0, 0, side * 0.55))
        body.sphere(P["white"], matrix=eye @ trs(scale=(0.026, 0.02, 0.03)), segs=16, rings=10)
        body.sphere(P["black"], matrix=eye @ trs((0.008, side * 0.012, -0.002), scale=0.014), segs=12, rings=8)
        body.sphere(P["eye_shine"], matrix=eye @ trs((0.014, side * 0.02, 0.008), scale=0.005), segs=6, rings=4)
        brow = [(0.3, side * 0.075, 0.372), (0.33, side * 0.08, 0.37), (0.36, side * 0.073, 0.358)]
        body.tube(grey, brow, radius=lambda t: 0.009 * (1 - abs(t - 0.5)), segs=6)
    tail = [(-0.3, 0.0), (-0.36, 0.065), (-0.48, 0.06), (-0.5, 0.0), (-0.48, -0.06), (-0.36, -0.065)]
    body.extrude(white, tail, depth=0.016, loc=(0, 0, 0.165), rot=(0, 0.1, 0), bevel=0.006)
    body.build("gull_body", root)

    folded = Part()
    for side in (-1, 1):
        gull_folded_wing(folded, P, side)
    folded.build("wings_folded", root)

    for side, name in ((1, "wing_l"), (-1, "wing_r")):
        pivot = empty(name, root, (0.05, side * 0.1, 0.24))
        w = Part()
        gull_flying_wing(w, P, side)
        w.build(f"{name}_mesh", pivot)
    return root
