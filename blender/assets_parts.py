"""Bolt-on upgrade parts and junk. Each part's mount point is the origin; it extends along +Z away
from the hull and faces +X."""
import math

from assets_player import propeller
from kit import Part, empty, points_on_arc, trs

ALONG_X = (0, math.pi / 2, 0)


def torpedo_shape(part, P, loc=(0, 0, 0), length=1.0, radius=0.16):
    x, y, z = loc
    h = length / 2
    body = [(x - h, 0.0), (x - h, radius * 0.55), (x - h * 0.8, radius * 0.95), (x + h * 0.55, radius),
            (x + h * 0.62, radius * 0.97)]
    m = trs((0, y, z))
    part.lathe(P["green"], [(px, pr) for px, pr in body] + [(x + h * 0.62, 0.0)], matrix=m, segs=24)
    tip = [(x + h * 0.6, radius * 0.97), (x + h * 0.8, radius * 0.85), (x + h * 0.95, radius * 0.5), (x + h, 0.0)]
    part.lathe(P["torpedo_tip"], [(x + h * 0.6, 0.0)] + tip, matrix=m, segs=24)
    part.lathe(P["green_dark"], [(x + h * 0.25, radius * 0.9), (x + h * 0.25, radius * 1.04),
                                 (x + h * 0.35, radius * 1.04), (x + h * 0.35, radius * 0.9)],
               matrix=m, segs=24, loop=True)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        fin = [(x - h, 0), (x - h * 0.6, 0), (x - h * 0.85, radius * 1.7), (x - h * 1.02, radius * 1.7)]
        part.extrude(P["steel_dark"], fin, depth=0.03, matrix=m @ trs(rot=(a, 0, 0)) @ trs(rot=(math.pi / 2, 0, 0)))


def missile_shape(part, P, loc=(0, 0, 0), length=0.9, radius=0.11, body="missile_body", nose="enemy_red"):
    x, y, z = loc
    h = length / 2
    m = trs((0, y, z))
    part.lathe(P[body], [(x - h, 0.0), (x - h, radius * 0.8), (x - h * 0.9, radius), (x + h * 0.45, radius),
                         (x + h * 0.45, 0.0)], matrix=m, segs=20)
    part.lathe(P[nose], [(x + h * 0.44, 0.0), (x + h * 0.44, radius), (x + h * 0.7, radius * 0.8),
                         (x + h * 0.92, radius * 0.4), (x + h, 0.0)], matrix=m, segs=20)
    part.lathe(P["white"], [(x - h * 0.1, radius * 0.9), (x - h * 0.1, radius * 1.03), (x + h * 0.08, radius * 1.03),
                            (x + h * 0.08, radius * 0.9)], matrix=m, segs=20, loop=True)
    for i in range(4):
        a = i * math.pi / 2
        fin = [(x - h, 0), (x - h * 0.45, 0), (x - h * 0.8, radius * 2.0), (x - h * 1.05, radius * 2.0)]
        part.extrude(P[nose], fin, depth=0.035, matrix=m @ trs(rot=(a, 0, 0)) @ trs(rot=(math.pi / 2, 0, 0)),
                     bevel=0.01)


def mount_plate(part, P, size=(0.36, 0.3, 0.1), mat="steel_dark"):
    part.box(P[mat], loc=(0, 0, size[2] / 2), size=size, bevel=0.025)
    for sx in (-1, 1):
        for sy in (-1, 1):
            part.sphere(P["steel"], loc=(sx * (size[0] / 2 - 0.05), sy * (size[1] / 2 - 0.05), size[2]),
                        scale=0.025, segs=8, rings=6)


def part_cannon(P):
    root = empty("part_cannon")
    part = Part()
    mount_plate(part, P)
    part.box(P["gunmetal"], loc=(0, 0, 0.18), size=(0.22, 0.16, 0.16), bevel=0.03)
    part.cylinder(P["gunmetal"], loc=(0.0, 0, 0.32), radius=0.2, depth=0.55, rot=ALONG_X, bevel=0.05, segs=28)
    part.sphere(P["gunmetal"], loc=(-0.27, 0, 0.32), scale=(0.08, 0.17, 0.17), segs=20, rings=10)
    part.cylinder(P["red"], loc=(0.22, 0, 0.32), radius=0.212, depth=0.09, rot=ALONG_X, segs=28)
    part.cylinder(P["red"], loc=(-0.12, 0, 0.32), radius=0.212, depth=0.05, rot=ALONG_X, segs=28)
    for i in range(6):
        a = 2 * math.pi * i / 6
        y, z = 0.105 * math.cos(a), 0.32 + 0.105 * math.sin(a)
        part.cylinder(P["steel"], loc=(0.65, y, z), radius=0.042, depth=0.8, rot=ALONG_X, segs=12)
        part.cylinder(P["black"], loc=(1.051, y, z), radius=0.026, depth=0.01, rot=ALONG_X, segs=10)
    part.cylinder(P["steel_dark"], loc=(0.65, 0, 0.32), radius=0.05, depth=0.8, rot=ALONG_X, segs=12)
    for x in (0.55, 0.95):
        part.torus(P["steel_dark"], loc=(x, 0, 0.32), major=0.15, minor=0.03, rot=ALONG_X, segs=24)
    part.build("cannon_body", root)
    empty("muzzle", root, (1.08, 0, 0.32))
    return root


