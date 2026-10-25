"""Bolt-on upgrade parts and junk. Each part's mount point is the origin; it extends along +Z away
from the hull and faces +X."""
import math

from assets_player import propeller
from kit import Part, empty, points_on_arc, superellipse_profile, trs

ALONG_X = (0, math.pi / 2, 0)


def dome(x0, radius, length, sign=1, steps=7):
    """(h, r) points of a rounded nose cap starting at x0 and bulging `length` along `sign`."""
    return [(x0 + sign * length * math.sin(math.pi / 2 * k / steps), radius * math.cos(math.pi / 2 * k / steps))
            for k in range(steps + 1)]


def chunky_fins(part, material, x0, x1, reach, m, count=4, start=math.pi / 4, thick=0.05):
    for i in range(count):
        a = start + i * 2 * math.pi / count
        fin = [(x1, 0), (x0, 0), (x0 + (x1 - x0) * 0.15, reach * 0.9), (x0 + (x1 - x0) * 0.55, reach)]
        part.extrude(material, fin, depth=thick, matrix=m @ trs(rot=(a, 0, 0)) @ trs(rot=(math.pi / 2, 0, 0)),
                     bevel=thick * 0.4)


def torpedo_shape(part, P, loc=(0, 0, 0), length=1.1, radius=0.22):
    """A chubby cartoon torpedo: a fat green capsule with a glowing dome nose and oversized fins."""
    x, y, z = loc
    h = length / 2
    r = radius
    m = trs((0, y, z))
    body = [(x - h, 0.0), (x - h, r * 0.5), (x - h * 0.82, r * 0.86), (x - h * 0.55, r), (x + h * 0.3, r)]
    part.lathe(P["green"], body + [(x + h * 0.3, 0.0)], matrix=m, segs=28)
    part.lathe(P["torpedo_tip"], [(x + h * 0.28, 0.0)] + dome(x + h * 0.28, r * 0.98, r * 1.05), matrix=m, segs=28)
    for bx, mat in ((x - h * 0.2, "green_dark"), (x + h * 0.05, "white"), (x + h * 0.22, "green_dark")):
        part.lathe(P[mat], [(bx - 0.025, r * 0.9), (bx - 0.025, r * 1.04), (bx + 0.025, r * 1.04),
                            (bx + 0.025, r * 0.9)], matrix=m, segs=28, loop=True)
    chunky_fins(part, P["steel_dark"], x - h * 1.02, x - h * 0.45, r * 2.1, m, thick=r * 0.22)
    part.cylinder(P["steel"], loc=(x - h - 0.04, y, z), radius=r * 0.18, depth=0.08, rot=ALONG_X, segs=12)
    for i in range(3):
        a = 2 * math.pi * i / 3
        blade = trs((x - h - 0.09, y, z)) @ trs(rot=(a, 0, 0)) @ trs((0, 0, r * 0.45), (0, 0, 0.5), (0.03, r * 0.35, r * 0.5))
        part.sphere(P["steel"], matrix=blade, segs=10, rings=6)


def missile_shape(part, P, loc=(0, 0, 0), length=0.92, radius=0.17, body="missile_body", nose="enemy_red"):
    """A stubby cartoon rocket: fat body, big round nose, oversized fins, and an exhaust bell."""
    x, y, z = loc
    h = length / 2
    r = radius
    m = trs((0, y, z))
    part.lathe(P[body], [(x - h, 0.0), (x - h, r * 0.7), (x - h * 0.85, r), (x + h * 0.3, r), (x + h * 0.3, 0.0)],
               matrix=m, segs=24)
    part.lathe(P[nose], [(x + h * 0.28, 0.0)] + dome(x + h * 0.28, r * 0.99, r * 1.35), matrix=m, segs=24)
    part.lathe(P["white"], [(x - h * 0.05, r * 0.9), (x - h * 0.05, r * 1.04), (x + h * 0.12, r * 1.04),
                            (x + h * 0.12, r * 0.9)], matrix=m, segs=24, loop=True)
    part.cylinder(P["gunmetal"], loc=(x - h - 0.05, y, z), radius=r * 0.5, radius2=r * 0.72, depth=0.1,
                  rot=(0, -math.pi / 2, 0), segs=16)
    chunky_fins(part, P[nose], x - h * 1.05, x - h * 0.35, r * 2.6, m, start=0, thick=r * 0.25)


