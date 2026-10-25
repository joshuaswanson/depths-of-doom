"""Deep-sea creatures. The jellyfish hangs along -Z from its bell; the anglerfish faces +X."""
import math
import random

import bmesh
from mathutils import Vector, noise

from assets_env import blob
from kit import Part, empty, frame, trs

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


def smooth(v, a, b):
    t = max(0.0, min(1.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def bump(v, center, width):
    return math.exp(-((v - center) / width) ** 2)


def sculpt(part, deform, materials, subdiv=5):
    """Deform a dense icosphere into an organic shape; `materials(center, normal)` picks each face's material."""
    verts = bmesh.ops.create_icosphere(part.bm, subdivisions=subdiv, radius=1.0)["verts"]
    for v in verts:
        v.co = deform(Vector(v.co))
    faces = part._faces_of(verts)
    bmesh.ops.recalc_face_normals(part.bm, faces=faces)
    groups = {}
    for f in faces:
        f.normal_update()
        groups.setdefault(materials(f.calc_center_median(), f.normal), []).append(f)
    for material, group in groups.items():
        part._paint(group, material, True)


def mouth_weight(x, y, z):
    return smooth(x, 0.42, 0.86) * bump(z, -0.12, 0.24) * bump(y, 0.0, 0.6)


def angler_body_shape(p):
    x, y, z = p.x, p.y, p.z
    weight = mouth_weight(x, y, z)
    if x < 0:
        t = -x
        x *= 1.6
        k = max(0.16, 1 - 0.66 * t ** 1.3)
        y *= k
        z *= k
    z *= 0.84 + 0.14 * smooth(x, -0.3, 0.6)
    y *= 0.8
    if z < -0.48:
        z = -0.48 + (z + 0.48) * 0.55
    x -= 0.44 * weight
    z -= 0.05 * weight
    out = Vector((x, y, z))
    n = out.normalized()
    for side in (-1, 1):
        out += n * 0.13 * bump(x, 0.52, 0.2) * bump(y, side * 0.42, 0.16) * bump(z, 0.46, 0.13)
    out += n * 0.05 * bump(y, 0.0, 0.1) * smooth(z, 0.3, 0.7) * bump(x, -0.2, 0.45)
    out += n * 0.06 * bump(x, 0.42, 0.12) * bump(y, 0.0, 0.12) * smooth(z, 0.55, 0.85)
    out += n * 0.018 * noise.noise(out * 7.0)
    return out


def angler_jaw_shape(p):
    x, y, z = p.x * 0.58 + 0.38, p.y * 0.48, p.z * 0.22
    if z > 0:
        z *= 0.35
    z += 0.13 * smooth(x, 0.72, 1.12)
    y *= 1 - 0.3 * smooth(x, 0.65, 0.96)
    out = Vector((x, y, z))
    return out + out.normalized() * 0.012 * noise.noise(out * 9.0)


def on_surface(shape, direction, inset=0.0):
    """Point on a sculpted surface along a direction from its center, with an outward normal."""
    d = Vector(direction).normalized()
    p = shape(d)
    e = 0.01
    t1 = d.orthogonal().normalized()
    t2 = d.cross(t1).normalized()
    a = shape((d + t1 * e).normalized()) - p
    b = shape((d + t2 * e).normalized()) - p
    n = a.cross(b).normalized()
    if n.dot(p) < 0:
        n = -n
    return p - n * inset, n


def fang(part, material, base, direction, length, curl, rng):
    d = Vector(direction).normalized()
    side = d.cross(Vector((0, 0, 1))).normalized() if abs(d.z) < 0.95 else Vector((0, 1, 0))
    bend = side.cross(d).normalized() * curl
    pts = [Vector(base) + d * length * t + bend * length * t * t for t in (0, 0.33, 0.66, 1.0)]
    part.tube(material, pts, radius=lambda t: 0.028 * (1 - t) + 0.002, segs=8)


def anglerfish(P):
    rng = random.Random(21)
    root = empty("anglerfish")
    body = Part()
    skin, mouth = P["angler_skin"], P["angler_mouth"]
    sculpt(body, angler_body_shape, lambda c, n: mouth if mouth_weight(c.x + 0.44, c.y, c.z + 0.05) > 0.45 and
           c.x > 0.2 else skin)
    body.sphere(P["angler_throat"], loc=(0.36, 0, -0.16), scale=(0.06, 0.18, 0.1), segs=14, rings=8)
    for i in range(15):
        t = -1 + 2 * i / 14
        a = t * 1.15
        base = (0.62 + 0.24 * math.cos(a), 0.5 * math.sin(a), 0.04)
        length = rng.uniform(0.18, 0.3) if i % 2 == 0 else rng.uniform(0.09, 0.15)
        fang(body, P["tooth"], base, (0.25, -0.15 * t, -1.0), length, 0.25, rng)
    for side in (-1, 1):
        eye, normal = on_surface(angler_body_shape, (0.62, side * 0.66, 0.36), inset=0.035)
        m = frame(eye, normal)
        body.sphere(P["angler_eye"], matrix=m @ trs(scale=0.1), segs=20, rings=14)
        body.sphere(P["black"], matrix=m @ trs((0, 0, 0.07), scale=(0.022, 0.06, 0.04)), segs=12, rings=8)
        body.sphere(P["eye_shine"], matrix=m @ trs((-0.03, 0.04, 0.09), scale=0.018), segs=8, rings=6)
        lid = [(0.11 * math.cos(a), 0.11 * math.sin(a), 0.03) for a in [math.pi * k / 10 for k in range(11)]]
        body.tube(skin, lid, radius=0.035, segs=8, matrix=m @ trs(rot=(0, 0, -0.35 * side)))
        for g in range(3):
            gill = [(0.12 - g * 0.07, side * (0.6 - g * 0.02), 0.15 - k * 0.12) for k in range(4)]
            body.tube(P["angler_mouth"], gill, radius=0.016, segs=6)
        fin_fan(body, P, (0.0, 0.0), (2.0, 3.7), 0.6, 7, trs((-0.08, side * 0.6, -0.12), (side * 1.25, 0, 0.15)))
        fin_fan(body, P, (0.0, 0.0), (3.4, 4.4), 0.3, 4, trs((0.05, side * 0.32, -0.48), (side * 1.4, 0, 0)))
    fin_fan(body, P, (0.0, 0.0), (math.pi - 1.0, math.pi + 1.0), 0.7, 11, trs((-1.5, 0, 0.0), (math.pi / 2, 0, 0)))
    fin_fan(body, P, (0.0, 0.0), (1.4, 2.4), 0.45, 7, trs((-0.55, 0, 0.52), (math.pi / 2, 0, -0.2)))
    body.sphere(skin, loc=(0.42, 0, 0.68), scale=(0.1, 0.08, 0.07), segs=12, rings=8)
    body.build("angler_body", root)

    jaw = empty("jaw", root, (0.2, 0, -0.24))
    j = Part()
    sculpt(j, angler_jaw_shape, lambda c, n: mouth if n.z > 0.55 and c.x < 0.98 else skin, subdiv=4)
    for i in range(17):
        t = -1 + 2 * i / 16
        a = t * 1.1
        base = (0.42 + 0.5 * math.cos(a), 0.42 * math.sin(a), 0.06 + 0.1 * smooth(math.cos(a), 0.6, 1.0))
        length = rng.uniform(0.22, 0.42) if i % 2 == 0 else rng.uniform(0.12, 0.2)
        fang(j, P["tooth"], base, (0.35 * math.cos(a), 0.3 * math.sin(a), 1.0), length, -0.3, rng)
    j.build("jaw_mesh", jaw)

    lure = empty("lure", root, (0.42, 0, 0.72))
    rod = Part()
    pts = [(0, 0, 0), (0.06, 0, 0.26), (0.24, 0, 0.5), (0.52, 0, 0.62), (0.82, 0, 0.56), (1.0, 0, 0.36)]
    rod.tube(P["angler_fin"], pts, radius=lambda t: 0.038 * (1 - 0.7 * t), segs=10)
    for p in pts[1:-1]:
        rod.sphere(P["angler_fin"], loc=p, scale=0.032, segs=10, rings=6)
    rod.sphere(P["angler_lure"], loc=(1.02, 0, 0.21), scale=0.075, segs=16, rings=10)
    rod.sphere(P["angler_bulb"], loc=(1.02, 0, 0.22), scale=(0.14, 0.14, 0.16), segs=24, rings=14)
    for k in range(5):
        a = -1.0 + k * 0.5
        rod.tube(P["angler_lure"], [(1.02, 0, 0.08), (1.02 + 0.06 * math.sin(a), 0.05 * a, -0.04),
                                    (1.02 + 0.1 * math.sin(a), 0.08 * a, -0.16)], radius=0.007, segs=4)
    rod.build("lure_mesh", lure)
    empty("lure_tip", lure, (1.02, 0, 0.22))
    return root
