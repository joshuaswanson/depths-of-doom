"""Rig the downloaded polar bear and give it a walk and idle animations.

    blender --background --python blender/rig_polar_bear.py -- SOURCE.glb

The bear comes out one unit long, head along +X, back up, standing on its rest pose, with a skeleton fitted to its own
legs (each leg measured from the mesh, so a leg set forward in the rest pose keeps its own bones) and skinned by bone
heat. Its paws are driven by IK targets: through each stance a paw stays planted while the body passes over it, then
it lifts, swings forward in an arc and sets down flat. The animations are baked to plain bone keys:
    walk   one stride cycle, walked in place; the body moves WALK_STRIDE units forward per cycle
    sniff  head lowered to the snow, nosing about
    scent  head raised into the wind, sniffing the air
"""
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
source = sys.argv[sys.argv.index("--") + 1]
FPS = 30
WALK_FRAMES = 32
WALK_STRIDE = 0.22
# Each paw's place in the cycle when it sets down: a four-beat walk, left hind, left fore, right hind, right fore.
PHASE = {"LH": 0.0, "LF": 0.24, "RH": 0.5, "RF": 0.74}
DUTY = 0.65
# One walk cycle of a dog from motion capture (scripts/dog_walk.py). The bear walks more slowly, so its paws keep
# their own timing, but each swings forward along the dog's path, lifting as the dog's do, and the body bobs, rolls
# and sways as the dog's does.
DOG = json.load(open(os.path.join(ROOT, "blender", "dog_walk.json")))


def dog_profiles():
    frames = DOG["frames"]
    n = len(frames) - 1
    legs = {}
    for leg in PHASE:
        h = np.array([f["paws"][leg][1] for f in frames])
        x = np.array([f["paws"][leg][0] for f in frames])
        down = h < h.min() + 1.5
        lift_at = next(i for i in range(1, n + 1) if down[i - 1] and not down[i])
        land_at = next(i for i in range(lift_at, lift_at + n + 1) if down[i % n] and not down[(i - 1) % n])
        span = range(lift_at - 1, land_at + 1)
        hs = np.array([h[i % n] for i in span]) - h.min()
        xs = np.array([x[i % n] for i in span])
        legs[leg] = {"lift": hs / DOG["hips_height"], "ease": (xs - xs[0]) / (xs[-1] - xs[0])}
    return legs


SWING = dog_profiles()


def sample(curve, p):
    f = p * (len(curve) - 1)
    i = min(int(f), len(curve) - 2)
    return curve[i] + (curve[i + 1] - curve[i]) * (f - i)