def mount_plate(part, P, size=(0.36, 0.3, 0.1), mat="steel_dark"):
    part.box(P[mat], loc=(0, 0, size[2] / 2), size=size, bevel=0.025)
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.sphere(P["steel"], loc=(sx * (size[0] / 2 - 0.05), sy * (size[1] / 2 - 0.05), size[2]),
                        scale=0.025, segs=8, rings=6)


def part_cannon(P):
    """A cartoon gatling: a fat drum body and a wide ring of stubby barrels that flare like trumpets."""
    root = empty("part_cannon")
    axis = 0.5
    part = Part()
    mount_plate(part, P, size=(0.46, 0.38, 0.1))
    part.box(P["steel_dark"], loc=(0, 0, 0.2), size=(0.28, 0.22, 0.2), bevel=0.04)
    part.lathe(P["orange"], superellipse_profile(0.84, 0.4, p_front=3.2, p_back=3.2, samples=24, x0=-0.04),
               matrix=trs((0, 0, axis)), segs=32)
    part.cylinder(P["white"], loc=(0.22, 0, axis), radius=0.4, depth=0.12, rot=ALONG_X, bevel=0.035, segs=36)
    part.cylinder(P["white"], loc=(-0.28, 0, axis), radius=0.38, depth=0.07, rot=ALONG_X, segs=36)
    for i in range(10):
        a = 2 * math.pi * i / 10
        part.sphere(P["brass"], loc=(0.29, 0.38 * math.cos(a), axis + 0.38 * math.sin(a)), scale=0.03, segs=8, rings=6)
    part.tube(P["steel_dark"], [(-0.32, 0.0, 0.82), (-0.3, 0.0, 1.0), (0.02, 0.0, 1.02), (0.07, 0.0, 0.86)],
              radius=0.04, segs=10)
    part.build("cannon_body", root)

    barrels = Part()
    for i in range(6):
        a = 2 * math.pi * i / 6
        y, z = 0.2 * math.cos(a), 0.2 * math.sin(a)
        barrels.cylinder(P["steel"], loc=(0.73, y, z), radius=0.085, depth=0.86, rot=ALONG_X, segs=16)
        barrels.cylinder(P["steel"], loc=(1.21, y, z), radius=0.085, radius2=0.13, depth=0.11, rot=ALONG_X, segs=16)
        barrels.cylinder(P["black"], loc=(1.266, y, z), radius=0.085, depth=0.01, rot=ALONG_X, segs=14)
    barrels.cylinder(P["steel_dark"], loc=(0.71, 0, 0), radius=0.1, depth=0.92, rot=ALONG_X, segs=14)
    barrels.cylinder(P["red"], loc=(1.23, 0, 0), radius=0.07, depth=0.09, rot=ALONG_X, segs=14)
    for x, color in ((0.42, "steel_dark"), (0.96, "white")):
        barrels.torus(P[color], loc=(x, 0, 0), major=0.3, minor=0.05, rot=ALONG_X, segs=32)
    for i in range(3):
        a = 2 * math.pi * i / 3
        barrels.box(P["orange"], loc=(0.96, 0.34 * math.cos(a), 0.34 * math.sin(a)), size=(0.09, 0.09, 0.09),
                    bevel=0.02)
    barrels.build("cannon_barrels", root, location=(0, 0, axis))
    empty("muzzle", root, (1.3, 0, axis))
    return root


