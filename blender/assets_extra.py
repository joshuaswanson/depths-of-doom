"""Scenery with character: a sunken enemy submarine broken in two, and a seagull."""
import math
import random

from assets_enemies import skull
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
    for theta in (math.radians(12), math.radians(168)):
        skull(front, P, b.frame(-1.6, theta, lift=0.02), size=1.6)
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


def seagull(P):
    root = empty("seagull")
    body = Part()
    body.sphere(P["gull_white"], loc=(0, 0, 0.14), scale=(0.34, 0.17, 0.16), segs=20, rings=12)
    body.sphere(P["gull_white"], loc=(0.27, 0, 0.29), scale=(0.12, 0.1, 0.11), segs=16, rings=10)
    body.cylinder(P["beak"], loc=(0.42, 0, 0.27), radius=0.035, radius2=0.008, depth=0.16, rot=(0, math.pi / 2, 0),
                  segs=10)
    body.sphere(P["red"], loc=(0.44, 0, 0.255), scale=0.012, segs=6, rings=4)
    for side in (-1, 1):
        body.sphere(P["black"], loc=(0.33, side * 0.075, 0.32), scale=0.016, segs=8, rings=6)
        body.sphere(P["beak"], loc=(-0.02, side * 0.06, 0.0), scale=(0.05, 0.03, 0.02), segs=8, rings=6)
    tail = [(0, -0.07), (-0.2, -0.1), (-0.22, 0.1), (0, 0.07)]
    body.extrude(P["gull_gray"], tail, depth=0.02, loc=(-0.28, 0, 0.17), rot=(0, 0.2, 0))
    body.build("gull_body", root)

    wing = [(0.1, 0.0), (0.06, 0.32), (-0.08, 0.58), (-0.2, 0.62), (-0.2, 0.3), (-0.14, 0.0)]
    tip = [(-0.08, 0.5), (-0.2, 0.62), (-0.2, 0.46)]
    for side, name in ((1, "wing_l"), (-1, "wing_r")):
        pivot = empty(name, root, (0.02, side * 0.12, 0.22))
        w = Part()
        w.extrude(P["gull_gray"], [(x, y * side) for x, y in wing], depth=0.02, bevel=0.006)
        w.extrude(P["black"], [(x, y * side) for x, y in tip], depth=0.025)
        w.build(f"{name}_mesh", pivot)
    return root