def dog_body(phase):
    frames = DOG["frames"]
    f = phase % 1 * (len(frames) - 1)
    i = min(int(f), len(frames) - 2)
    t = f - i
    mix = lambda a, b: [a[k] + (b[k] - a[k]) * t for k in range(len(a))]
    turn = {k: mix(frames[i]["turn"][k], frames[i + 1]["turn"][k]) for k in frames[i]["turn"]}
    hips = frames[i]["hips"] + (frames[i + 1]["hips"] - frames[i]["hips"]) * t
    return turn, (hips - DOG["hips_height"]) / DOG["hips_height"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
scene = bpy.context.scene
scene.render.fps = FPS
body = next(o for o in scene.objects if o.type == "MESH")
for o in list(scene.objects):
    if o is not body:
        bpy.data.objects.remove(o, do_unlink=True)
body.matrix_world = body.matrix_world.copy()
if body.data.shape_keys:
    body.shape_key_clear()
for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Head along -Y, up +Z in the source: turn it to head +X, scale to one unit long, centre it.
points = np.array([v.co[:] for v in body.data.vertices])
lo, hi = points.min(0), points.max(0)
fix = (Matrix.Scale(1 / (hi[1] - lo[1]), 4) @ Matrix.Rotation(math.pi / 2, 4, "Z")
       @ Matrix.Translation(-Vector((lo + hi) / 2)))
body.data.transform(fix)
body.data.update()
body.name = "polar_bear"
P = np.array([v.co[:] for v in body.data.vertices])
GROUND = P[:, 2].min()


def leg_points(name):
    hind = name.endswith("H")
    side = 1 if name.startswith("L") else -1
    m = (P[:, 1] * side > 0.02) & ((P[:, 0] < -0.12) if hind else ((P[:, 0] > -0.12) & (P[:, 0] < 0.25)))
    return P[m], side, hind


def band(pts, z0, z1, near_x=None, reach=0.09):
    m = (pts[:, 2] >= z0) & (pts[:, 2] < z1)
    if near_x is not None:
        m &= np.abs(pts[:, 0] - near_x) < reach
    return pts[m].mean(0)


legs = {}
for name in PHASE:
    pts, side, hind = leg_points(name)
    ankle = band(pts, GROUND + 0.04, GROUND + 0.07)
    knee = band(pts, GROUND + 0.17, GROUND + 0.2, ankle[0])
    sole = pts[pts[:, 2] < GROUND + 0.02]
    toe = sole[sole[:, 0] > np.percentile(sole[:, 0], 85)].mean(0)
    toe[2] = GROUND + 0.01
    # Hips sit behind and above the hind knees; shoulders above and a little behind the elbows.
    top = np.array([knee[0] - (0.05 if hind else 0.02), knee[1] * 0.85, GROUND + (0.3 if hind else 0.33)])
    legs[name] = dict(side=side, hind=hind, top=Vector(top), knee=Vector(knee), ankle=Vector(ankle), toe=Vector(toe))
# The rest pose has one leg of each pair set forward, but hips and shoulders sit level across the body.
for hind in (True, False):
    pair = [g for g in legs.values() if g["hind"] == hind]
    x = sum(g["top"].x for g in pair) / 2
    for g in pair:
        g["top"].x = x
for name, g in legs.items():
    print(name, {k: tuple(round(x, 3) for x in v) for k, v in g.items() if isinstance(v, Vector)})

# The skeleton.
arm_data = bpy.data.armatures.new("polar_bear_rig")
rig = bpy.data.objects.new("polar_bear_rig", arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None, deform=True):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.parent = eb[parent] if parent else None
    b.use_deform = deform
    if parent and (b.parent.tail - b.head).length < 1e-4:
        b.use_connect = True
    return b


z_back = GROUND + 0.32
bone("root", (0, 0, GROUND), (0, 0, GROUND + 0.1), deform=False)
bone("hips", (-0.1, 0, z_back), (-0.36, 0, z_back + 0.02), "root")
bone("chest", (-0.1, 0, z_back), (0.1, 0, z_back + 0.04), "root")
bone("neck", (0.1, 0, z_back + 0.04), (0.25, 0, z_back + 0.07), "chest")
bone("head", (0.25, 0, z_back + 0.07), (0.47, 0, z_back + 0.04), "neck")
for name, g in legs.items():
    parent = "hips" if g["hind"] else "chest"
    upper, lower, foot = (("thigh", "shin", "foot") if g["hind"] else ("arm", "forearm", "paw"))
    bone(f"{upper}_{name}", g["top"], g["knee"], parent)
    bone(f"{lower}_{name}", g["knee"], g["ankle"], f"{upper}_{name}")
    bone(f"{foot}_{name}", g["ankle"], g["toe"], f"{lower}_{name}")
    # Controls: where the ankle goes, and which way the knee or elbow points (hind knees forward, elbows back).
    ik = bone(f"ik_{name}", g["ankle"], g["ankle"] + Vector((0.08, 0, 0)), "root", deform=False)
    pole_x = 0.4 if g["hind"] else -0.4
    bone(f"pole_{name}", g["knee"] + Vector((pole_x, 0, 0)), g["knee"] + Vector((pole_x, 0, 0.05)), "root", deform=False)
bpy.ops.object.mode_set(mode="POSE")
pb = rig.pose.bones


def pole_angle(upper, lower, pole):
    """The IK pole angle that leaves a two-bone chain exactly as it lies at rest, bending toward `pole`."""
    along = upper.tail_local - upper.head_local
    normal = (lower.tail_local - upper.head_local).cross(pole - upper.head_local)
    toward = normal.cross(along)
    x_axis = upper.matrix_local.to_3x3().col[0]
    angle = x_axis.angle(toward)
    return -angle if along.dot(x_axis.cross(toward)) < 0 else angle

for name, g in legs.items():
    upper, lower, foot = (("thigh", "shin", "foot") if g["hind"] else ("arm", "forearm", "paw"))
    c = pb[f"{lower}_{name}"].constraints.new("IK")
    c.target, c.subtarget = rig, f"ik_{name}"
    c.pole_target, c.pole_subtarget = rig, f"pole_{name}"
    c.pole_angle = pole_angle(rig.data.bones[f"{upper}_{name}"], rig.data.bones[f"{lower}_{name}"],
                              rig.data.bones[f"pole_{name}"].head_local)
    c.chain_count = 2
    # The paw keeps the heading of its control: flat while planted, tipping as it lifts.
    r = pb[f"{foot}_{name}"].constraints.new("CHILD_OF")
    r.target, r.subtarget = rig, f"ik_{name}"
    r.use_scale_x = r.use_scale_y = r.use_scale_z = False
    r.inverse_matrix = (rig.matrix_world @ pb[f"ik_{name}"].matrix).inverted()
bpy.ops.object.mode_set(mode="OBJECT")

# Skin by bone heat. It needs the seams welded shut, and works poorly on a model this small, so the bear and its
# skeleton are scaled up while it runs.
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=1e-5)
bpy.ops.object.mode_set(mode="OBJECT")
for o in (body, rig):
    o.scale = (20, 20, 20)