def part_torpedo(P):
    root = empty("part_torpedo")
    part = Part()
    part.box(P["steel_dark"], loc=(0, 0, 0.05), size=(1.05, 0.78, 0.1), bevel=0.04)
    for y in (-0.22, 0.22):
        torpedo_shape(part, P, loc=(0.04, y, 0.32), length=1.15, radius=0.2)
    for x in (-0.22, 0.24):
        part.box(P["yellow_dark"], loc=(x, 0, 0.2), size=(0.09, 0.84, 0.07), bevel=0.02)
        for y in (-0.22, 0.22):
            part.torus(P["yellow_dark"], loc=(x, y, 0.32), major=0.208, minor=0.03, rot=ALONG_X, segs=28, tube_segs=8)
    part.build("torpedo_rack", root)
    empty("muzzle", root, (0.74, 0, 0.32))
    return root


def part_missile(P):
    root = empty("part_missile")
    part = Part()
    mount_plate(part, P, size=(0.5, 0.44, 0.08))
    part.box(P["steel_dark"], loc=(0, 0, 0.16), size=(0.22, 0.2, 0.14), bevel=0.03)
    part.lathe(P["blue"], [(-0.38, 0.0)] + dome(-0.24, 0.34, 0.14, sign=-1)[::-1] + [(0.3, 0.34), (0.3, 0.0)],
               matrix=trs((0, 0, 0.48)), segs=32)
    part.lathe(P["yellow"], [(-0.06, 0.32), (-0.06, 0.355), (0.06, 0.355), (0.06, 0.32)], matrix=trs((0, 0, 0.48)),
               segs=32, loop=True)
    for i in range(3):
        a = math.pi / 2 + 2 * math.pi * i / 3
        y, zz = 0.17 * math.cos(a), 0.48 + 0.17 * math.sin(a)
        part.cylinder(P["black"], loc=(0.305, y, zz), radius=0.11, depth=0.02, rot=ALONG_X, segs=18)
        part.lathe(P["red"], [(0.28, 0.0), (0.28, 0.095), (0.36, 0.095)] + dome(0.36, 0.095, 0.17),
                   matrix=trs((0, y, zz)), segs=18)
    part.build("missile_pod", root)
    empty("muzzle", root, (0.58, 0, 0.48))
    return root


def part_shield(P):
    root = empty("part_shield")
    part = Part()
    part.cylinder(P["gunmetal"], loc=(0, 0, 0.06), radius=0.26, depth=0.12, bevel=0.03, segs=28)
    part.cylinder(P["steel"], loc=(0, 0, 0.18), radius=0.1, depth=0.16, segs=16)
    part.torus(P["blue"], loc=(0, 0, 0.26), major=0.22, minor=0.045, segs=32)
    part.sphere(P["shield_glow"], loc=(0, 0, 0.3), scale=(0.19, 0.19, 0.2), segs=24, rings=14)
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.4
        base = (0.22 * math.cos(a), 0.22 * math.sin(a), 0.1)
        tip = (0.3 * math.cos(a), 0.3 * math.sin(a), 0.5)
        part.tube(P["steel"], [base, tip], radius=0.02, segs=8)
        part.sphere(P["shield_glow"], loc=tip, scale=0.045, segs=10, rings=8)
    part.build("shield_body", root)
    return root


