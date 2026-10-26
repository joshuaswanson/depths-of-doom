"""Bring a downloaded sea creature into the game: one unit long, head along +X, back up, textures at 1024.

    blender --background --python blender/import_marine.py -- SOURCE.glb OUT_NAME HEAD UP [DROP,DROP]

HEAD and UP name the source's axes in Blender terms (for example +Y or -Z). Static meshes are joined and their
transforms applied, so a vertex shader can bend them along X; rigged models keep their armature and animation.
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = sys.argv[sys.argv.index("--") + 1:]
source, name, head, up = args[:4]
drop = set(args[4].split(",")) if len(args) > 4 else set()
AXES = {"+X": (1, 0, 0), "-X": (-1, 0, 0), "+Y": (0, 1, 0), "-Y": (0, -1, 0), "+Z": (0, 0, 1), "-Z": (0, 0, -1)}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)
for o in list(bpy.context.scene.objects):
    if o.name in drop:
        bpy.data.objects.remove(o, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
rig = next((o for o in bpy.context.scene.objects if o.type == "ARMATURE"), None)

for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, round(1024 * img.size[1] / img.size[0]))

# Rotation taking the source's head and up axes onto +X and +Z.
h, u = Vector(AXES[head]), Vector(AXES[up])
basis = Matrix((h, u.cross(h), u)).transposed()
rotation = basis.inverted().to_4x4()

corners = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector([min(v[i] for v in corners) for i in range(3)])
hi = Vector([max(v[i] for v in corners) for i in range(3)])
length = max(abs((hi - lo).dot(h)), 1e-6)
fix = Matrix.Scale(1 / length, 4) @ rotation @ Matrix.Translation(-(lo + hi) / 2)

if rig is None:
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = name
    body.matrix_world = fix @ body.matrix_world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
else:
    top = [o for o in bpy.context.scene.objects if o.parent is None]
    holder = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(holder)
    for o in top:
        o.parent = holder
    holder.matrix_world = fix

out = os.path.join(ROOT, "models-src", f"{name}.glb")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True, export_animations=True,
                          export_skins=True, export_image_format="WEBP", export_image_quality=85)
print("exported", out)
