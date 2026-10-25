"""Sunken ruins and seabed props. Each prop stands on z = 0."""
import math
import random

import bmesh
from mathutils import Vector, noise

from kit import Part, empty, trs


def blob(part, material, loc=(0, 0, 0), scale=(1, 1, 1), seed=0, amount=0.25, freq=1.6, subdiv=3):
    res = bmesh.ops.create_icosphere(part.bm, subdivisions=subdiv, radius=1.0)
    off = Vector((seed * 7.31, seed * 3.17, seed * 5.93))
    for v in res["verts"]:
        d = noise.noise(v.co * freq + off) + 0.5 * noise.noise(v.co * freq * 2.3 + off)
        v.co *= 1 + amount * d
    bmesh.ops.transform(part.bm, matrix=trs(loc, scale=scale), verts=res["verts"])
    return part._paint(part._faces_of(res["verts"]), material, True)


def moss_cap(part, P, rng, loc, size):
    x, y, z = loc
    part.box(P["moss"], loc=(x, y, z + 0.04), size=(size[0] * 1.04, size[1] * 1.04, 0.1), bevel=0.04)
    for _ in range(rng.randint(2, 4)):
        side = rng.choice((-1, 1))
        if rng.random() < 0.5:
            dx, dy, sx, sy = side * size[0] * 0.52, rng.uniform(-0.3, 0.3) * size[1], 0.06, rng.uniform(0.2, 0.45)
        else:
            dx, dy, sx, sy = rng.uniform(-0.3, 0.3) * size[0], side * size[1] * 0.52, rng.uniform(0.2, 0.45), 0.06
        drop = rng.uniform(0.15, 0.45)
        part.box(P["moss"], loc=(x + dx, y + dy, z - drop / 2 + 0.05), size=(sx, sy, drop), bevel=0.025)


def pillar_mesh(part, P, rng, x=0.0, height=5.0, width=1.2, broken=False):
    part.box(P["stone_dark"], loc=(x, 0, 0.2), size=(width * 1.35, width * 1.35, 0.4), bevel=0.06)
    z = 0.4
    while z < height - 0.3:
        h = rng.uniform(0.7, 1.0)
        w = width * rng.uniform(0.92, 1.0)
        tilt = (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), rng.uniform(-0.12, 0.12))
        if broken and z + h >= height - 0.3:
            tilt = (rng.uniform(-0.25, 0.25), rng.uniform(-0.1, 0.1), rng.uniform(-0.4, 0.4))
        part.box(P["stone"], loc=(x + rng.uniform(-0.06, 0.06), rng.uniform(-0.04, 0.04), z + h / 2), size=(w, w, h),
                 rot=tilt, bevel=0.07)
        z += h
    if not broken:
        part.box(P["stone_dark"], loc=(x, 0, z + 0.18), size=(width * 1.4, width * 1.4, 0.36), bevel=0.06)
        z += 0.36
    moss_cap(part, P, rng, (x, 0, z), (width * (1.4 if not broken else 1.0),) * 2)
    return z


def ruin_pillar(P, name="ruin_pillar", seed=1, height=5.5, broken=False):
    rng = random.Random(seed)
    root = empty(name)
    part = Part()
    pillar_mesh(part, P, rng, height=height, broken=broken)
    part.build(f"{name}_mesh", root)
    return root


def ruin_pillar_a(P):
    return ruin_pillar(P, "ruin_pillar_a", seed=3, height=6.0)


def ruin_pillar_b(P):
    return ruin_pillar(P, "ruin_pillar_b", seed=8, height=3.4, broken=True)


def ruin_arch(P):
    rng = random.Random(11)
    root = empty("ruin_arch")
    part = Part()
    top = max(pillar_mesh(part, P, rng, x=-2.2, height=4.6), pillar_mesh(part, P, rng, x=2.2, height=4.6))
    for i, x in enumerate((-2.1, -0.7, 0.7, 2.1)):
        part.box(P["stone"], loc=(x, 0, top + 0.45), size=(1.38, 1.1, 0.8), rot=(0, 0, rng.uniform(-0.05, 0.05)),
                 bevel=0.07)
    moss_cap(part, P, rng, (0, 0, top + 0.85), (5.6, 1.1))
    part.build("ruin_arch_mesh", root)
    return root


