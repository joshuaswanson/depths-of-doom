import math

from mathutils import Vector

from body import Body, face_dir
from kit import Part, empty, frame, trs

BODY = Body(length=4.0, radius=1.0, p_front=2.6, p_back=2.3)


def propeller(P, name, parent, location, size=1.0, blades=3, hub_mat="steel", blade_mat="steel"):
    part = Part()
    part.sphere(P[hub_mat], scale=(0.16 * size, 0.14 * size, 0.14 * size))
    part.cylinder(P[hub_mat], loc=(-0.12 * size, 0, 0), radius=0.1 * size, radius2=0.02 * size, depth=0.18 * size,
                  rot=(0, -math.pi / 2, 0))
    for i in range(blades):
        a = 2 * math.pi * i / blades
        m = trs(rot=(a, 0, 0)) @ trs((0, 0, 0.3 * size), (0, 0, 0.6), (0.05 * size, 0.15 * size, 0.32 * size))
        part.sphere(P[blade_mat], matrix=m, segs=16, rings=10)
    return part.build(name, parent, location)


def band(part, material, body, a, b, lift=0.025, samples=6):
    xs = [a + (b - a) * i / (samples - 1) for i in range(samples)]
    prof = [(a, body.r(a) * 0.85)] + [(x, body.r(x) + lift) for x in xs] + [(b, body.r(b) * 0.85)]
    part.lathe(material, prof, segs=48, loop=True, sharp=(1, samples))


def rivet_ring(part, material, body, x, count=22, size=0.032):
    for i in range(count):
        theta = 2 * math.pi * (i + 0.5) / count
        part.sphere(material, matrix=body.frame(x, theta) @ trs(scale=(size, size, size * 0.7)), segs=8, rings=6)


def porthole(part, P, body, x, theta, radius=0.17):
    m = body.frame(x, theta)
    part.torus(P["brass"], matrix=m, major=radius, minor=radius * 0.24, segs=28, tube_segs=10)
    part.cylinder(P["glass"], matrix=m, radius=radius * 0.85, depth=0.06, segs=24)
    part.sphere(P["eye_shine"], matrix=m @ trs((-radius * 0.35, radius * 0.35, 0.03), scale=(0.035, 0.035, 0.01)),
                segs=8, rings=6)


def cartoon_face(part, P, body, center, yaw, pitch, scale=1.0, eye_gap=11, mouth=True):
    for side in (-1, 1):
        p, n = body.ray(center, face_dir(yaw + side * eye_gap * scale, pitch + 8))
        m = frame(p, n)
        part.sphere(P["black"], matrix=m @ trs(scale=(0.1 * scale, 0.15 * scale, 0.05)), segs=20, rings=12)
        part.sphere(P["eye_shine"], matrix=m @ trs((-0.03 * scale, 0.06 * scale, 0.04),
                                                     scale=(0.032 * scale, 0.04 * scale, 0.02)), segs=10, rings=8)
    if mouth:
        pts = []
        for i in range(13):
            t = -1 + 2 * i / 12
            p, n = body.ray(center, face_dir(yaw + t * 12 * scale, pitch - 9 * scale + 5 * scale * t * t))
            pts.append(p + n * 0.012)
        part.tube(P["black"], pts, radius=lambda t: 0.018 + 0.016 * math.sin(math.pi * t), segs=10)


def player_hull(P):
    root = empty("player_hull")
    b = BODY
    part = Part()
    part.lathe(P["yellow"], b.profile(), segs=48)
    band(part, P["red"], b, -1.45, -1.27)
    band(part, P["white"], b, -1.27, -1.1)
    band(part, P["red"], b, -1.1, -0.92)
    for x in (0.95, -0.55):
        band(part, P["yellow_dark"], b, x - 0.035, x + 0.035, lift=0.012, samples=3)
        rivet_ring(part, P["yellow_dark"], b, x + 0.09)

    part.lathe(P["red"], [(-1.55, 0.62), (-1.95, 0.5), (-2.35, 0.34), (-2.6, 0.24), (-2.64, 0.0)], segs=40)
    part.cylinder(P["steel_dark"], loc=(-2.68, 0, 0), radius=0.07, depth=0.2, rot=(0, math.pi / 2, 0), segs=12)

    fin = [(-1.65, 0.25), (-2.05, 1.0), (-2.6, 1.08), (-2.55, 0.2)]
    for sz in (1, -1):
        part.extrude(P["orange"], [(x, z * sz) for x, z in fin], depth=0.12, rot=(math.pi / 2, 0, 0), bevel=0.04)
        part.extrude(P["orange"], [(x, y * sz) for x, y in fin], depth=0.12, bevel=0.04)

    cartoon_face(part, P, b, (1.0, 0, 0.05), yaw=90, pitch=2, scale=1.25)
    for theta in (math.radians(4), math.radians(176)):
        porthole(part, P, b, 0.35, theta)
        porthole(part, P, b, -0.3, theta, radius=0.14)

    lamp = frame(b.ray((1.0, 0, -0.3), (1, 0, -0.55))[0], Vector((1, 0, -0.45)))
    part.cylinder(P["steel_dark"], matrix=lamp @ trs((0, 0, 0.02)), radius=0.17, depth=0.14, bevel=0.03)
    part.cylinder(P["lamp"], matrix=lamp @ trs((0, 0, 0.09)), radius=0.13, depth=0.03, segs=20)

    tower = [(0.62, 1.12, "yellow"), (1.12, 1.26, "red"), (1.26, 1.38, "white"), (1.38, 1.5, "red")]
    for z0, z1, color in tower:
        part.cylinder(P[color], loc=(0.25, 0, (z0 + z1) / 2), radius=0.42, depth=z1 - z0, scale=(1.3, 0.85, 1),
                      segs=32)
    part.sphere(P["yellow"], loc=(0.25, 0, 1.5), scale=(0.55, 0.36, 0.16), segs=32, rings=12)
    part.torus(P["yellow_dark"], loc=(0.25, 0, 1.5), major=0.42, minor=0.03, scale=(1.3, 0.85, 1), segs=40)
    for side in (-1, 1):
        tower_window = frame(Vector((0.5, 0.31 * side, 0.98)), Vector((0.35, side, 0)))
        part.torus(P["brass"], matrix=tower_window, major=0.11, minor=0.03, segs=20, tube_segs=8)
        part.cylinder(P["glass"], matrix=tower_window, radius=0.095, depth=0.05, segs=16)

    scope = [(0.05, 0, 1.45), (0.05, 0, 2.0), (0.08, 0, 2.12), (0.2, 0, 2.2), (0.32, 0, 2.22)]
    part.tube(P["yellow"], scope, radius=0.085, segs=16)
    part.cylinder(P["yellow"], loc=(0.42, 0, 2.22), radius=0.15, depth=0.26, rot=(0, math.pi / 2, 0), bevel=0.03)
    part.torus(P["gunmetal"], loc=(0.56, 0, 2.22), major=0.12, minor=0.035, rot=(0, math.pi / 2, 0), segs=24)
    part.cylinder(P["glass"], loc=(0.56, 0, 2.22), radius=0.11, depth=0.03, rot=(0, math.pi / 2, 0), segs=20)
    part.torus(P["yellow_dark"], loc=(0.05, 0, 1.75), major=0.09, minor=0.025, segs=20)

    part.build("hull_body", root)
    propeller(P, "propeller", root, (-2.82, 0, 0), size=1.2)
    return root