bpy.context.view_layer.update()
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
body.parent = None
for o in (body, rig):
    o.scale = (1, 1, 1)
body.matrix_world = Matrix.Identity(4)
body.parent = rig
bpy.context.view_layer.update()
unweighted = sum(1 for v in body.data.vertices if not v.groups)
print("unweighted vertices", unweighted)


def key_pose(frame):
    for p in pb:
        p.keyframe_insert("location", frame=frame)
        p.keyframe_insert("rotation_quaternion", frame=frame)


def reset():
    for p in pb:
        p.location = (0, 0, 0)
        p.rotation_mode = "QUATERNION"
        p.rotation_quaternion = (1, 0, 0, 0)


def turn(bone, rotation):
    """Set a pose bone's rotation from a rotation given in the armature's frame (X forward, Y left, Z up)."""
    rest = rig.data.bones[bone].matrix_local.to_3x3()
    pb[bone].rotation_quaternion = (rest.inverted() @ rotation @ rest).to_quaternion()


def shift(bone, offset):
    pb[bone].location = rig.data.bones[bone].matrix_local.to_3x3().inverted() @ Vector(offset)


ROLL = lambda a: Matrix.Rotation(a, 3, "X")
# Positive pitch tips the front end down.
PITCH = lambda a: Matrix.Rotation(a, 3, "Y")
YAW = lambda a: Matrix.Rotation(a, 3, "Z")


def paw(name, phase):
    """Offset of a paw's ankle control from its rest place, and how far its toes tip down, at a point in the cycle."""
    g = legs[name]
    # Both paws of a pair swing about the same point, between where they stand at rest.
    pair = [l for l in legs.values() if l["hind"] == g["hind"]]
    centre = sum(l["ankle"].x for l in pair) / 2 + (0.015 if g["hind"] else 0.0) - g["ankle"].x
    reach = WALK_STRIDE * DUTY
    t = (phase - PHASE[name]) % 1
    if t < DUTY:
        # Planted: the body passes over it at walking pace, and the heel peels up as it is about to lift.
        s = t / DUTY
        heel = max(0.0, (s - 0.82) / 0.18)
        return Vector((centre + reach * (0.5 - s), 0, 0.012 * heel * heel)), 0.3 * heel * heel
    p = (t - DUTY) / (1 - DUTY)
    swing = SWING[name]
    x = centre - reach / 2 + reach * sample(swing["ease"], p)
    lift = sample(swing["lift"], p) * (g["top"].z - GROUND)
    # Lifted, the paw hangs limp from the wrist or ankle, the fore paws furthest, then swings out flat to land, toes
    # tipping up just before they touch.
    droop = (0.7 if g["hind"] else 1.2) * math.sin(math.pi * min(1.0, p / 0.8)) ** 1.3
    pitch = 0.3 * (1 - p) ** 2 + droop - 0.1 * math.sin(math.pi * max(0.0, (p - 0.8) / 0.2))
    # The wrist rises high enough for the hanging toes to clear the snow.
    foot = g["toe"] - g["ankle"]
    rest = math.asin((g["ankle"].z - g["toe"].z) / foot.length)
    toes = foot.length * math.sin(min(math.pi / 2, rest + pitch)) - (g["ankle"].z - GROUND - 0.01)
    lift = max(lift, toes + 0.006 * min(1.0, (1 - p) * 5))
    return Vector((x, 0, lift)), pitch