def part_grapple(P):
    root = empty("part_grapple")
    base = Part()
    mount_plate(base, P, size=(0.3, 0.3, 0.1))
    base.sphere(P["gunmetal"], loc=(0, 0, 0.12), scale=0.11, segs=16, rings=10)
    base.build("grapple_base", root)

    arm = empty("grapple_arm", root, (0, 0, 0.12))
    a = Part()
    a.cylinder(P["steel"], loc=(0, 0, 0.25), radius=0.055, depth=0.5, segs=14)
    a.cylinder(P["gunmetal"], loc=(0, 0, 0.12), radius=0.075, depth=0.12, segs=14, bevel=0.015)
    a.build("grapple_arm_mesh", arm)

    claw = empty("grapple_claw", arm, (0, 0, 0.5))
    c = Part()
    c.sphere(P["gunmetal"], loc=(0, 0, 0.05), scale=0.1, segs=16, rings=10)
    c.cylinder(P["red"], loc=(0, 0, 0.12), radius=0.12, depth=0.08, bevel=0.02, segs=20)
    for i in range(3):
        ang = 2 * math.pi * i / 3 + math.pi / 2
        d = (math.cos(ang), math.sin(ang))
        prof = [(0.06, 0.13), (0.18, 0.22), (0.23, 0.36), (0.18, 0.5), (0.1, 0.56)]
        pts = [(r * d[0], r * d[1], z) for r, z in prof]
        c.tube(P["red"], pts, radius=lambda t: 0.05 - 0.025 * t, segs=10)
        c.sphere(P["gunmetal"], loc=pts[-1], scale=0.03, segs=8, rings=6)
        c.sphere(P["steel"], loc=pts[1], scale=0.045, segs=10, rings=8)
    c.build("grapple_claw_mesh", claw)
    return root


def part_sonar(P):
    root = empty("part_sonar")
    base = Part()
    mount_plate(base, P, size=(0.28, 0.28, 0.08))
    base.cylinder(P["steel"], loc=(0, 0, 0.25), radius=0.04, depth=0.4, segs=12)
    base.cylinder(P["gunmetal"], loc=(0, 0, 0.45), radius=0.07, depth=0.06, segs=16)
    base.build("sonar_mast", root)

    dish = empty("sonar_dish", root, (0, 0, 0.5))
    d = Part()
    tilt = trs(rot=(0, 0.6, 0)) @ trs(rot=(0, -math.pi / 2, 0))
    bowl = [(0.0, 0.0), (0.01, 0.08), (0.04, 0.16), (0.09, 0.24), (0.15, 0.31), (0.165, 0.3), (0.12, 0.25),
            (0.07, 0.17), (0.04, 0.09), (0.03, 0.0)]
    d.lathe(P["steel"], bowl, matrix=tilt, segs=32)
    d.torus(P["teal_glow"], matrix=tilt, loc=(0.16, 0, 0), major=0.31, minor=0.022, rot=ALONG_X, segs=32)
    d.tube(P["steel_dark"], [(0.02, 0, 0), (0.2, 0, 0)], radius=0.018, matrix=tilt, segs=8)
    d.sphere(P["teal_glow"], matrix=tilt @ trs((0.22, 0, 0), scale=0.05), segs=12, rings=8)
    d.sphere(P["gunmetal"], scale=0.06, segs=12, rings=8)
    d.build("sonar_dish_mesh", dish)
    return root


def part_spotlight(P):
    root = empty("part_spotlight")
    base = Part()
    mount_plate(base, P, size=(0.34, 0.3, 0.08))
    base.cylinder(P["gunmetal"], loc=(0, 0, 0.12), radius=0.1, depth=0.1, segs=16, bevel=0.02)
    for y in (-0.2, 0.2):
        base.box(P["red"], loc=(0, y, 0.3), size=(0.12, 0.05, 0.4), bevel=0.02)
        base.cylinder(P["steel"], loc=(0, y * 1.12, 0.42), radius=0.045, depth=0.05, rot=(math.pi / 2, 0, 0), segs=12)
    base.box(P["red"], loc=(0, 0, 0.13), size=(0.12, 0.45, 0.06), bevel=0.02)
    base.build("spotlight_yoke", root)

    head = empty("spotlight_head", root, (0, 0, 0.42))
    h = Part()
    body = [(-0.32, 0.0), (-0.32, 0.12), (-0.28, 0.16), (0.05, 0.17), (0.22, 0.2), (0.3, 0.21), (0.3, 0.0)]
    h.lathe(P["yellow"], body, segs=32, sharp=(1, 5))
    for x in (-0.24, -0.18, -0.12):
        h.lathe(P["steel_dark"], [(x - 0.018, 0.15), (x - 0.018, 0.19), (x + 0.018, 0.19), (x + 0.018, 0.15)],
                segs=28, loop=True)
    h.torus(P["steel"], loc=(0.3, 0, 0), major=0.2, minor=0.035, rot=ALONG_X, segs=32, tube_segs=10)
    h.cylinder(P["spot_lens"], loc=(0.3, 0, 0), radius=0.185, depth=0.03, rot=ALONG_X, segs=28)
    h.sphere(P["eye_shine"], loc=(0.32, -0.06, 0.08), scale=(0.01, 0.04, 0.025), segs=8, rings=6)
    h.tube(P["gunmetal"], [(-0.12, 0, 0.16), (-0.1, 0, 0.27), (0.1, 0, 0.27), (0.12, 0, 0.18)], radius=0.022, segs=8)
    h.build("spotlight_head_mesh", head)
    empty("lens", head, (0.33, 0, 0))
    return root


