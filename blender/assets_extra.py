"""Scenery with character: a sunken enemy submarine broken in two, and a seagull."""
import math
import random

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


def gull_body_shape(p):
    """A plump gull: round chest, tapering rump, flattened keel so it sits on the water."""
    x, y, z = p.x, p.y, p.z
    taper = 1 - 0.55 * smooth(-x, 0.0, 1.0)
    x = x * 0.36 - 0.02
    y *= 0.17 * taper
    z = z * 0.16 * taper
    if z < -0.06:
        z = -0.06 + (z + 0.06) * 0.5
    z += 0.13 + 0.03 * smooth(x, 0.0, 0.3)
    return Vector((x, y, z))


def gull_head_shape(p):
    x, y, z = p.x * 0.12, p.y * 0.098, p.z * 0.105
    x += 0.025 * smooth(p.x, 0.2, 1.0)
    return Vector((x + 0.27, y, z + 0.3))


def feather(part, material, base, direction, length, width, matrix, tip=None, tip_len=0.0):
    """A long tapered feather lying flat in the wing plane."""
    d = Vector((direction[0], direction[1], 0)).normalized()
    n = Vector((-d.y, d.x, 0))
    b = Vector((base[0], base[1], 0))
    outline = [b + n * width * 0.5, b + d * length * 0.7 + n * width * 0.45, b + d * length,
               b + d * length * 0.7 - n * width * 0.45, b - n * width * 0.5]
    part.extrude(material, [(v.x, v.y) for v in outline], depth=0.008, matrix=matrix)
    if tip is not None:
        t0 = b + d * (length - tip_len)
        tip_outline = [t0 + n * width * 0.42, b + d * length, t0 - n * width * 0.42]
        part.extrude(tip, [(v.x, v.y) for v in tip_outline], depth=0.012, matrix=matrix)


def gull_wing(part, P, side):
    """Wing spreading along +Y (left) or -Y (right): a grey arm, white trailing edge, black-tipped primaries."""
    m = trs(scale=(1, side, 1))
    arm = [(0.08, 0.0), (0.07, 0.18), (0.03, 0.36), (-0.06, 0.42), (-0.12, 0.3), (-0.13, 0.12), (-0.11, 0.0)]
    part.extrude(P["gull_gray"], arm, depth=0.03, matrix=m, bevel=0.01)
    part.extrude(P["gull_white"], [(-0.11, 0.0), (-0.13, 0.12), (-0.12, 0.3), (-0.15, 0.28), (-0.16, 0.1),
                                   (-0.14, 0.0)], depth=0.02, matrix=m)
    for i in range(6):
        a = 1.15 + i * 0.16
        base = (0.0 - i * 0.015, 0.36 + i * 0.012)
        feather(part, P["gull_gray"], base, (math.cos(a + 0.6) * 0.3, math.sin(a + 0.6)), 0.26 - i * 0.012, 0.05, m,
                tip=P["black"], tip_len=0.11)
        if i < 3:
            part.sphere(P["gull_white"], matrix=m @ trs((base[0] - 0.02 + math.cos(a + 0.6) * 0.06,
                                                         base[1] + 0.2 - i * 0.01, 0.009), scale=(0.012, 0.012, 0.004)),
                        segs=6, rings=4)


def seagull(P):
    root = empty("seagull")
    body = Part()
    white, grey = P["gull_white"], P["gull_gray"]
    sculpt_shape(body, gull_body_shape, lambda c, n: grey if n.z > 0.45 and c.x < 0.08 else white, subdiv=4)
    sculpt_shape(body, gull_head_shape, lambda c, n: white, subdiv=4)
    beak = [(0.36, 0.0), (0.36, 0.028), (0.42, 0.022), (0.47, 0.012), (0.49, 0.0)]
    body.lathe(P["beak"], beak, matrix=trs((0, 0, 0.288), scale=(1, 0.75, 1)), segs=14)
    body.tube(P["beak"], [(0.47, 0, 0.297), (0.495, 0, 0.29), (0.5, 0, 0.276)], radius=lambda t: 0.009 * (1 - t) + 0.002,
              segs=6)
    body.sphere(P["red"], loc=(0.455, 0, 0.276), scale=(0.012, 0.014, 0.008), segs=8, rings=6)
    for side in (-1, 1):
        eye = trs((0.33, side * 0.068, 0.322), (0, 0, side * 0.4))
        body.sphere(P["black"], matrix=eye @ trs(scale=0.017), segs=10, rings=8)
        body.torus(P["beak"], matrix=eye @ trs(rot=(math.pi / 2, 0, 0)), major=0.019, minor=0.004, segs=12, tube_segs=4)
        body.sphere(P["eye_shine"], matrix=eye @ trs((0.006, side * 0.012, 0.006), scale=0.005), segs=6, rings=4)
        body.tube(P["gull_leg"], [(-0.02, side * 0.05, 0.03), (-0.06, side * 0.055, -0.03)], radius=0.01, segs=6)
        foot = [(0, 0), (0.05, 0.03), (0.06, 0.0), (0.05, -0.03)]
        body.extrude(P["gull_leg"], [(x, y) for x, y in foot], depth=0.008, loc=(-0.07, side * 0.055, -0.035),
                     rot=(0, 0.3, 0))
    for k in range(5):
        a = -0.4 + k * 0.2
        feather(body, white, (-0.25, 0.0), (-math.cos(a), math.sin(a) * 0.6), 0.15, 0.055,
                trs((0, 0, 0.14), (0, 0.12, 0)))
    body.build("gull_body", root)

    for side, name in ((1, "wing_l"), (-1, "wing_r")):
        pivot = empty(name, root, (0.04, side * 0.13, 0.24))
        w = Part()
        gull_wing(w, P, side)
        w.build(f"{name}_mesh", pivot)
    return root
