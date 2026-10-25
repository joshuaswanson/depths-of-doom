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


def outline_plate(part, material, pts, thickness, matrix, bevel=0.008):
    part.extrude(material, pts, depth=thickness, matrix=matrix, bevel=bevel)


def gull_folded_wing(part, P, side):
    """A wing tucked along the back, its black-and-white tip crossing over the tail."""
    m = trs((0.0, side * 0.105, 0.215), (side * -0.5, 0.06, 0))
    wing = [(0.14, 0.0), (0.12, 0.035), (0.06, 0.068), (-0.04, 0.085), (-0.16, 0.083), (-0.27, 0.068), (-0.35, 0.045),
            (-0.37, 0.01), (-0.33, -0.022), (0.08, -0.034), (0.13, -0.018)]
    outline_plate(part, P["gull_gray"], [(x, y * side) for x, y in wing], 0.045, m, bevel=0.016)
    edge = [(0.06, -0.025), (-0.3, -0.015), (-0.3, -0.03), (0.06, -0.04)]
    outline_plate(part, P["gull_white"], [(x, y * side) for x, y in edge], 0.032, m, bevel=0.004)
    tip = [(-0.3, 0.06), (-0.4, 0.045), (-0.5, 0.015), (-0.5, -0.005), (-0.4, -0.01), (-0.3, -0.012)]
    outline_plate(part, P["black"], [(x, y * side) for x, y in tip], 0.026, m @ trs((0, 0, 0.004)), bevel=0.004)
    for x in (-0.42, -0.47):
        part.sphere(P["gull_white"], matrix=m @ trs((x, 0.012 * side, 0.016), scale=(0.014, 0.01, 0.004)), segs=8, rings=4)


def gull_flying_wing(part, P, side):
    """A spread wing along +Y (left) or -Y (right): grey arm and hand, white trailing edge, fingered black tips."""
    m = trs(scale=(1, side, 1)) @ trs(rot=(0.12, 0, 0))
    arm = [(0.07, 0.0), (0.075, 0.2), (0.05, 0.42), (-0.02, 0.5), (-0.1, 0.45), (-0.12, 0.25), (-0.11, 0.0)]
    outline_plate(part, P["gull_gray"], arm, 0.028, m, bevel=0.01)
    trailing = [(-0.11, 0.0), (-0.12, 0.25), (-0.1, 0.45), (-0.13, 0.43), (-0.15, 0.24), (-0.14, 0.0)]
    outline_plate(part, P["gull_white"], trailing, 0.022, m, bevel=0.005)
    for i in range(5):
        a = 0.35 + i * 0.32
        base = (0.03 - i * 0.03, 0.44 + i * 0.012)
        length = 0.24 - i * 0.02
        d = (math.sin(a) * -0.45 + 0.15, math.cos(a) * 0.35 + 0.8)
        n = math.hypot(*d)
        d = (d[0] / n, d[1] / n)
        nx, ny = -d[1], d[0]
        w = 0.042
        tip = (base[0] + d[0] * length, base[1] + d[1] * length)
        feather = [(base[0] + nx * w / 2, base[1] + ny * w / 2), (tip[0] + nx * w * 0.3, tip[1] + ny * w * 0.3), tip,
                   (tip[0] - nx * w * 0.3, tip[1] - ny * w * 0.3), (base[0] - nx * w / 2, base[1] - ny * w / 2)]
        outline_plate(part, P["gull_gray"] if i > 3 else P["black"], feather, 0.012, m @ trs((0, 0, 0.004 * i)),
                      bevel=0.003)
        if i < 2:
            part.sphere(P["gull_white"], matrix=m @ trs((tip[0] - d[0] * 0.05, tip[1] - d[1] * 0.05, 0.012),
                                                        scale=(0.014, 0.014, 0.004)), segs=8, rings=4)


def seagull(P):
    root = empty("seagull")
    body = Part()
    white, grey = P["gull_white"], P["gull_gray"]
    spine_body(body, lambda c, up: grey if up > 0.55 and -0.3 < c.x < 0.12 else white, gull_spine())
    beak_m = trs((0, 0, 0.292), scale=(1, 0.7, 1))
    body.lathe(P["beak"], [(0.35, 0.0), (0.35, 0.034), (0.41, 0.028), (0.47, 0.016), (0.5, 0.0)], matrix=beak_m, segs=16)
    body.tube(P["beak"], [(0.465, 0, 0.308), (0.5, 0, 0.302), (0.51, 0, 0.282)], radius=lambda t: 0.011 * (1 - t) + 0.003,
              segs=8)
    body.sphere(P["red"], loc=(0.455, 0, 0.274), scale=(0.013, 0.016, 0.009), segs=8, rings=6)
    for side in (-1, 1):
        eye = trs((0.325, side * 0.075, 0.33), (0, 0, side * 0.45))
        body.sphere(P["gull_eye"], matrix=eye @ trs(scale=(0.016, 0.012, 0.016)), segs=12, rings=8)
        body.sphere(P["black"], matrix=eye @ trs((0.004, side * 0.006, 0), scale=0.009), segs=8, rings=6)
        body.sphere(P["eye_shine"], matrix=eye @ trs((0.008, side * 0.01, 0.006), scale=0.004), segs=6, rings=4)
    tail = [(-0.3, 0.0), (-0.36, 0.06), (-0.47, 0.055), (-0.49, 0.0), (-0.47, -0.055), (-0.36, -0.06)]
    body.extrude(white, tail, depth=0.016, loc=(0, 0, 0.165), rot=(0, 0.1, 0), bevel=0.006)
    for side in (-1, 1):
        body.tube(P["gull_leg"], [(-0.02, side * 0.05, 0.04), (-0.07, side * 0.055, -0.02)], radius=0.009, segs=6)
        body.extrude(P["gull_leg"], [(0, 0), (0.05, 0.03), (0.065, 0.0), (0.05, -0.03)], depth=0.007,
                     loc=(-0.08, side * 0.055, -0.025), rot=(0, 0.35, 0))
    body.build("gull_body", root)

    folded = Part()
    for side in (-1, 1):
        gull_folded_wing(folded, P, side)
    folded.build("wings_folded", root)

    for side, name in ((1, "wing_l"), (-1, "wing_r")):
        pivot = empty(name, root, (0.05, side * 0.11, 0.24))
        w = Part()
        gull_flying_wing(w, P, side)
        w.build(f"{name}_mesh", pivot)
    return root
