"""Deep-sea creatures. The jellyfish hangs along -Z from its bell; the anglerfish faces +X."""
import math
import random

import bmesh
from mathutils import Vector, noise

from assets_env import blob
from mathutils import Matrix

from kit import Part, descendants, empty, frame, trs

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


def loft(part, xs, ring, materials, segs=40):
    """Skin a closed body along X. ring(x, a) gives the (y, z) of the surface at angle a around the axis; the first
    and last stations close to poles. materials(center, normal) picks each face's material."""
    bm = part.bm
    rings = []
    for k, x in enumerate(xs):
        if k == 0 or k == len(xs) - 1:
            ys, zs = zip(*(ring(x, 2 * math.pi * j / segs) for j in range(segs)))
            rings.append([bm.verts.new((x, sum(ys) / segs, sum(zs) / segs))])
            continue
        rings.append([bm.verts.new((x, *ring(x, 2 * math.pi * j / segs))) for j in range(segs)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for j in range(segs):
            k = (j + 1) % segs
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
        groups.setdefault(materials(f.calc_center_median(), f.normal), []).append(f)
    for material, group in groups.items():
        part._paint(group, material, True)


def stations(x0, x1, count, bunch_front=True):
    out = []
    for i in range(count + 1):
        t = i / count
        if bunch_front:
            t = 1 - (1 - t) ** 1.6
        out.append(x0 + (x1 - x0) * t)
    return out


# Anglerfish proportions, facing +X: a huge round head, a short thick tail stalk.
HEAD_X, NOSE_X, TAIL_X = 0.1, 0.82, -1.38
MOUTH_X = 0.12


def head_width(x):
    if x >= HEAD_X:
        return 0.74 * math.sqrt(max(0.0, 1 - ((x - HEAD_X) / (NOSE_X - HEAD_X)) ** 2.2))
    t = max(0.0, min(1.0, (x - TAIL_X) / (HEAD_X - TAIL_X)))
    return 0.74 * (0.2 + 0.8 * (1 - (1 - t) ** 2.4))


def head_height(x):
    return head_width(x) * 1.08


def mouth_roof(x):
    """Underside of the upper jaw: the head's lower front is carved away into the gape."""
    return -head_height(x) - 0.05 + (head_height(x) * 0.92) * smooth(x, MOUTH_X, MOUTH_X + 0.32)


def angler_ring(x, a):
    y = head_width(x) * math.cos(a)
    z = 0.06 + head_height(x) * math.sin(a)
    if x > MOUTH_X:
        z = max(z, mouth_roof(x))
    return y, z


def jaw_shape(x):
    """Lower jaw cross-section at x: half-width, centre height, half-height, and the height of the mouth floor."""
    f = math.sqrt(max(0.0, 1 - ((x - 0.38) / 0.72) ** 2))
    width = 0.68 * f
    zc = -0.6 + 0.4 * smooth(x, 0.25, 1.1)
    rz = 0.2 * f ** 0.5 + 0.015
    return width, zc, rz, zc + rz * 0.35


def jaw_ring(x, a):
    width, zc, rz, floor = jaw_shape(x)
    return width * math.cos(a), min(zc + rz * math.sin(a), floor)


def roof_edge(x):
    """Half-width of the upper jaw's lip line at x, where the head's surface meets the carved roof."""
    s = max(-1.0, min(1.0, (mouth_roof(x) - 0.06) / max(head_height(x), 1e-4)))
    return head_width(x) * math.sqrt(1 - s * s)


def fin_lobe(part, P, outline, matrix, rays=True):
    """A soft, rounded fin: a thick bevelled membrane with raised spines fanning from its root."""
    part.extrude(P["angler_fin"], outline, depth=0.035, matrix=matrix, bevel=0.016, bevel_segs=3)
    if not rays:
        return
    root = outline[0]
    for tip in outline[2:-1]:
        part.tube(P["angler_spine"], [(root[0], root[1], 0.02), (tip[0] * 0.95 + root[0] * 0.05,
                                                                  tip[1] * 0.95 + root[1] * 0.05, 0.02)],
                  radius=lambda t: 0.013 * (1 - t) + 0.004, segs=6, matrix=matrix)


def anglerfish(P):
    rng = random.Random(21)
    root = empty("anglerfish")
    skin, mouth = P["angler_skin"], P["angler_mouth"]
    body = Part()
    loft(body, stations(TAIL_X, NOSE_X, 70), angler_ring,
         lambda c, n: mouth if c.x > MOUTH_X + 0.05 and c.z < mouth_roof(c.x) + 0.02 and n.z < -0.3 else skin)
    body.sphere(mouth, loc=(0.28, 0, -0.28), scale=(0.16, 0.34, 0.22), segs=20, rings=12)

    for side in (-1, 1):
        for i in range(8):
            x = 0.36 + 0.06 * i
            y = side * roof_edge(x) * 0.9
            length = rng.uniform(0.17, 0.26) if i % 2 == 0 else rng.uniform(0.08, 0.13)
            fang(body, P["tooth"], (x, y, mouth_roof(x)), (0.2, -side * 0.25, -1.0), length, 0.35, rng)
    for y in (-0.1, 0.1):
        fang(body, P["tooth"], (0.8, y, mouth_roof(0.8)), (0.3, 0.0, -1.0), rng.uniform(0.2, 0.28), 0.35, rng)

    for side in (-1, 1):
        a = math.radians(32)
        ex = 0.46
        ey = head_width(ex) * math.cos(a) * side
        ez = 0.06 + head_height(ex) * math.sin(a)
        normal = Vector((0.45, side * math.cos(a), math.sin(a))).normalized()
        m = frame(Vector((ex, ey, ez)) - normal * 0.03, normal)
        body.sphere(P["angler_eye"], matrix=m @ trs(scale=0.085), segs=20, rings=14)
        body.sphere(P["black"], matrix=m @ trs((0, 0, 0.065), scale=(0.02, 0.05, 0.03)), segs=12, rings=8)
        body.sphere(P["eye_shine"], matrix=m @ trs((-0.025, 0.03, 0.075), scale=0.014), segs=8, rings=6)
        lid = [(0.1 * math.cos(q), 0.1 * math.sin(q), 0.02) for q in [math.pi * k / 10 for k in range(11)]]
        body.tube(skin, lid, radius=0.032, segs=8, matrix=m @ trs(rot=(0, 0, -0.5 * side)))
        pect = [(0.0, 0.0), (-0.05, 0.12), (-0.2, 0.26), (-0.38, 0.27), (-0.47, 0.16), (-0.44, 0.02), (-0.3, -0.06)]
        fin_lobe(body, P, pect, trs((-0.05, side * head_width(-0.05) * 0.96, -0.2), (side * 1.25, 0.15, -0.25)))

    tail = [(0.0, 0.0), (-0.12, 0.16), (-0.34, 0.42), (-0.52, 0.36), (-0.6, 0.0), (-0.52, -0.36), (-0.34, -0.42),
            (-0.12, -0.16)]
    fin_lobe(body, P, tail, trs((TAIL_X + 0.14, 0, 0.06), (math.pi / 2, 0, 0)))
    dorsal = [(0.0, 0.0), (0.06, 0.16), (-0.08, 0.3), (-0.26, 0.26), (-0.36, 0.08), (-0.3, -0.02)]
    fin_lobe(body, P, dorsal, trs((-0.55, 0, 0.06 + head_height(-0.55) * 0.92), (math.pi / 2, 0, 0)))
    anal = [(0.0, 0.0), (-0.06, -0.14), (-0.22, -0.22), (-0.34, -0.12), (-0.3, 0.0)]
    fin_lobe(body, P, anal, trs((-0.6, 0, 0.06 - head_height(-0.6) * 0.92), (math.pi / 2, 0, 0)))

    for k in range(6):
        x = 0.0 - k * 0.17
        top = 0.06 + head_height(x)
        body.cylinder(skin, matrix=trs((x, 0, top - 0.01)), loc=(0, 0, 0.04), radius=0.028 - k * 0.003, radius2=0.0,
                      depth=0.09 - k * 0.008, segs=8)
    for k in range(9):
        x = 0.42 - k * 0.15
        for side in (-1, 1):
            a = math.radians(-18)
            body.sphere(P["angler_spot"], loc=(x, side * head_width(x) * math.cos(a) * 1.005,
                                               0.06 + head_height(x) * math.sin(a)), scale=0.026, segs=8, rings=6)
    body.build("angler_body", root)

    hinge = Vector((-0.1, 0.0, -0.42))
    jaw = empty("jaw", root, tuple(hinge))
    j = Part()
    loft(j, stations(-0.32, 1.09, 48), jaw_ring,
         lambda c, n: mouth if n.z > 0.9 and abs(c.y) < jaw_shape(c.x)[0] * 0.8 else skin)
    for i in range(17):
        t = -1 + 2 * i / 16
        x = 0.4 + 0.66 * (1 - t * t) ** 0.5
        width, zc, rz, floor = jaw_shape(x)
        y = width * 0.85 * t
        length = rng.uniform(0.26, 0.42) if i % 2 == 0 else rng.uniform(0.12, 0.2)
        fang(j, P["tooth"], (x, y, floor), (0.3, -0.25 * t, 1.0), length, -0.35, rng)
    j.build("jaw_mesh", jaw)
    for o in descendants(jaw):
        if o.type == "MESH":
            o.data.transform(Matrix.Translation(-hinge))

    lure_base = (0.32, 0.0, 0.06 + head_height(0.32) - 0.02)
    lure = empty("lure", root, lure_base)
    rod = Part()
    pts = [(0, 0, 0), (0.08, 0, 0.26), (0.3, 0, 0.48), (0.6, 0, 0.56), (0.86, 0, 0.46), (1.0, 0, 0.28)]
    rod.tube(P["angler_fin"], pts, radius=lambda t: 0.034 * (1 - 0.7 * t), segs=10)
    rod.sphere(P["angler_lure"], loc=(1.02, 0, 0.14), scale=0.07, segs=16, rings=10)
    rod.sphere(P["angler_bulb"], loc=(1.02, 0, 0.15), scale=(0.13, 0.13, 0.15), segs=24, rings=14)
    rod.build("lure_mesh", lure)
    empty("lure_tip", lure, (1.02, 0, 0.15))
    return root
