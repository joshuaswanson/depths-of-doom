"""Render HUD upgrade icons as transparent PNGs.

    blender --background --python blender/render_icons.py
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import assets_parts  # noqa: E402
import assets_player  # noqa: E402
from kit import descendants  # noqa: E402
from palette import palette  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "public", "icons")

ICONS = {
    "hull": (assets_player.player_hull, (0, 0, 0), 40),
    "cannon": (assets_parts.part_cannon, (0, 0, 0), 25),
    "torpedo": (assets_parts.proj_torpedo, (0, -0.6, 0), 10),
    "missile": (assets_parts.proj_player_missile, (0, -0.6, 0), 10),
    "shield": (assets_parts.icon_shield, (0, 0, 0), 15),
    "grapple": (assets_parts.part_grapple, (math.pi, 0, 0), 20),
    "sonar": (assets_parts.icon_sonar, (0, 0, 0), 5),
    "propulsion": (assets_parts.icon_propeller, (0, 0, math.pi / 2), 0),
    "coin": (assets_parts.pickup_coin, (0, 0, 0), 0),
}


def setup():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("icon_world")
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.25, 0.32, 0.4, 1)
    scene.world = world
    for name, energy, color, rot in (("key", 4.0, (1, 0.97, 0.9), (40, -10, -35)),
                                     ("rim", 2.5, (0.6, 0.85, 1.0), (-50, 40, 150))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN"))
        light.data.energy = energy
        light.data.color = color
        light.rotation_euler = tuple(math.radians(a) for a in rot)
        scene.collection.objects.link(light)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def frame_and_render(root, cam, yaw, path):
    bpy.context.view_layer.update()
    y = math.radians(yaw)
    direction = Vector((math.sin(y), -math.cos(y), 0.25)).normalized()
    rot = (-direction).to_track_quat("-Z", "Y")
    cam.rotation_euler = rot.to_euler()
    inv = rot.to_matrix().inverted()
    pts = [inv @ (o.matrix_world @ Vector(c)) for o in descendants(root) if o.type == "MESH" for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    center = rot.to_matrix() @ ((lo + hi) / 2)
    cam.data.ortho_scale = max(hi.x - lo.x, hi.y - lo.y) * 1.12
    cam.location = center + direction * 20
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    P = palette()
    cam = setup()
    os.makedirs(ICON_DIR, exist_ok=True)
    for name, (build, rot, yaw) in ICONS.items():
        root = build(P)
        root.rotation_euler = rot
        frame_and_render(root, cam, yaw, os.path.join(ICON_DIR, f"{name}.png"))
        for obj in descendants(root):
            bpy.data.objects.remove(obj, do_unlink=True)
        print(f"icon {name}")


main()
