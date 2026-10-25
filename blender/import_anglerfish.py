"""Convert the hand-built anglerfish scene into a game-ready GLB.

    blender --background ~/Developer/angler-fish/anglerfish.blend --python blender/import_anglerfish.py

The source uses procedural node materials and a very dense sculpted body, neither of which survive glTF export.
This decimates the skin-covered pieces into one low-poly mesh, bakes the procedural skin and mouth colours plus all
surface relief into colour and normal maps, swaps the remaining parts onto plain materials, and exports.
"""
import os

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "models", "anglerfish.glb")
TEX = 2048
TARGET_FACES = 14000

SKINNED = ["AnglerBody", "DorsalSpines", "Eyelid_L", "Eyelid_R"]
FINS = ["AnalFin", "CaudalFin", "DorsalFin", "PectoralFin_L", "PectoralFin_R"]
CURVES = ["Illicium", "Lip"]
DROP = ["MarineSnow", "WaterVolume", "EscaHalo", "GapeCutter", "JawHollowCutter"]

scene = bpy.context.scene


def principled(name, color, rough=0.5, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    if alpha < 1:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.surface_render_method = "BLENDED"
    return mat


def realize(obj):
    """Apply modifiers and turn curves into meshes."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if obj.type == "CURVE":
        bpy.ops.object.convert(target="MESH")
    else:
        for md in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=md.name)
    return bpy.context.view_layer.objects.active


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    return obj


for o in list(bpy.data.objects):
    if o.type in {"CAMERA", "LIGHT"} or o.name in DROP:
        bpy.data.objects.remove(o, do_unlink=True)

for name in SKINNED + CURVES:
    realize(bpy.data.objects[name])

high = join([bpy.data.objects[n] for n in SKINNED], "AnglerHigh")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

low = high.copy()
low.data = high.data.copy()
scene.collection.objects.link(low)
low.name = "AnglerSkin"
bpy.ops.object.select_all(action="DESELECT")
low.select_set(True)
bpy.context.view_layer.objects.active = low
decimate = low.modifiers.new("decimate", "DECIMATE")
decimate.ratio = TARGET_FACES / len(low.data.polygons)
bpy.ops.object.modifier_apply(modifier=decimate.name)
for p in low.data.polygons:
    p.use_smooth = True

bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

color_img = bpy.data.images.new("angler_color", TEX, TEX)
normal_img = bpy.data.images.new("angler_normal", TEX, TEX, is_data=True)
normal_img.colorspace_settings.name = "Non-Color"

baked = bpy.data.materials.new("angler_skin")
baked.use_nodes = True
nodes = baked.node_tree.nodes
target = nodes.new("ShaderNodeTexImage")
low.data.materials.clear()
low.data.materials.append(baked)

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.03
scene.render.bake.max_ray_distance = 0.08
scene.render.bake.margin = 8

bpy.ops.object.select_all(action="DESELECT")
high.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low

target.image = color_img
nodes.active = target
scene.cycles.samples = 1
scene.render.bake.use_pass_direct = False
scene.render.bake.use_pass_indirect = False
scene.render.bake.use_pass_color = True
bpy.ops.object.bake(type="DIFFUSE")

target.image = normal_img
scene.cycles.samples = 4
bpy.ops.object.bake(type="NORMAL")

links = baked.node_tree.links
bsdf = nodes["Principled BSDF"]
color_node = nodes.new("ShaderNodeTexImage")
color_node.image = color_img
normal_node = nodes.new("ShaderNodeTexImage")
normal_node.image = normal_img
normal_map = nodes.new("ShaderNodeNormalMap")
links.new(color_node.outputs["Color"], bsdf.inputs["Base Color"])
links.new(normal_node.outputs["Color"], normal_map.inputs["Color"])
links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
bsdf.inputs["Roughness"].default_value = 0.42
nodes.remove(target)

for img, fname in ((color_img, "anglerfish_color.png"), (normal_img, "anglerfish_normal.png")):
    img.filepath_raw = os.path.join("/tmp", fname)
    img.file_format = "PNG"
    img.save()
    img.pack()

bpy.data.objects.remove(high, do_unlink=True)

materials = {
    "Fin": principled("angler_fin", (0.22, 0.2, 0.24), rough=0.45, alpha=0.75),
    "Tooth": principled("angler_tooth", (0.86, 0.83, 0.74), rough=0.25),
    "Eye": principled("angler_eye", (0.02, 0.03, 0.04), rough=0.08),
    "Esca": principled("angler_esca", (0.75, 0.98, 0.95), rough=0.15, emit=(0.55, 1.0, 0.92), strength=6.0),
    "Photophore": principled("angler_photophore", (0.6, 0.95, 1.0), rough=0.2, emit=(0.45, 0.9, 1.0), strength=3.0),
    "Skin": principled("angler_stalk", (0.62, 0.6, 0.55), rough=0.5),
    "MouthInterior": principled("angler_lip", (0.26, 0.12, 0.13), rough=0.5),
}
for o in bpy.data.objects:
    if o.type != "MESH" or o is low:
        continue
    for slot in o.material_slots:
        key = slot.material.name.split(".")[0] if slot.material else "Skin"
        slot.material = materials.get(key, materials["Skin"])
bpy.data.objects["Illicium"].data.materials.clear()
bpy.data.objects["Illicium"].data.materials.append(materials["Skin"])

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True,
                          export_yup=True, export_animations=False, export_image_format="WEBP",
                          export_image_quality=88)
print("exported", OUT, [o.name for o in bpy.data.objects], len(low.data.polygons))
