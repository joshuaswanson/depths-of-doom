"""Evil submarines and mines. Enemy subs face -X."""
import math

from mathutils import Vector

from assets_player import band, nose_viewport, open_hull, porthole_at, propeller, rivet_ring, viewport_x
from body import Body
from kit import Part, empty, frame, trs

class SharkBody(Body):
    """A predatory hull: an even, straight-sided midsection, a short firm nose (at -X) and a long straight taper back
    to a pointed tail, so it reads as long and armoured."""

    def __init__(self, length, radius, nose_share=0.26, tail_share=0.36, p_nose=1.6):
        self.length = length
        self.nose_len = length * nose_share
        self.tail_len = length * tail_share
        self.p_nose = p_nose
        super().__init__(length, radius, x0=0.0)
        self.start = -length / 2
        self.end = length / 2

    def r(self, x):
        if x <= self.start or x >= self.end:
            return 0.0
        nose_end = self.start + self.nose_len
        tail_start = self.end - self.tail_len
        if x < nose_end:
            t = (nose_end - x) / self.nose_len
            return self.radius * (1 - t ** self.p_nose) ** (1 / self.p_nose)
        if x > tail_start:
            t = (x - tail_start) / self.tail_len
            # A straight cone, slightly eased at the shoulder so it doesn't kink.
            return self.radius * (1 - t) ** 0.85 * (1 - 0.15 * t * (1 - t))
        return self.radius

    def profile(self, samples=64):
        pts = []
        for i in range(samples + 1):
            x = self.start + (self.end - self.start) * i / samples
            pts.append((x, self.r(x)))
        return pts


def enemy_tail(part, P, body, x_join, x_end, r_join, accent="enemy_red"):
    part.lathe(P["enemy_plate"], [(x_end + 0.04, 0.0), (x_end, r_join * 0.38), (x_join - 0.2, r_join * 0.8),
                                  (x_join, r_join)], segs=36)
    span = x_end - x_join
    # The fins grow out of the tapering hull itself, ahead of the tail cone, and sweep back to points past it.
    lead = span * 0.45
    fin = [(x_join - lead, 0.2 * r_join), (x_join + span * 0.75 - lead * 0.5, 1.75 * r_join),
           (x_end + span * 0.35 - lead * 0.5, 1.95 * r_join), (x_end + span * 0.05 - lead * 0.5, 1.2 * r_join),
           (x_end - lead * 0.5, 0.2 * r_join)]
    tip = [(x_join + span * 0.68 - lead * 0.5, 1.55 * r_join), (x_join + span * 0.76 - lead * 0.5, 1.78 * r_join),
           (x_end + span * 0.36 - lead * 0.5, 1.97 * r_join), (x_end + span * 0.22 - lead * 0.5, 1.6 * r_join)]
    for sz in (1, -1):
        for rot in ((math.pi / 2, 0, 0), (0, 0, 0)):
            part.extrude(P["enemy_hull"], [(x, z * sz) for x, z in fin], depth=0.1, rot=rot, bevel=0.03)
            part.extrude(P[accent], [(x, z * sz) for x, z in tip], depth=0.13, rot=rot, bevel=0.03)


ENEMY_PORTHOLE = {"cabin": "enemy_cockpit", "dial": "enemy_light", "ring": "enemy_red", "bolt": "steel",
                  "glass": "enemy_glass"}


def seam(part, material, body, x0, x1, theta, radius=0.014, rivets=0, rivet_size=0.022):
    """A raised weld seam running along the hull, optionally studded with rivets."""
    pts = [tuple(body.point(x0 + (x1 - x0) * i / 15, theta, 0.006)) for i in range(16)]
    part.tube(material, pts, radius=radius, segs=6)
    for i in range(rivets):
        x = x0 + (x1 - x0) * (i + 0.5) / rivets
        part.sphere(material, matrix=body.frame(x, theta) @ trs((0, 0, radius * 1.4), scale=rivet_size), segs=8,
                    rings=6)


def bolted_plate(part, plate, bolt, body, x, theta, size):
    """A square patch plate with a bolt in each corner."""
    m = body.frame(x, theta)
    part.box(plate, matrix=m @ trs((0, 0, 0.012)), size=(size, size * 0.8, 0.03), bevel=0.01)
    for dx in (-1, 1):
        for dy in (-1, 1):
            part.sphere(bolt, matrix=m @ trs((dx * size * 0.38, dy * size * 0.3, 0.03), scale=size * 0.07), segs=8,
                        rings=6)