def ruin_wall(P):
    rng = random.Random(21)
    root = empty("ruin_wall")
    part = Part()
    for row in range(5):
        z = 0.45 + row * 0.85
        offset = 0.5 if row % 2 else 0.0
        count = 6 - row
        for i in range(count):
            x = -2.5 + offset + i * 1.05 + rng.uniform(-0.04, 0.04)
            if row in (2, 3) and i == 2:
                continue
            part.box(P["stone"] if rng.random() > 0.3 else P["stone_dark"], loc=(x, 0, z), size=(1.0, 0.9, 0.82),
                     rot=(0, 0, rng.uniform(-0.04, 0.04)), bevel=0.06)
        if row == 4:
            moss_cap(part, P, rng, (-2.5 + offset + (count - 1) * 0.52, 0, z + 0.4), (count * 0.6, 0.9))
    part.build("ruin_wall_mesh", root)
    return root


def ruin_pier(P):
    rng = random.Random(31)
    root = empty("ruin_pier")
    part = Part()
    length = 14.0
    deck_z = 3.2
    for i in range(int(length / 1.4)):
        x = -length / 2 + 0.7 + i * 1.4
        drop = 0.0 if 2 < i < 8 else rng.uniform(-0.3, 0.1)
        part.box(P["stone"], loc=(x, 0, deck_z + drop), size=(1.36, 1.6, 0.32), rot=(0, rng.uniform(-0.05, 0.05), 0),
                 bevel=0.05)
    for x in (-5.6, -2.8, 0.0, 2.8, 5.6):
        part.box(P["stone_dark"], loc=(x, 0, deck_z / 2 - 0.1), size=(0.5, 0.5, deck_z), bevel=0.05)
        part.box(P["stone_dark"], loc=(x, 0, 0.15), size=(0.8, 0.8, 0.3), bevel=0.05)
    for x0 in (-5.6, -2.8, 0.0, 2.8):
        for d in (1, -1):
            a, b = Vector((x0 + (0 if d > 0 else 2.8), 0.3, 0.3)), Vector((x0 + (2.8 if d > 0 else 0), 0.3, deck_z - 0.3))
            mid = (a + b) / 2
            ang = math.atan2(b.z - a.z, b.x - a.x)
            part.box(P["stone_dark"], loc=mid, size=((b - a).length, 0.18, 0.2), rot=(0, -ang, 0), bevel=0.03)
    for i in range(7):
        x = rng.uniform(-6, 6)
        part.box(P["moss"], loc=(x, 0, deck_z + 0.18), size=(rng.uniform(0.6, 1.6), 1.64, 0.08), bevel=0.03)
    part.build("ruin_pier_mesh", root)
    return root


def ruin_tower(P):
    rng = random.Random(41)
    root = empty("ruin_tower")
    part = Part()
    z = 0.0
    w = 2.6
    for level in range(6):
        h = 1.6
        part.box(P["stone"], loc=(rng.uniform(-0.05, 0.05), 0, z + h / 2), size=(w, w, h),
                 rot=(0, 0, rng.uniform(-0.03, 0.03)), bevel=0.08)
        part.box(P["stone_dark"], loc=(0, 0, z + h), size=(w + 0.2, w + 0.2, 0.2), bevel=0.05)
        if level > 0:
            part.box(P["black"], loc=(0, -w / 2, z + h / 2), size=(0.5, 0.1, 0.8), bevel=0.0)
        z += h
        w *= 0.94
    for i in range(4):
        for s in (-1, 1):
            part.box(P["stone"], loc=(-w / 2 + 0.3 + i * (w - 0.6) / 3, s * (w / 2 - 0.2), z + 0.35),
                     size=(0.4, 0.4, 0.6), bevel=0.05)
    moss_cap(part, P, rng, (0, 0, z), (w, w))
    part.build("ruin_tower_mesh", root)
    return root


def anchor(P):
    root = empty("anchor")
    part = Part()
    m = P["rust"]
    part.cylinder(m, loc=(0, 0, 1.6), radius=0.13, depth=3.0, segs=16, bevel=0.03)
    part.torus(m, loc=(0, 0, 3.3), major=0.28, minor=0.08, rot=(math.pi / 2, 0, 0), segs=24)
    part.cylinder(m, loc=(0, 0, 2.7), radius=0.09, depth=1.6, rot=(0, math.pi / 2, 0), segs=12, bevel=0.03)
    for s in (-1, 1):
        part.sphere(m, loc=(s * 0.82, 0, 2.7), scale=0.13, segs=12, rings=8)
    arc = [(1.2 * math.sin(a), 0, 1.25 - 1.2 * math.cos(a)) for a in (math.radians(t) for t in range(-70, 71, 10))]
    part.tube(m, arc, radius=0.12, segs=14)
    for s in (-1, 1):
        tip = Vector(arc[0] if s < 0 else arc[-1])
        part.extrude(m, [(0, -0.05), (s * -0.5, -0.25), (s * -0.15, 0.25), (s * 0.1, 0.45)], depth=0.1,
                     loc=tip + Vector((0, 0, 0.05)), rot=(math.pi / 2, 0, 0), bevel=0.03)
    part.build("anchor_mesh", root)
    return root


