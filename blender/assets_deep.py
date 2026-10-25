"""Deep-sea creatures. The jellyfish hangs along -Z from its bell."""
import math
import random

from mathutils import Vector

from kit import Part, empty, trs

UP = trs(rot=(0, -math.pi / 2, 0))


def ribbon_arm(part, material, heading, length, rng, rows=70, cols=7):
    """A long ruffled oral arm: a wide ribbon that spirals down from the bell, twisting and frilled at the edges."""
    bm = part.bm
    grid = []
    for r in range(rows):
        t = r / (rows - 1)
        swirl = heading + t * 2.6
        radius = 0.06 + 0.16 * t
        centre = Vector((radius * math.cos(swirl), radius * math.sin(swirl), 0.05 - t * length))
        twist = heading + t * 5.0
        side = Vector((math.cos(twist), math.sin(twist), 0.0))
        normal = Vector((-side.y, side.x, 0.0))
        width = 0.13 * (1 - 0.75 * t) + 0.02
        row = []
        for c in range(cols):
            u = -1 + 2 * c / (cols - 1)
            ruffle = math.sin(t * 46 + u * 3.0) * 0.045 * abs(u) ** 1.5 * (1 - 0.5 * t)
            row.append(bm.verts.new(centre + side * width * u + normal * ruffle))
        grid.append(row)
    faces = []
    for a, b in zip(grid, grid[1:]):
        for c in range(cols - 1):
            faces.append(bm.faces.new((a[c], a[c + 1], b[c + 1], b[c])))
    part._paint(faces, material, True)


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
        ribbon_arm(arms, P["jelly_arm"], i * math.pi / 2 + 0.3, rng.uniform(2.4, 3.2), rng)
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