def red_light(part, P, matrix, radius=0.07):
    part.torus(P["gunmetal"], matrix=matrix, major=radius, minor=radius * 0.3, segs=16, tube_segs=8)
    part.sphere(P["enemy_light"], matrix=matrix @ trs(scale=(radius * 0.9, radius * 0.9, radius * 0.5)), segs=12,
                rings=8)


def enemy_sub(P, name="enemy_sub", length=3.4, radius=0.85, tower=True, skull_mark=False, scope=1.0,
              spikes=0, turret=False, gatling=False):
    root = empty(name)
    b = SharkBody(length=length * 1.12, radius=radius * 0.8)
    h = length / 2
    part = Part()
    nose_x = viewport_x(b, sign=-1)
    part.lathe(P["enemy_hull"], open_hull(b, nose_x, sign=-1), segs=48, caps=False)
    band(part, P["enemy_red"], b, h * 0.42, h * 0.52, lift=0.02)
    band(part, P["enemy_plate"], b, -h * 0.45, -h * 0.38, lift=0.015, samples=3)
    band(part, P["enemy_plate"], b, h * 0.05, h * 0.12, lift=0.015, samples=3)
    rivet_ring(part, P["enemy_plate"], b, -h * 0.3, count=20, size=0.03)
    rivet_ring(part, P["enemy_plate"], b, h * 0.2, count=20, size=0.03)
    enemy_tail(part, P, b, h * 0.75, h * 1.38, b.r(h * 0.75))
    nose_viewport(part, (P["enemy_plate"], P["enemy_red"], P["steel"], P["enemy_glass"], P["eye_shine"],
                         P["enemy_cockpit"], (P["enemy_light"], P["enemy_light"], P["dial_amber"])), b, nose_x,
                  sign=-1, glow=P["enemy_glow_core"])

    for mirror in (False, True):
        side = (lambda a: math.pi - a) if mirror else (lambda a: a)
        hatch = b.frame(h * 0.62, side(math.radians(8)))
        part.box(P["enemy_red"], matrix=hatch @ trs((0, 0, 0.02)), size=(0.32 * radius, 0.32 * radius, 0.08),
                 bevel=0.03)
        part.sphere(P["gunmetal"], matrix=hatch @ trs((0, 0, 0.07), scale=(0.05, 0.05, 0.03)), segs=10, rings=6)
        for x in (-h * 0.5, h * 0.72):
            red_light(part, P, b.frame(x, side(math.radians(-25))), radius=0.06 * radius / 0.85)

    if tower:
        tx = -h * 0.44
        tz = b.r(tx)
        r = radius * 0.75
        t_h = 0.75 * r
        # A swept-back conning tower like a shark's dorsal fin, its leading edge raked toward the tail.
        tower = [(tx - 0.3 * r, tz - 0.12), (tx + 0.18 * r, tz + t_h * 1.02), (tx + 0.55 * r, tz + t_h * 1.08),
                 (tx + 1.1 * r, tz + t_h * 0.38), (tx + 1.05 * r, tz - 0.12)]
        part.extrude(P["enemy_hull"], tower, depth=0.5 * r, rot=(math.pi / 2, 0, 0), bevel=0.05)
        cap = [(tx - 0.04 * r, tz + t_h * 0.95), (tx + 0.02 * r, tz + t_h * 1.08), (tx + 0.4 * r, tz + t_h * 1.15),
               (tx + 0.46 * r, tz + t_h * 1.0)]
        part.extrude(P["enemy_red"], cap, depth=0.54 * r, rot=(math.pi / 2, 0, 0), bevel=0.03)
        for side in (-1, 1):
            for dx in (0.0, 0.28, 0.56):
                red_light(part, P, frame(Vector((tx + dx * r, 0.255 * r * side, tz + t_h * 0.5)),
                                         Vector((0, side, 0))), radius=0.06 * r)
        # The player's periscope, mirrored to face the nose and scaled by `scope`, rising from the top of the tower.
        def grow(dx, dz):
            return (tx + 0.15 - dx * scope, 0, tz + t_h * 1.12 + dz * scope)

        pipe = [grow(0, -0.3), grow(0, 0.308), grow(0.042, 0.476), grow(0.21, 0.588), grow(0.378, 0.616)]
        part.tube(P["gunmetal"], pipe, radius=0.12 * scope, segs=18)
        part.cylinder(P["gunmetal"], loc=grow(0.518, 0.616), radius=0.21 * scope, depth=0.36 * scope,
                      rot=(0, math.pi / 2, 0), bevel=0.04 * scope)
        part.torus(P["enemy_red"], loc=grow(0.714, 0.616), major=0.17 * scope, minor=0.05 * scope,
                   rot=(0, math.pi / 2, 0), segs=28)
        part.cylinder(P["enemy_light"], loc=grow(0.714, 0.616), radius=0.155 * scope, depth=0.04 * scope,
                      rot=(0, math.pi / 2, 0), segs=24)
        part.torus(P["enemy_red"], loc=grow(0, 0.14), major=0.125 * scope, minor=0.035 * scope, segs=24)


    for i in range(spikes):
        x = -h * 0.55 + h * 1.1 * i / max(spikes - 1, 1)
        for theta in (math.radians(65), math.radians(115)):
            m = b.frame(x, theta)
            part.cylinder(P["enemy_plate"], matrix=m @ trs((0, 0, 0.12)), radius=0.1, radius2=0.0, depth=0.3, segs=10)

    turret_at = None
    if turret:
        # A gun turret on the back; its barrels are a separate pivoting part so the game can aim them.
        tk = radius / 0.85
        tx = h * 0.18
        tz = b.r(tx)
        part.cylinder(P["enemy_plate"], loc=(tx, 0, tz + 0.08 * tk), radius=0.3 * tk, depth=0.2 * tk, segs=24,
                      bevel=0.04)
        part.sphere(P["enemy_hull"], loc=(tx, 0, tz + 0.2 * tk), scale=(0.28 * tk, 0.26 * tk, 0.2 * tk), segs=20,
                    rings=10)
        turret_at = (tx, tz + 0.25 * tk, tk)

    # A heavy armoured brow hooded down over the viewport, slanting into a frown at the centre.
    rn = b.r(nose_x)
    for side in (-1, 1):
        brow = [(nose_x + 0.75 * rn, rn * 1.42), (nose_x - 0.34 * rn, rn * 1.1), (nose_x - 0.32 * rn, rn * 0.9),
                (nose_x + 0.75 * rn, rn * 1.16)]
        part.extrude(P["enemy_plate"], brow, depth=0.7 * rn, loc=(0, side * 0.4 * rn, 0),
                     rot=(math.pi / 2 + side * 0.35, 0, 0), bevel=0.03)
    # Swept-back hydroplanes low on the flanks, like a shark's pectoral fins.
    # Rooted on the hull surface itself, a little below the waterline of the flank.
    for side in (-1, 1):
        x0 = -h * 0.42
        root_at = b.point(x0 + 0.35 * radius, (math.pi if side > 0 else 0) - math.radians(18), -0.03)
        fin = [(x0, 0), (x0 + 0.85 * radius, 0.75 * radius), (x0 + 1.05 * radius, 0.68 * radius), (x0 + 0.7 * radius, 0)]
        part.extrude(P["gunmetal"], [(x, y * side) for x, y in fin], depth=0.07 * radius,
                     loc=(0, root_at.y, root_at.z), rot=(0.18 * side, 0, 0), bevel=0.02)

    k = radius / 0.85
    seam(part, P["enemy_plate"], b, -h * 0.62, h * 0.7, -math.pi / 2, radius=0.016 * k, rivets=14,
         rivet_size=0.026 * k)
    for x in (-h * 0.32, h * 0.02, h * 0.36):
        bolted_plate(part, P["enemy_plate"], P["steel"], b, x, -math.pi / 2, 0.3 * k)
    part.build(f"{name}_body", root)

    if turret_at:
        tx, tz, tk = turret_at
        pivot = empty("turret_guns", root, (tx, 0, tz))
        guns = Part()
        # The boss carries a heavy four-barrel gun; the gunner a twin.
        offsets = [(-0.1, 0.0), (0.1, 0.0)]
        if gatling:
            offsets = [(-0.11, 0.07), (0.11, 0.07), (-0.11, -0.07), (0.11, -0.07)]
        guns.sphere(P["gunmetal"], loc=(0, 0, 0), scale=(0.16 * tk, 0.2 * tk, 0.14 * tk), segs=16, rings=10)
        for y, z in offsets:
            guns.cylinder(P["gunmetal"], loc=(-0.45 * tk, y * tk, z * tk), radius=0.05 * tk, depth=0.6 * tk,
                          rot=(0, math.pi / 2, 0), segs=12)
            guns.cylinder(P["enemy_light"], loc=(-0.76 * tk, y * tk, z * tk), radius=0.03 * tk, depth=0.01,
                          rot=(0, math.pi / 2, 0), segs=10)
        if gatling:
            guns.cylinder(P["enemy_red"], loc=(-0.2 * tk, 0, 0), radius=0.13 * tk, depth=0.12 * tk,
                          rot=(0, math.pi / 2, 0), segs=16)
        guns.build("turret_guns_mesh", pivot)
        empty("gun_muzzle", pivot, (-0.82 * tk, 0, 0))

    # Portholes, plates and bolts along the flanks. The game hides them on hulls that carry a spray-painted skull,
    # so the boss, which always does, has none.
    if not skull_mark:
        sides = Part()
        for mirror in (False, True):
            side = (lambda a: math.pi - a) if mirror else (lambda a: a)
            for x, size in ((-h * 0.6, 0.2), (-h * 0.1, 0.2)):
                porthole_at(sides, P, b.frame(x, side(math.radians(4))), radius=size * k, mats=ENEMY_PORTHOLE)
            seam(sides, P["enemy_plate"], b, -h * 0.55, h * 0.4, side(math.radians(38)), radius=0.012 * k,
                 rivets=12, rivet_size=0.022 * k)
            seam(sides, P["enemy_plate"], b, -h * 0.55, h * 0.4, side(math.radians(-42)), radius=0.012 * k,
                 rivets=12, rivet_size=0.022 * k)
            for x in (-h * 0.38, h * 0.08):
                bolted_plate(sides, P["enemy_plate"], P["steel"], b, x, side(math.radians(22)), 0.22 * k)
        sides.build("side_detail", root)
    propeller(P, "propeller", root, (h * 1.45, 0, 0), size=0.95 * radius, hub_mat="gunmetal", blade_mat="enemy_red")
    empty("muzzle", root, (-h * 1.02, 0, -0.1 * radius))
    return root


