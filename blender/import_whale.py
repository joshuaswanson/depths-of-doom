"""Convert the humpback whale OBJ into a game-ready GLB.

    blender --background --python blender/import_whale.py -- /path/to/whale/model.obj

Joins the body, eyes and baleen into one model one unit long with its head along +X and its back up, shrinks the 4K
skin texture, and exports. The whale has no rig; the game swims it with a wave down its body in the vertex shader.
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "models-src", "humpback.glb")
SKIN_SIZE = 1024
source = sys.argv[sys.argv.index("--") + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=source)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

for o in meshes:
    for slot in o.material_slots:
        mat = slot.material
        nodes = mat.node_tree.nodes
        bsdf = nodes.get("Principled BSDF")
        tex = next((n for n in nodes if n.type == "TEX_IMAGE"), None)
        if o.name.startswith("Cornea"):
            mat.name = "whale_eye"
            bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.025, 1)
            bsdf.inputs["Roughness"].default_value = 0.08
        elif o.name.startswith("Barbs"):
            mat.name = "whale_baleen"
            bsdf.inputs["Roughness"].default_value = 0.7
        else:
            mat.name = "whale_skin"
            bsdf.inputs["Roughness"].default_value = 0.55
            if tex and tex.image and tex.image.size[0] > SKIN_SIZE:
                tex.image.scale(SKIN_SIZE, SKIN_SIZE)
        # The textures carry an unused alpha channel; keep the whale opaque.
        if tex:
            for link in list(mat.node_tree.links):
                if link.from_socket == tex.outputs.get("Alpha"):
                    mat.node_tree.links.remove(link)
        mat.surface_render_method = "DITHERED"

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
whale = bpy.context.view_layer.objects.active
whale.name = "humpback"

corners = [whale.matrix_world @ Vector(c) for c in whale.bound_box]
lo = Vector([min(v[i] for v in corners) for i in range(3)])
hi = Vector([max(v[i] for v in corners) for i in range(3)])
centre = (lo + hi) / 2
length = hi.y - lo.y
# Head from -Y to +X, centred, one unit nose to fluke.
whale.matrix_world = (Matrix.Rotation(math.pi / 2, 4, "Z") @ Matrix.Scale(1 / length, 4)
                      @ Matrix.Translation(-centre) @ whale.matrix_world)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for p in whale.data.polygons:
    p.use_smooth = True

for img in bpy.data.images:
    if img.source == "FILE" or img.packed_file is None:
        img.pack()

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=False, export_yup=True,
                          export_image_format="WEBP", export_image_quality=85)
print("exported", OUT, len(whale.data.vertices), "vertices")
