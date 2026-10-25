import math

from mathutils import Vector

from body import Body
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


def viewport_x(body, sign=1, fraction=0.5):
    """Where the nose is cut open for the viewport. `sign` picks the nose end: +1 for +X, -1 for -X."""
    x = body.x0
    while body.r(x + sign * 0.01) > body.radius * fraction:
        x += sign * 0.01
    return x


def open_hull(body, nose_x, sign=1):
    """Hull profile cut off at the viewport, ordered with h increasing for an open lathe."""
    pts = [(h, r) for h, r in body.profile() if (h - nose_x) * sign < 0]
    nose = (nose_x, body.r(nose_x))
    return pts + [nose] if sign > 0 else [nose] + pts


def nose_viewport(part, mats, body, nose_x, sign=1, glow=None):
    """A bolted glass viewport over a recessed cockpit at the open end of the hull."""
    x = nose_x
    r0 = body.r(x)
    rim, ring, bolt, glass, shine, cockpit, dials = mats

    def at(dx):
        return (x + sign * dx, 0, 0)

    along = (0, math.pi / 2, 0)
    part.cavity(cockpit, loc=at(-0.17), radius=r0 * 0.74, depth=0.38, sign=sign)
    part.lathe(rim, [(x - 0.03, r0 * 0.7), (x - 0.03, r0 * 1.01), (x + 0.03, r0 * 1.01), (x + 0.03, r0 * 0.7)],
               segs=40, loop=True)
    part.torus(rim, loc=at(0.04), major=r0 * 0.9, minor=r0 * 0.16, rot=along, segs=40, tube_segs=12)
    part.torus(ring, loc=at(0.1), major=r0 * 0.74, minor=r0 * 0.05, rot=along, segs=40, tube_segs=10)
    for i in range(12):
        a = 2 * math.pi * (i + 0.5) / 12
        part.sphere(bolt, loc=(x + sign * (0.04 + r0 * 0.14), r0 * 0.9 * math.cos(a), r0 * 0.9 * math.sin(a)),
                    scale=r0 * 0.065, segs=10, rings=8)

    back = x - sign * 0.34
    part.box(cockpit, loc=(back + sign * 0.05, 0, -r0 * 0.3), size=(0.1, r0 * 1.0, r0 * 0.35), bevel=0.02)
    for i, (dy, color) in enumerate(((-0.25, 0), (-0.08, 1), (0.09, 2), (0.26, 0))):
        part.sphere(dials[color], loc=(back + sign * 0.105, dy * r0 * 1.6, -r0 * 0.22), scale=r0 * 0.045,
                    segs=8, rings=6)
    gauge = (back + sign * 0.02, r0 * 0.25, r0 * 0.18)
    part.torus(ring, loc=gauge, major=r0 * 0.14, minor=r0 * 0.025, rot=along, segs=20, tube_segs=6)
    part.cylinder(shine, loc=gauge, radius=r0 * 0.12, depth=0.01, rot=along, segs=20)
    if glow is not None:
        part.sphere(glow, loc=(back + sign * 0.12, 0, r0 * 0.05), scale=r0 * 0.22, segs=16, rings=10)

    lens = [(x + sign * (0.05 + r0 * 0.72 * math.sqrt(max(0.0, 1 - (i / 12) ** 2))), r0 * 0.76 * i / 12)
            for i in range(13)]
    lens = sorted(lens)
    part.lathe(glass, lens, segs=40, caps=False)
    part.sphere(shine, loc=(x + sign * (0.05 + r0 * 0.6), -r0 * 0.26, r0 * 0.3),
                scale=(0.01, r0 * 0.15, r0 * 0.06), rot=(0.7, 0, 0), segs=10, rings=6)


def player_hull(P):
    root = empty("player_hull")
    b = BODY
    part = Part()
    nose_x = viewport_x(b)
    part.lathe(P["yellow"], open_hull(b, nose_x), segs=48, caps=False)
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

    nose_viewport(part, (P["gunmetal"], P["brass"], P["brass"], P["viewport_glass"], P["eye_shine"], P["cockpit"],
                         (P["dial_green"], P["dial_red"], P["dial_amber"])), b, nose_x)
    band(part, P["white"], b, nose_x - 0.38, nose_x - 0.16, lift=0.02)
    rivet_ring(part, P["brass"], b, nose_x - 0.27, count=20, size=0.03)
    for theta in (math.radians(4), math.radians(176)):
        porthole(part, P, b, 0.35, theta)
        porthole(part, P, b, -0.3, theta, radius=0.14)

    lamp = frame(b.ray((1.0, 0, -0.3), (0.8, 0, -1.0))[0], Vector((0.8, 0, -0.7)))
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

    def grow(x, z, k=1.4):
        """Scale a periscope point up from where the periscope meets the tower."""
        return (0.05 + (x - 0.05) * k, 0, 1.5 + (z - 1.5) * k)

    scope = [grow(0.05, 1.45), grow(0.05, 2.0), grow(0.08, 2.12), grow(0.2, 2.2), grow(0.32, 2.22)]
    part.tube(P["yellow"], scope, radius=0.12, segs=18)
    part.cylinder(P["yellow"], loc=grow(0.42, 2.22), radius=0.21, depth=0.36, rot=(0, math.pi / 2, 0), bevel=0.04)
    part.torus(P["gunmetal"], loc=grow(0.56, 2.22), major=0.17, minor=0.05, rot=(0, math.pi / 2, 0), segs=28)
    part.cylinder(P["glass"], loc=grow(0.56, 2.22), radius=0.155, depth=0.04, rot=(0, math.pi / 2, 0), segs=24)
    part.torus(P["yellow_dark"], loc=grow(0.05, 1.75), major=0.125, minor=0.035, segs=24)

    part.build("hull_body", root)
    propeller(P, "propeller", root, (-2.82, 0, 0), size=1.2)
    return root