def part_thruster(P):
    root = empty("part_thruster")
    part = Part()
    part.box(P["steel_dark"], loc=(0, 0, 0.12), size=(0.28, 0.14, 0.24), bevel=0.03)
    prof = [(-0.48, 0.2), (-0.42, 0.26), (-0.1, 0.28), (0.3, 0.26), (0.42, 0.22), (0.44, 0.0)]
    m = trs((0, 0, 0.38))
    part.lathe(P["yellow_dark"], [(-0.48, 0.0)] + prof, matrix=m, segs=28, sharp=(1,))
    part.lathe(P["steel_dark"], [(-0.1, 0.27), (-0.1, 0.295), (0.1, 0.29), (0.1, 0.27)], matrix=m, segs=28, loop=True)
    part.torus(P["steel"], matrix=m, loc=(-0.5, 0, 0), major=0.21, minor=0.04, rot=ALONG_X, segs=28)
    part.cylinder(P["thruster_glow"], matrix=m, loc=(-0.49, 0, 0), radius=0.18, depth=0.02, rot=ALONG_X, segs=24)
    part.torus(P["gunmetal"], matrix=m, loc=(0.43, 0, 0), major=0.15, minor=0.04, rot=ALONG_X, segs=24)
    part.cylinder(P["lamp"], matrix=m, loc=(0.445, 0, 0), radius=0.13, depth=0.02, rot=ALONG_X, segs=20)
    part.build("thruster_body", root)
    propeller(P, "thruster_prop", root, (-0.62, 0, 0.38), size=0.55)
    return root


def junk_crate(P):
    root = empty("junk_crate")
    part = Part()
    s = 0.5
    part.box(P["wood"], loc=(0, 0, s / 2), size=(s, s, s), bevel=0.02)
    for axis in range(3):
        for sign in (-1, 1):
            loc = [0, 0, s / 2]
            loc[axis] += sign * (s / 2 + 0.005)
            size = [s * 0.98] * 3
            size[axis] = 0.03
            if axis != 2:
                frame_size = list(size)
                frame_size[2] = 0.07
                for zz in (0.05, s - 0.05):
                    l2 = list(loc)
                    l2[2] = zz
                    part.box(P["wood_dark"], loc=l2, size=frame_size, bevel=0.01)
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.box(P["steel"], loc=(sx * s / 2, sy * s / 2, s / 2), size=(0.07, 0.07, s + 0.02), bevel=0.015)
    part.box(P["wood_dark"], loc=(0, -s / 2 - 0.01, s / 2), size=(s * 1.25, 0.03, 0.07), rot=(0, -0.79, 0), bevel=0.01)
    part.build("crate_mesh", root)
    return root


def junk_ammo(P):
    root = empty("junk_ammo")
    part = Part()
    part.box(P["olive"], loc=(0, 0, 0.18), size=(0.62, 0.36, 0.34), bevel=0.04, segs=3)
    part.box(P["green_dark"], loc=(0, 0, 0.3), size=(0.64, 0.38, 0.04), bevel=0.015)
    part.box(P["yellow"], loc=(0.14, -0.185, 0.16), size=(0.2, 0.01, 0.1), bevel=0.0)
    part.tube(P["steel_dark"], [(-0.12, 0, 0.35), (-0.12, 0, 0.42), (0.12, 0, 0.42), (0.12, 0, 0.35)], radius=0.022)
    for x in (-0.25, 0.25):
        part.box(P["steel_dark"], loc=(x, -0.185, 0.27), size=(0.06, 0.03, 0.08), bevel=0.01)
    part.build("ammo_mesh", root)
    return root


