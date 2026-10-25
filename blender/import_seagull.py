"""Convert the rigged, animated seagull scene into a game-ready GLB.

    blender --background ~/Developer/seagull/seagull.blend --python blender/import_seagull.py

Keeps the rig and the first 240 frames of its animation (floating, takeoff, flight), which is all the game plays.
Drops the water, cameras and lights, reduces the very dense mesh, and bakes the animation so feather bones moved by
drivers are exported too.
"""
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models-src", "seagull.glb")
TARGET_FACES = 4500

for o in list(bpy.data.objects):
    if o.type in {"CAMERA", "LIGHT"} or o.name in {"Water", "CamTarget"}:
        bpy.data.objects.remove(o, do_unlink=True)

gull = bpy.data.objects["Seagull"]
rig = bpy.data.objects["GullRig"]

bpy.ops.object.select_all(action="DESELECT")
gull.select_set(True)
bpy.context.view_layer.objects.active = gull
decimate = gull.modifiers.new("decimate", "DECIMATE")
decimate.ratio = TARGET_FACES / len(gull.data.polygons)
bpy.ops.object.modifier_move_to_index(modifier=decimate.name, index=0)
bpy.ops.object.modifier_apply(modifier=decimate.name)

scene = bpy.context.scene
scene.frame_start, scene.frame_end = 1, 240

bpy.ops.object.select_all(action="DESELECT")
gull.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
    export_animations=True, export_skins=True, export_bake_animation=True, export_force_sampling=True,
    export_frame_range=True, export_anim_single_armature=True, export_vertex_color="ACTIVE",
    export_active_vertex_color_when_no_material=True,
)
print("exported", OUT, len(gull.data.polygons), "faces")