def make_action(name, frames, pose_at):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for f in range(frames + 1):
        reset()
        pose_at(f / frames, f)
        key_pose(f)
    return action


def walk_pose(phase, frame):
    for name in PHASE:
        offset, pitch = paw(name, phase)
        shift(f"ik_{name}", offset)
        turn(f"ik_{name}", PITCH(pitch))
    body, bob = dog_body(phase)
    hips = body["Hips"]
    chest = body["Spine1"]
    head = body["Head"]
    # The dog's turns, measured as roll, pitch (nose up) and yaw (to its right), tempered for a heavier animal.
    turn("hips", ROLL(-hips[0] * 0.6) @ PITCH(-hips[1] * 0.5) @ YAW(-hips[2] * 0.25))
    turn("chest", ROLL(-chest[0] * 0.5) @ PITCH(-chest[1] * 0.5) @ YAW(-chest[2] * 0.5))
    turn("neck", YAW(-head[2] * 0.3) @ PITCH(-head[1] * 0.3))
    turn("head", ROLL(-head[0] * 0.5) @ PITCH(-head[1] * 0.4) @ YAW(-head[2] * 0.4))
    height = (legs["LH"]["top"].z - GROUND) * bob
    for b in ("hips", "chest"):
        shift(b, (0, 0, height))


def stand_pose():
    for name in PHASE:
        offset, _ = paw(name, PHASE[name] + DUTY / 2)
        shift(f"ik_{name}", offset)


def sniff_pose(phase, frame):
    stand_pose()
    a = 2 * math.pi * phase
    down = 0.5 + 0.5 * math.sin(a * 2 - 1.2)
    turn("chest", PITCH(0.1 + 0.05 * down))
    turn("neck", YAW(0.25 * math.sin(a)) @ PITCH(0.5 + 0.25 * down))
    turn("head", YAW(0.2 * math.sin(a + 0.6)) @ PITCH(0.25 - 0.06 * math.sin(a * 9)))


def scent_pose(phase, frame):
    stand_pose()
    a = 2 * math.pi * phase
    turn("neck", YAW(0.35 * math.sin(a)) @ PITCH(-0.18 - 0.04 * math.sin(a * 2)))
    turn("head", YAW(0.15 * math.sin(a + 1)) @ PITCH(-0.3 - 0.05 * math.sin(a * 11)))


actions = [make_action("walk", WALK_FRAMES, walk_pose), make_action("sniff", 120, sniff_pose),
           make_action("scent", 120, scent_pose)]

# Bake each through the IK into plain bone keys, then drop the controls' constraints.
baked = []
for action in actions:
    rig.animation_data.action = action
    frames = int(action.frame_range[1])
    scene.frame_start, scene.frame_end = 0, frames
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(frame_start=0, frame_end=frames, only_selected=True, visual_keying=True,
                     clear_constraints=False, use_current_action=False, bake_types={"POSE"})
    out = rig.animation_data.action
    out.name = action.name + "_baked"
    baked.append((action.name, out))
    bpy.ops.object.mode_set(mode="OBJECT")
for p in pb:
    for c in list(p.constraints):
        p.constraints.remove(c)
for action in actions:
    bpy.data.actions.remove(action)
for name, action in baked:
    action.name = name
    action.use_fake_user = True
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action)
rig.animation_data.action = None
# The controls carry no mesh; leave them out of the skeleton the game loads.
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
for b in list(arm_data.edit_bones):
    if b.name.startswith(("ik_", "pole_")):
        arm_data.edit_bones.remove(b)
bpy.ops.object.mode_set(mode="OBJECT")

out = os.path.join(ROOT, "models-src", "polar_bear.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_skins=True, export_image_format="WEBP",
                          export_image_quality=85, export_def_bones=False)
print("exported", out)