def junk_toolbox(P):
    root = empty("junk_toolbox")
    part = Part()
    part.box(P["red"], loc=(0, 0, 0.17), size=(0.6, 0.32, 0.32), bevel=0.04, segs=3)
    part.box(P["gunmetal"], loc=(0, 0, 0.28), size=(0.62, 0.34, 0.03), bevel=0.01)
    part.tube(P["gunmetal"], [(-0.13, 0, 0.33), (-0.13, 0, 0.42), (0.13, 0, 0.42), (0.13, 0, 0.33)], radius=0.025)
    wrench = [(-0.16, -0.025), (0.08, -0.025), (0.1, -0.06), (0.17, -0.06), (0.13, -0.02), (0.13, 0.02), (0.17, 0.06),
              (0.1, 0.06), (0.08, 0.025), (-0.16, 0.025)]
    part.extrude(P["white"], wrench, depth=0.02, loc=(0, -0.165, 0.16), rot=(math.pi / 2, 0, 0.35), scale=1.4,
                 bevel=0.006)
    part.build("toolbox_mesh", root)
    return root


def junk_canister(P):
    root = empty("junk_canister")
    part = Part()
    part.cylinder(P["steel"], loc=(0, 0, 0.2), radius=0.19, depth=0.6, rot=ALONG_X, bevel=0.05, segs=24)
    for x in (-0.18, 0.18):
        part.cylinder(P["red"], loc=(x, 0, 0.2), radius=0.197, depth=0.07, rot=ALONG_X, segs=24)
    part.cylinder(P["steel_dark"], loc=(0.33, 0, 0.2), radius=0.08, depth=0.08, rot=ALONG_X, segs=16, bevel=0.015)
    part.box(P["steel_dark"], loc=(0, 0, 0.04), size=(0.4, 0.12, 0.08), bevel=0.02)
    part.build("canister_mesh", root)
    return root


def junk_barrel(P):
    root = empty("junk_barrel")
    part = Part()
    part.cylinder(P["blue"], loc=(0, 0, 0.3), radius=0.22, depth=0.6, bevel=0.04, segs=24)
    for z in (0.12, 0.48):
        part.torus(P["blue_dark"], loc=(0, 0, z), major=0.222, minor=0.02, segs=28)
    part.cylinder(P["white"], loc=(0, 0, 0.3), radius=0.224, depth=0.1, segs=24)
    part.build("barrel_mesh", root)
    return root


def junk_duck(P):
    root = empty("junk_duck")
    part = Part()
    part.sphere(P["duck"], loc=(0, 0, 0.16), scale=(0.24, 0.18, 0.15), segs=24, rings=14)
    part.sphere(P["duck"], loc=(-0.2, 0, 0.24), scale=(0.08, 0.06, 0.08), rot=(0, 0.6, 0), segs=12, rings=8)
    part.sphere(P["duck"], loc=(0.12, 0, 0.36), scale=0.13, segs=24, rings=14)
    part.sphere(P["beak"], loc=(0.25, 0, 0.33), scale=(0.08, 0.06, 0.03), segs=16, rings=8)
    for y in (-0.09, 0.09):
        part.sphere(P["black"], loc=(0.19, y, 0.4), scale=(0.025, 0.02, 0.03), segs=10, rings=8)
        part.sphere(P["eye_shine"], loc=(0.205, y * 1.12, 0.41), scale=0.008, segs=6, rings=4)
    part.sphere(P["duck"], loc=(-0.02, -0.16, 0.18), scale=(0.12, 0.04, 0.07), rot=(0.3, 0, 0), segs=14, rings=8)
    part.build("duck_mesh", root)
    return root


