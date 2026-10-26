"""Build every game model and export it as GLB.

    blender --background --python blender/build_models.py -- [--only name,name] [--preview DIR] [--no-export]
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from kit import bake_ao, descendants, export_glb  # noqa: E402
from palette import palette  # noqa: E402
import assets_deep  # noqa: E402
import assets_extra  # noqa: E402
import assets_enemies  # noqa: E402
import assets_env  # noqa: E402
import assets_reef  # noqa: E402
import assets_parts  # noqa: E402
import assets_player  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, "models-src")

ASSETS = {
    "player_hull": assets_player.player_hull,
    "player_hull_big": assets_player.player_hull_big,
    **{name: getattr(assets_parts, name) for name in (
        "part_cannon", "part_torpedo", "part_missile", "part_shield", "part_grapple_1", "part_grapple_2", "part_grapple_3",
        "part_grapple_4", "part_sonar", "part_thruster",
        "part_spotlight",
        "junk_crate", "junk_ammo", "junk_toolbox", "junk_canister", "junk_barrel", "junk_duck",
        "proj_torpedo", "proj_missile", "proj_player_missile", "pickup_coin",
    )},
    **{name: getattr(assets_enemies, name) for name in ("enemy_scout", "enemy_gunner", "enemy_boss", "mine")},
    **{name: getattr(assets_env, name) for name in assets_env.ENV_ASSETS},
    **{name: getattr(assets_reef, name) for name in assets_reef.REEF_ASSETS},
    "deep_jelly": assets_deep.deep_jelly,
    "wreck_sub": assets_extra.wreck_sub,
}


AO_DISTANCE = {"kelp": 0.3, "reef": 0.6, "sponge": 0.4, "anemone": 0.3, "wreck": 1.2, "deep": 0.5, "ruin": 0.7, "rock": 1.2, "coral": 0.5, "seaweed": 0.8, "anchor": 1.0, "chain": 0.3, "enemy": 0.8}


# Stacked masonry occludes itself heavily, and branching coral buries its joints inside the next branch; keep
# both from going black.
AO_FLOOR = {"ruin": 0.5, "rock": 0.35, "coral": 0.5, "reef": 0.5, "sponge": 0.5, "anemone": 0.5}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--preview", default="")
    ap.add_argument("--no-export", action="store_true")
    ap.add_argument("--blend", default="")
    ap.add_argument("--no-bake", action="store_true")
    ap.add_argument("--yaw", type=float, default=35)
    ap.add_argument("--hide", default="", help="comma-separated object name prefixes to hide in previews")
    return ap.parse_args(argv)


def world_bounds(root):
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ Vector(c) for o in descendants(root) if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def setup_preview_scene():
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x = 900
    scene.render.resolution_y = 600
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("preview_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.02, 0.12, 0.22, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.world = world

    sun = bpy.data.objects.new("preview_sun", bpy.data.lights.new("preview_sun", "SUN"))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(40), math.radians(-20), math.radians(-30))
    fill = bpy.data.objects.new("preview_fill", bpy.data.lights.new("preview_fill", "SUN"))
    fill.data.energy = 1.2
    fill.data.color = (0.5, 0.8, 1.0)
    fill.rotation_euler = (math.radians(-60), math.radians(30), math.radians(140))
    cam = bpy.data.objects.new("preview_cam", bpy.data.cameras.new("preview_cam"))
    cam.data.lens = 50
    for obj in (sun, fill, cam):
        scene.collection.objects.link(obj)
    scene.camera = cam
    return cam


def render_preview(root, cam, path, yaw=25, pitch=12):
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    lo, hi = world_bounds(root)
    center = (lo + hi) / 2
    size = (hi - lo).length
    y, p = math.radians(yaw), math.radians(pitch)
    direction = Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p)))
    cam.location = center + direction * size * 1.55
    cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    hidden = [o for o in bpy.context.scene.objects if o.type in {"MESH", "EMPTY"} and o not in descendants(root)]
    for o in hidden:
        o.hide_render = True
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in hidden:
        o.hide_render = False


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = palette()
    names = [n for n in args.only.split(",") if n] or list(ASSETS)
    os.makedirs(MODEL_DIR, exist_ok=True)
    cam = setup_preview_scene() if args.preview else None
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
    offset = 0.0
    for name in names:
        root = ASSETS[name](P)
        if not args.no_bake:
            kind = name.split("_")[0]
            bake_ao(root, distance=AO_DISTANCE.get(kind, 0.6), floor=AO_FLOOR.get(kind, 0.0))
        if not args.no_export:
            export_glb(root, os.path.join(MODEL_DIR, f"{name}.glb"))
        if cam:
            hidden = [o for o in descendants(root) for h in args.hide.split(",") if h and o.name.startswith(h)]
            for o in hidden:
                for d in descendants(o):
                    d.hide_render = True
            render_preview(root, cam, os.path.join(args.preview, f"{name}.png"), yaw=-args.yaw if name.startswith("enemy") else args.yaw)
        lo, hi = world_bounds(root)
        root.location.x = offset - lo.x
        offset += (hi.x - lo.x) + 1.0
        print(f"built {name}")
    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=args.blend)


main()