def chain(P):
    root = empty("chain")
    part = Part()
    for i in range(14):
        part.torus(P["rust"], loc=(0, 0, 0.18 + i * 0.36), major=0.16, minor=0.055, scale=(1, 1, 1.5),
                   rot=(math.pi / 2, 0, (math.pi / 2) * (i % 2)), segs=18, tube_segs=8)
    part.build("chain_mesh", root)
    return root


def seaweed(P, name, seed, strands=4, height=3.5):
    rng = random.Random(seed)
    root = empty(name)
    part = Part()
    for s in range(strands):
        h = height * rng.uniform(0.6, 1.0)
        bx, by = rng.uniform(-0.35, 0.35), rng.uniform(-0.2, 0.2)
        phase = rng.uniform(0, 6.28)
        pts = [(bx + 0.18 * math.sin(phase + t * 5.0) * t, by, h * t) for t in (i / 14 for i in range(15))]
        mat = P["seaweed"] if s % 2 == 0 else P["seaweed_dark"]
        part.tube(mat, pts, radius=lambda t: 0.16 * (1 - t) ** 0.6 + 0.02, segs=8,
                  matrix=trs((bx, by, 0), scale=(1, 0.35, 1)) @ trs((-bx, -by, 0)))
    part.build(f"{name}_mesh", root)
    return root


def seaweed_a(P):
    return seaweed(P, "seaweed_a", 1, strands=4, height=3.6)


def seaweed_b(P):
    return seaweed(P, "seaweed_b", 2, strands=6, height=2.4)


def coral_branch(P, name="coral_branch", mat="coral_pink", seed=5):
    rng = random.Random(seed)
    root = empty(name)
    part = Part()

    def grow(start, direction, length, radius, depth):
        end = start + direction * length
        part.tube(P[mat], [start, (start + end) / 2, end], radius=lambda t: radius * (1 - 0.3 * t), segs=10)
        part.sphere(P[mat], loc=end, scale=radius * 0.75, segs=10, rings=8)
        if depth > 0:
            for _ in range(3):
                d = (direction + Vector((rng.uniform(-1.3, 1.3), rng.uniform(-0.4, 0.4), rng.uniform(0.0, 0.5))))
                grow(end, d.normalized(), length * 0.72, radius * 0.72, depth - 1)

    grow(Vector((0, 0, 0)), Vector((0, 0, 1)), 0.4, 0.11, 3)
    part.build(f"{name}_mesh", root)
    return root


def coral_pink(P):
    return coral_branch(P, "coral_pink", "coral_pink", 5)


def coral_orange(P):
    return coral_branch(P, "coral_orange", "coral_orange", 9)


def coral_brain(P):
    root = empty("coral_brain")
    part = Part()
    blob(part, P["coral_purple"], loc=(0, 0, 0.35), scale=(0.7, 0.6, 0.5), seed=4, amount=0.12, freq=5.0, subdiv=4)
    blob(part, P["coral_purple"], loc=(0.55, 0.1, 0.22), scale=(0.35, 0.32, 0.3), seed=9, amount=0.12, freq=5.0)
    part.build("coral_brain_mesh", root)
    return root


def rock(P, name, seed, scale):
    root = empty(name)
    part = Part()
    blob(part, P["rock"], loc=(0, 0, scale[2] * 0.55), scale=scale, seed=seed, amount=0.35, freq=1.3)
    rng = random.Random(seed)
    for _ in range(3):
        blob(part, P["moss"], loc=(rng.uniform(-0.3, 0.3) * scale[0], rng.uniform(-0.3, 0.3) * scale[1], scale[2] * 1.3),
             scale=(scale[0] * 0.35, scale[1] * 0.35, 0.12), seed=seed + 50, amount=0.3, freq=2.0, subdiv=2)
    part.build(f"{name}_mesh", root)
    return root


def rock_a(P):
    return rock(P, "rock_a", 2, (1.4, 1.0, 0.8))


def rock_b(P):
    return rock(P, "rock_b", 7, (0.8, 0.7, 0.6))


ENV_ASSETS = ("ruin_pillar_a", "ruin_pillar_b", "ruin_arch", "ruin_wall", "ruin_pier", "ruin_tower", "anchor",
              "chain", "seaweed_a", "seaweed_b", "coral_pink", "coral_orange", "coral_brain", "rock_a", "rock_b")