def proj_torpedo(P):
    root = empty("proj_torpedo")
    part = Part()
    torpedo_shape(part, P, length=1.0, radius=0.15)
    part.build("torpedo_mesh", root)
    return root


def proj_missile(P):
    root = empty("proj_missile")
    part = Part()
    missile_shape(part, P)
    part.build("missile_mesh", root)
    return root


def proj_player_missile(P):
    root = empty("proj_player_missile")
    part = Part()
    missile_shape(part, P, body="white", nose="red")
    part.build("player_missile_mesh", root)
    return root


def star(points=5, outer=0.2, inner=0.09):
    return [((outer if i % 2 == 0 else inner) * math.cos(math.pi / 2 + math.pi * i / points),
             (outer if i % 2 == 0 else inner) * math.sin(math.pi / 2 + math.pi * i / points)) for i in range(points * 2)]


def pickup_coin(P):
    root = empty("pickup_coin")
    part = Part()
    face = (math.pi / 2, 0, 0)
    part.cylinder(P["gold"], radius=0.35, depth=0.1, rot=face, bevel=0.03, segs=32)
    part.torus(P["gold_dark"], major=0.29, minor=0.022, rot=face, segs=32, tube_segs=8, loc=(0, -0.05, 0))
    part.torus(P["gold_dark"], major=0.29, minor=0.022, rot=face, segs=32, tube_segs=8, loc=(0, 0.05, 0))
    part.extrude(P["gold_dark"], star(), depth=0.13, rot=face, bevel=0.012)
    part.build("coin_mesh", root)
    return root


def shield_outline(scale=1.0, samples=10):
    left = []
    for i in range(samples + 1):
        t = i / samples
        left.append((-0.44 * math.cos(t * math.pi / 2) ** 0.75, 0.42 - 0.94 * t))
    top = [(-0.44 + 0.88 * i / 6, 0.42 + 0.08 * math.sin(math.pi * i / 6)) for i in range(1, 6)]
    right = [(-x, y) for x, y in reversed(left)]
    return [(x * scale, y * scale) for x, y in left + right[1:] + list(reversed(top))]


def icon_shield(P):
    root = empty("icon_shield")
    part = Part()
    face = (math.pi / 2, 0, 0)
    part.extrude(P["blue_dark"], shield_outline(), depth=0.14, rot=face, bevel=0.04, bevel_segs=3)
    part.extrude(P["shield_glow"], shield_outline(0.78), depth=0.18, rot=face, loc=(0, 0, 0.01), bevel=0.03)
    part.extrude(P["white"], [(-0.22, 0.28), (-0.08, 0.3), (-0.2, -0.05), (-0.28, 0.05)], depth=0.2, rot=face,
                 bevel=0.01)
    part.build("icon_shield_mesh", root)
    return root


def icon_sonar(P):
    root = empty("icon_sonar")
    part = Part()
    face = (math.pi / 2, 0, 0)
    part.cylinder(P["gunmetal"], radius=0.55, depth=0.06, rot=face, segs=40)
    for r in (0.18, 0.33, 0.48):
        part.torus(P["teal_glow"], major=r, minor=0.022, rot=face, loc=(0, -0.04, 0), segs=40, tube_segs=8)
    wedge = [(0, 0)] + points_on_arc(0.5, 0.35, 1.25, 8)
    part.extrude(P["teal_glow"], wedge, depth=0.03, rot=face, loc=(0, -0.05, 0))
    part.sphere(P["teal_glow"], loc=(0.2, -0.06, 0.25), scale=0.045, segs=10, rings=8)
    part.build("icon_sonar_mesh", root)
    return root


def icon_propeller(P):
    root = empty("icon_propeller")
    propeller(P, "icon_prop", root, (0, 0, 0), size=1.6, hub_mat="steel", blade_mat="white")
    root.rotation_euler = (0, 0, math.pi / 2)
    return root
