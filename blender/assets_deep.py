"""Deep-sea creatures. The jellyfish hangs along -Z from its bell; the anglerfish faces +X."""
import math
import random

from assets_env import blob
from kit import Part, empty, trs

UP = trs(rot=(0, -math.pi / 2, 0))


def deep_jelly(P):
    rng = random.Random(4)
    root = empty("deep_jelly")
    bell = Part()
    shell = [(0.62, 0.0), (0.58, 0.22), (0.48, 0.4), (0.32, 0.54), (0.15, 0.62), (0.0, 0.64), (-0.04, 0.6),
             (0.04, 0.52), (0.2, 0.44), (0.34, 0.3), (0.42, 0.14), (0.45, 0.0)]
    bell.lathe(P["jelly_bell"], shell, segs=48, matrix=UP)
    for i in range(20):
        a = 2 * math.pi * i / 20
        bell.sphere(P["jelly_glow"], loc=(0.64 * math.cos(a), 0.64 * math.sin(a), -0.02),
                    scale=(0.045, 0.045, 0.03), segs=8, rings=6)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        bell.torus(P["jelly_organ"], loc=(0.17 * math.cos(a), 0.17 * math.sin(a), 0.28), major=0.09, minor=0.025,
                   rot=(0, 0, a), segs=16, tube_segs=6)
    bell.sphere(P["jelly_organ"], loc=(0, 0, 0.3), scale=(0.08, 0.08, 0.06), segs=12, rings=8)
    bell.build("jelly_bell_mesh", root)

    arms = Part()
    for i in range(4):
        a = i * math.pi / 2 + 0.3
        pts = []
        for k in range(30):
            t = k / 29
            swirl = a + t * 3.2
            r = 0.08 + 0.12 * t
            pts.append((r * math.cos(swirl), r * math.sin(swirl), 0.05 - t * 1.7))
        arms.tube(P["jelly_arm"], pts, radius=lambda t: (0.07 + 0.035 * math.sin(t * 42)) * (1 - 0.6 * t), segs=8)
    arms.build("jelly_arms", root)

    tentacles = Part()
    for i in range(18):
        a = 2 * math.pi * (i + 0.5) / 18
        length = rng.uniform(2.0, 3.2)
        phase = rng.uniform(0, 6.28)
        pts = []
        for k in range(24):
            t = k / 23
            r = 0.6 - 0.1 * t
            pts.append((r * math.cos(a) + 0.06 * math.sin(phase + t * 9), r * math.sin(a), -t * length))
        tentacles.tube(P["jelly_tentacle"], pts, radius=lambda t: 0.016 * (1 - 0.7 * t), segs=5)
    tentacles.build("jelly_tentacles", root)
    return root


def fin_fan(part, P, base, spread, length, rays, matrix):
    """A ribbed fin: spines fanning out from `base` with see-through webbing between them."""
    pts = []
    for i in range(rays):
        a = spread[0] + (spread[1] - spread[0]) * i / (rays - 1)
        tip = (base[0] + math.cos(a) * length * (0.8 + 0.2 * math.sin(i * 1.7)), base[1] + math.sin(a) * length)
        pts.append(tip)
        part.tube(P["angler_fin"], [(base[0], base[1], 0), (tip[0], tip[1], 0)], radius=lambda t: 0.018 * (1 - t) + 0.004,
                  segs=5, matrix=matrix)
    part.extrude(P["angler_membrane"], [base] + pts, depth=0.012, matrix=matrix)


