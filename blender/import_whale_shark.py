"""Convert the downloaded whale shark into a game-ready GLB.

    blender --background --python blender/import_whale_shark.py -- SOURCE.glb

The shark comes out one unit long with its head along +X and its back up, smoothed with one level of subdivision,
skinned to its own skeleton, with its swimming animation kept as "swim".
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models-src", "whale_shark.glb")
source = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
scene = bpy.context.scene
for o in list(scene.objects):
    if o.type == "MESH" and o.name.startswith("Icosphere"):
        bpy.data.objects.remove(o)
top = next(o for o in scene.objects if o.parent is None)
rig = next(o for o in scene.objects if o.type == "ARMATURE")
body = next(o for o in scene.objects if o.type == "MESH")

# Smooth the body: subdivide once in the rest pose, the weights carried over to the new vertices.
rig.data.pose_position = "REST"
bpy.context.view_layer.update()
bpy.context.view_layer.objects.active = body
sub = body.modifiers.new("smooth", "SUBSURF")
sub.levels = sub.render_levels = 1
sub.uv_smooth = "PRESERVE_BOUNDARIES"
bpy.ops.object.modifier_move_to_index(modifier="smooth", index=0)
bpy.ops.object.modifier_apply(modifier="smooth")
rig.data.pose_position = "POSE"

swim = bpy.data.actions["Action"]


def curves(action):
    if hasattr(action, "layers") and action.layers:
        return [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]
    return list(action.fcurves)


# The swim travels and turns the whole skeleton along a path; keep it swimming in place, heading straight on.
root = rig.data.bones[0].name
for c in curves(swim):
    if c.data_path in (f'pose.bones["{root}"].location', f'pose.bones["{root}"].rotation_quaternion'):
        for k in c.keyframe_points:
            k.co.y = c.keyframe_points[0].co.y
            k.handle_left.y = k.handle_right.y = k.co.y
rig.animation_data_create()
rig.animation_data.action = swim
if hasattr(rig.animation_data, "action_slot") and swim.slots:
    rig.animation_data.action_slot = swim.slots[0]
scene.frame_set(0)

# Head along +X (it faces -Y as imported), one unit from snout to tail tip, measured as it swims.
top.rotation_mode = "XYZ"
top.rotation_euler = (0, 0, math.pi / 2)
bpy.context.view_layer.update()
graph = bpy.context.evaluated_depsgraph_get()
posed = body.evaluated_get(graph)
pts = [posed.matrix_world @ v.co for v in posed.to_mesh().vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
length = hi.x - lo.x
top.scale = top.scale / length
top.location = -((lo + hi) / 2) / length
bpy.context.view_layer.update()
print("length", length, "tris", sum(len(p.vertices) - 2 for p in body.data.polygons))

swim.name = "swim"
for a in list(bpy.data.actions):
    if a is not swim:
        bpy.data.actions.remove(a)
rig.animation_data_create()
rig.animation_data.action = None
for t in list(rig.animation_data.nla_tracks):
    rig.animation_data.nla_tracks.remove(t)
track = rig.animation_data.nla_tracks.new()
track.name = "swim"
track.strips.new("swim", 0, swim)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_animations=True,
                          export_animation_mode="NLA_TRACKS", export_skins=True, export_image_format="WEBP",
                          export_image_quality=85)
print("exported", OUT)
