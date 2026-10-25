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


def anglerfish(P):
    root = empty("anglerfish")
    body = Part()
    blob(body, P["angler_skin"], loc=(0, 0, 0), scale=(1.0, 0.78, 0.82), seed=12, amount=0.08, freq=2.2, subdiv=4)
    blob(body, P["angler_belly"], loc=(0.05, 0, -0.32), scale=(0.75, 0.62, 0.5), seed=3, amount=0.06, freq=2.5)
    body.sphere(P["angler_mouth"], loc=(0.62, 0, -0.08), scale=(0.32, 0.5, 0.28), segs=20, rings=12)
    for i in range(11):
        t = -1 + 2 * i / 10
        a = t * 1.25
        size = 0.16 if i % 3 == 1 else 0.1
        x, y = 0.55 + 0.32 * math.cos(a), 0.52 * math.sin(a)
        body.cylinder(P["tooth"], matrix=trs((x, y, 0.0), (0.15 * t, math.pi + 0.2, 0)), loc=(0, 0, size / 2),
                      radius=0.03, radius2=0.0, depth=size, segs=8)
    for side in (-1, 1):
        body.sphere(P["angler_eye"], loc=(0.58, side * 0.42, 0.3), scale=0.085, segs=14, rings=10)
        body.sphere(P["black"], loc=(0.65, side * 0.46, 0.31), scale=0.035, segs=10, rings=8)
        fin = [(0, 0), (-0.15, 0.35), (-0.4, 0.42), (-0.45, 0.2), (-0.3, 0.0)]
        body.extrude(P["angler_fin"], fin, depth=0.03, loc=(-0.05, side * 0.66, -0.15),
                     rot=(math.pi / 2 * side - 0.3 * side, 0, 0.2), bevel=0.01)
    tail = [(0, 0), (-0.5, 0.45), (-0.62, 0.3), (-0.55, 0.0), (-0.62, -0.3), (-0.5, -0.45)]
    body.extrude(P["angler_fin"], tail, depth=0.04, loc=(-0.9, 0, 0.05), rot=(math.pi / 2, 0, 0), bevel=0.012)
    for i in range(5):
        x = -0.1 - i * 0.16
        body.tube(P["angler_fin"], [(x, 0, 0.7 - i * 0.06), (x - 0.08, 0, 0.95 - i * 0.08)],
                  radius=lambda t: 0.025 * (1 - t) + 0.005, segs=6)
    for i in range(7):
        a = -0.6 + i * 0.2
        body.sphere(P["angler_spot"], loc=(-0.1 + 0.5 * math.cos(a) * 0.4, 0.74 * math.cos(a * 0.6), -0.05 - 0.1 * i % 3),
                    scale=0.03, segs=6, rings=4)
    body.build("angler_body", root)

    jaw = empty("jaw", root, (0.05, 0, -0.15))
    j = Part()
    j.sphere(P["angler_skin"], loc=(0.48, 0, -0.18), scale=(0.55, 0.62, 0.22), segs=24, rings=12)
    for i in range(10):
        t = -1 + 2 * i / 9
        a = t * 1.2
        size = 0.2 if i % 2 == 0 else 0.12
        x, y = 0.62 + 0.42 * math.cos(a), 0.55 * math.sin(a)
        j.cylinder(P["tooth"], matrix=trs((x, y, -0.08), (-0.2 * t, -0.15 + (0.25 if i % 3 == 0 else 0), 0)),
                   loc=(0, 0, size / 2), radius=0.035, radius2=0.0, depth=size, segs=8)
    j.build("jaw_mesh", jaw)

    lure = empty("lure", root, (0.35, 0, 0.72))
    rod = Part()
    pts = [(0, 0, 0), (0.15, 0, 0.35), (0.45, 0, 0.55), (0.8, 0, 0.5), (1.0, 0, 0.32)]
    rod.tube(P["angler_fin"], pts, radius=lambda t: 0.028 * (1 - 0.6 * t), segs=8)
    rod.sphere(P["angler_lure"], loc=(1.02, 0, 0.22), scale=0.11, segs=16, rings=10)
    for k in range(3):
        a = -0.6 + k * 0.6
        rod.tube(P["angler_lure"], [(1.02, 0, 0.12), (1.02 + 0.08 * math.sin(a), 0.05 * a, -0.05)], radius=0.008, segs=4)
    rod.build("lure_mesh", lure)
    return root