def part_torpedo(P):
    root = empty("part_torpedo")
    part = Part()
    part.box(P["steel_dark"], loc=(0, 0, 0.05), size=(0.85, 0.62, 0.1), bevel=0.03)
    for y in (-0.17, 0.17):
        torpedo_shape(part, P, loc=(0.05, y, 0.26), length=1.05, radius=0.15)
    for x in (-0.15, 0.3):
        part.box(P["steel"], loc=(x, 0, 0.2), size=(0.07, 0.68, 0.06), bevel=0.015)
        for y in (-0.17, 0.17):
            part.torus(P["steel"], loc=(x, y, 0.26), major=0.158, minor=0.022, rot=ALONG_X, segs=24, tube_segs=8)
    part.build("torpedo_rack", root)
    empty("muzzle", root, (0.6, 0, 0.26))
    return root


def part_missile(P):
    root = empty("part_missile")
    part = Part()
    mount_plate(part, P, size=(0.5, 0.42, 0.08))
    part.box(P["blue"], loc=(0, 0, 0.3), size=(0.75, 0.56, 0.42), bevel=0.06, segs=3)
    part.box(P["blue_dark"], loc=(0.385, 0, 0.3), size=(0.04, 0.5, 0.36), bevel=0.015)
    part.box(P["yellow"], loc=(-0.05, 0, 0.3), size=(0.12, 0.575, 0.435), bevel=0.03)
    for y in (-0.13, 0.13):
        for z in (0.2, 0.4):
            part.cylinder(P["black"], loc=(0.4, y, z), radius=0.085, depth=0.03, rot=ALONG_X, segs=16)
            part.lathe(P["red"], [(0.38, 0.0), (0.38, 0.07), (0.45, 0.065), (0.52, 0.035), (0.56, 0.0)],
                       matrix=trs((0, y, z)), segs=16)
    part.build("missile_pod", root)
    empty("muzzle", root, (0.6, 0, 0.3))
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
    tilt = trs((0.02, 0, 0.12), (0, -math.pi / 2 + 0.5, 0))
    prof = [(-0.12 + 0.36 * (i / 8) ** 2, 0.03 + 0.3 * i / 8) for i in range(9)]
    d.lathe(P["steel"], [(-0.13, 0.0)] + [(h - 0.01, r) for h, r in prof] + [(prof[-1][0] + 0.01, prof[-1][1])]
            + [(h + 0.02, r) for h, r in reversed(prof)] + [(-0.1, 0.0)], matrix=tilt @ trs(rot=(0, -math.pi / 2, 0)),
            segs=28)
    d.torus(P["teal_glow"], matrix=tilt, loc=(0, 0, 0.24), major=0.33, minor=0.022, segs=32)
    d.sphere(P["teal_glow"], matrix=tilt @ trs((0, 0, 0.08), scale=0.06), segs=12, rings=8)
    d.tube(P["steel_dark"], [(0, 0, 0), (0, 0, 0.08)], radius=0.02, matrix=tilt, segs=8)
    d.sphere(P["gunmetal"], scale=0.06, segs=12, rings=8)
    d.build("sonar_dish_mesh", dish)
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
    part.extrude(P["white"], wrench, depth=0.02, loc=(0, -0.165, 0.15), rot=(math.pi / 2, 0, 0.5), bevel=0.006)
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


def icon_shield(P):
    root = empty("icon_shield")
    part = Part()
    outline = [(0, -0.5)] + points_on_arc(0.62, -0.95, -0.2, 6, center=(-0.25, 0.25)) + [(-0.4, 0.42), (0, 0.5),
                                                                                           (0.4, 0.42)]
    outline += [(-x, y) for x, y in reversed(points_on_arc(0.62, -0.95, -0.2, 6, center=(-0.25, 0.25)))]
    part.extrude(P["blue"], outline, depth=0.14, rot=(math.pi / 2, 0, 0), bevel=0.04, bevel_segs=3)
    part.extrude(P["shield_glow"], [(x * 0.72, y * 0.72 + 0.02) for x, y in outline], depth=0.18,
                 rot=(math.pi / 2, 0, 0), bevel=0.03)
    part.extrude(P["white"], [(x * 0.3, y * 0.3 + 0.12) for x, y in outline], depth=0.22, rot=(math.pi / 2, 0, 0),
                 loc=(0.08, 0, 0), bevel=0.02)
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