def anglerfish(P):
    rng = random.Random(21)
    root = empty("anglerfish")
    body = Part()
    profile = [(-1.15, 0.0), (-1.1, 0.12), (-0.9, 0.24), (-0.5, 0.5), (-0.1, 0.74), (0.3, 0.84), (0.6, 0.8),
               (0.82, 0.66), (0.95, 0.42), (1.0, 0.0)]
    body.lathe(P["angler_skin"], profile, segs=40, matrix=trs(scale=(1, 0.82, 1)))
    body.sphere(P["angler_belly"], loc=(0.15, 0, -0.42), scale=(0.75, 0.6, 0.38), segs=28, rings=14)
    body.sphere(P["angler_mouth"], loc=(0.78, 0, -0.12), scale=(0.3, 0.52, 0.32), segs=24, rings=14)
    body.sphere(P["angler_throat"], loc=(0.62, 0, -0.14), scale=(0.08, 0.2, 0.12), segs=12, rings=8)
    for i in range(13):
        t = -1 + 2 * i / 12
        a = t * 1.2
        size = rng.uniform(0.16, 0.3) if i % 2 == 0 else rng.uniform(0.1, 0.16)
        x, y = 0.74 + 0.28 * math.cos(a), 0.5 * math.sin(a)
        body.cylinder(P["tooth"], matrix=trs((x, y, 0.08), (0.2 * t, math.pi - 0.15, 0)), loc=(0, 0, size / 2),
                      radius=0.026, radius2=0.002, depth=size, segs=8)
    for side in (-1, 1):
        eye = trs((0.66, side * 0.5, 0.36), (0, 0, side * 0.5))
        body.sphere(P["angler_eye"], matrix=eye @ trs(scale=0.12), segs=18, rings=12)
        body.sphere(P["black"], matrix=eye @ trs((0.06, side * 0.05, 0), scale=(0.035, 0.02, 0.08)), segs=10, rings=8)
        body.sphere(P["eye_shine"], matrix=eye @ trs((0.08, side * 0.06, 0.05), scale=0.02), segs=6, rings=4)
        body.torus(P["angler_fin"], matrix=eye, loc=(0, 0, 0), major=0.12, minor=0.02, rot=(0, math.pi / 2, 0),
                   segs=20, tube_segs=6)
        fin_fan(body, P, (0.0, 0.0), (2.2, 3.6), 0.55, 6,
                trs((0.0, side * 0.62, -0.18), (side * 1.2, 0, 0)))
        for k in range(9):
            x = 0.45 - k * 0.15
            body.sphere(P["angler_spot"], loc=(x, side * (0.66 - 0.05 * k), -0.05 + 0.02 * math.sin(k)),
                        scale=0.028, segs=8, rings=6)
    for _ in range(40):
        a = rng.uniform(0.2, 2.9)
        x = rng.uniform(-0.6, 0.7)
        r = 0.82 * max(0.3, 1 - abs(x - 0.3) * 0.6)
        body.sphere(P["angler_speck"], loc=(x, -r * math.cos(a) * 0.82 * rng.choice((1, -1)), r * math.sin(a) * 0.95),
                    scale=(rng.uniform(0.03, 0.07), rng.uniform(0.03, 0.07), 0.015), segs=6, rings=4)
    fin_fan(body, P, (0.0, 0.0), (0.35, 2.75), 0.7, 9, trs((-1.05, 0, 0.05), (math.pi / 2, 0, math.pi)))
    fin_fan(body, P, (0.0, 0.0), (1.2, 2.2), 0.55, 7, trs((-0.35, 0, 0.62), (math.pi / 2, 0, -0.3)))
    body.build("angler_body", root)

    jaw = empty("jaw", root, (0.25, 0, -0.25))
    j = Part()
    j.sphere(P["angler_skin"], loc=(0.48, 0, -0.06), scale=(0.62, 0.62, 0.2), segs=28, rings=14)
    j.sphere(P["angler_mouth"], loc=(0.55, 0, 0.06), scale=(0.45, 0.48, 0.08), segs=20, rings=10)
    for i in range(15):
        t = -1 + 2 * i / 14
        a = t * 1.15
        size = rng.uniform(0.2, 0.38) if i % 2 == 0 else rng.uniform(0.12, 0.2)
        x, y = 0.6 + 0.48 * math.cos(a), 0.56 * math.sin(a)
        j.cylinder(P["tooth"], matrix=trs((x, y, 0.02), (-0.25 * t, -0.2 + rng.uniform(-0.1, 0.15), 0)),
                   loc=(0, 0, size / 2), radius=0.03, radius2=0.002, depth=size, segs=8)
    for k in range(5):
        a = -0.8 + k * 0.4
        j.sphere(P["angler_spot"], loc=(0.75 + 0.3 * math.cos(a), 0.45 * math.sin(a), -0.18), scale=0.025, segs=6, rings=4)
    j.build("jaw_mesh", jaw)

    lure = empty("lure", root, (0.45, 0, 0.78))
    rod = Part()
    pts = [(0, 0, 0), (0.08, 0, 0.3), (0.3, 0, 0.55), (0.62, 0, 0.62), (0.9, 0, 0.5), (1.05, 0, 0.3)]
    rod.tube(P["angler_fin"], pts, radius=lambda t: 0.035 * (1 - 0.65 * t), segs=8)
    for p in pts[1:-1]:
        rod.sphere(P["angler_fin"], loc=p, scale=0.03, segs=8, rings=6)
    rod.sphere(P["angler_lure"], loc=(1.07, 0, 0.16), scale=0.09, segs=16, rings=10)
    rod.sphere(P["angler_bulb"], loc=(1.07, 0, 0.17), scale=(0.15, 0.15, 0.17), segs=20, rings=12)
    for k in range(4):
        a = -0.9 + k * 0.6
        rod.tube(P["angler_lure"], [(1.07, 0, 0.02), (1.07 + 0.1 * math.sin(a), 0.07 * a, -0.14)], radius=0.008,
                 segs=4)
    rod.build("lure_mesh", lure)
    empty("lure_tip", lure, (1.07, 0, 0.17))
    return root