def enemy_scout(P):
    # The game draws the player at 0.82 and scouts at 1.19, so this matches the player's periscope on screen.
    return enemy_sub(P, "enemy_scout", length=2.3, radius=0.66, scope=0.82 / 1.19)


def enemy_gunner(P):
    return enemy_sub(P, "enemy_gunner", length=3.4, radius=0.85, turret=True, scope=0.72)


def enemy_boss(P):
    return enemy_sub(P, "enemy_boss", length=5.8, radius=1.45, skull_mark=True, spikes=5, turret=True, gatling=True,
                     scope=1.2)


def mine(P):
    root = empty("mine")
    part = Part()
    part.sphere(P["mine"], scale=0.5, segs=32, rings=18)
    part.torus(P["enemy_plate"], major=0.505, minor=0.035, segs=40, tube_segs=8)
    golden = math.pi * (3 - math.sqrt(5))
    count = 14
    for i in range(count):
        y = 1 - 2 * (i + 0.5) / count
        r = math.sqrt(1 - y * y)
        d = Vector((math.cos(golden * i) * r, y, math.sin(golden * i) * r))
        m = frame(d * 0.45, d)
        part.cylinder(P["enemy_plate"], matrix=m @ trs((0, 0, 0.13)), radius=0.07, radius2=0.035, depth=0.22, segs=10)
        part.sphere(P["enemy_light"], matrix=m @ trs((0, 0, 0.27), scale=0.05), segs=10, rings=8)
    for i in range(10):
        a = 2 * math.pi * i / 10
        d = Vector((math.cos(a), math.sin(a) * 0.3 - 0.5, math.sin(a) * 0.6)).normalized()
        part.sphere(P["enemy_light"], matrix=frame(d * 0.495, d) @ trs(scale=(0.03, 0.03, 0.015)), segs=8, rings=6)
    part.build("mine_mesh", root)
    return root

