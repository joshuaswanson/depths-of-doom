import math

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

IDENTITY = Matrix.Identity(4)
_materials = {}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    r, g, b = (srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))
    return (r, g, b, alpha)


def mat(name, color, rough=0.45, metal=0.0, emit=0.0, emit_color=None, alpha=1.0):
    if name in _materials:
        return _materials[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    rgba = hex_rgba(color)
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = hex_rgba(emit_color or color)
        bsdf.inputs["Emission Strength"].default_value = emit
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        for attr, value in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, value)
            except (AttributeError, TypeError):
                pass
    m.diffuse_color = rgba
    _materials[name] = m
    return m


def trs(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    return Matrix.LocRotScale(Vector(loc), Euler(rot), Vector(scale))


def frame(origin, normal, up=(0, 0, 1)):
    """Matrix whose +Z points along `normal` and whose +Y leans toward `up`."""
    z = Vector(normal).normalized()
    y = Vector(up) - z * z.dot(Vector(up))
    if y.length < 1e-5:
        y = z.orthogonal()
    y.normalize()
    x = y.cross(z)
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = Vector(origin)
    return m


def superellipse_profile(length, radius, p_front=2.5, p_back=2.5, samples=40, x0=0.0):
    """(h, r) pairs of a rounded capsule along X, tail first."""
    half = length / 2
    pts = []
    for i in range(samples + 1):
        t = -1 + 2 * i / samples
        p = p_front if t > 0 else p_back
        r = radius * max(0.0, 1 - abs(t) ** p) ** (1 / p)
        pts.append((x0 + t * half, r))
    return pts


class Part:
    def __init__(self):
        self.bm = bmesh.new()
        self.mats = []

    def _index(self, material):
        if material not in self.mats:
            self.mats.append(material)
        return self.mats.index(material)

    def _paint(self, faces, material, smooth):
        idx = self._index(material)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    @staticmethod
    def _faces_of(verts):
        return list({f for v in verts for f in v.link_faces})

    def sphere(self, material, loc=(0, 0, 0), scale=1.0, rot=(0, 0, 0), segs=24, rings=14, matrix=None):
        m = matrix if matrix is not None else trs(loc, rot, scale)
        verts = bmesh.ops.create_uvsphere(self.bm, u_segments=segs, v_segments=rings, radius=1.0, matrix=m)["verts"]
        return self._paint(self._faces_of(verts), material, True)

    def box(self, material, loc=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0), bevel=0.04, segs=2, matrix=None):
        m = (matrix if matrix is not None else IDENTITY) @ trs(loc, rot, size)
        verts = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)["verts"]
        faces = self._paint(self._faces_of(verts), material, False)
        if bevel > 0:
            edges = list({e for v in verts for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=edges + list(verts), offset=bevel, offset_type="OFFSET",
                                  segments=segs, profile=0.5, affect="EDGES", clamp_overlap=True)
            self._paint(res["faces"], material, True)
            faces = faces + res["faces"]
        return faces

    def cylinder(self, material, loc=(0, 0, 0), radius=0.5, depth=1.0, radius2=None, rot=(0, 0, 0),
                 segs=24, bevel=0.0, bevel_segs=2, matrix=None, scale=(1, 1, 1)):
        """Cylinder or cone along local Z, centered on `loc`."""
        m = (matrix if matrix is not None else IDENTITY) @ trs(loc, rot, scale)
        r2 = radius if radius2 is None else radius2
        verts = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=segs,
                                      radius1=radius, radius2=r2, depth=depth, matrix=m)["verts"]
        faces = self._faces_of(verts)
        caps = [f for f in faces if len(f.verts) == segs]
        sides = [f for f in faces if len(f.verts) != segs]
        self._paint(caps, material, False)
        self._paint(sides, material, True)
        if bevel > 0:
            rim = list({e for f in caps for e in f.edges})
            res = bmesh.ops.bevel(self.bm, geom=rim + list({v for e in rim for v in e.verts}), offset=bevel,
                                  offset_type="OFFSET", segments=bevel_segs, profile=0.5, affect="EDGES",
                                  clamp_overlap=True)
            self._paint(res["faces"], material, True)
            faces = faces + res["faces"]
        return faces

    def lathe(self, material, profile, segs=32, matrix=None, loop=False, smooth=True, sharp=()):
        """Revolve (h, r) points around local X. Points with r == 0 become poles."""
        m = matrix if matrix is not None else IDENTITY
        bm = self.bm
        rings = []
        for h, r in profile:
            if r <= 1e-6:
                rings.append([bm.verts.new(m @ Vector((h, 0, 0)))])
            else:
                rings.append([bm.verts.new(m @ Vector((h, r * math.cos(2 * math.pi * i / segs),
                                                       r * math.sin(2 * math.pi * i / segs))))
                              for i in range(segs)])
        pairs = list(zip(rings, rings[1:]))
        if loop:
            pairs.append((rings[-1], rings[0]))
        faces = []
        for a, b in pairs:
            if len(a) == 1 and len(b) == 1:
                continue
            for i in range(segs):
                j = (i + 1) % segs
                if len(a) == 1:
                    faces.append(bm.faces.new((a[0], b[j], b[i])))
                elif len(b) == 1:
                    faces.append(bm.faces.new((a[i], a[j], b[0])))
                else:
                    faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
        caps = []
        if not loop:
            if len(rings[0]) > 1:
                caps.append(bm.faces.new(list(reversed(rings[0]))))
            if len(rings[-1]) > 1:
                caps.append(bm.faces.new(rings[-1]))
        bmesh.ops.recalc_face_normals(bm, faces=faces + caps)
        self._paint(faces, material, smooth)
        self._paint(caps, material, False)
        for k in sharp:
            ring = rings[k]
            for i in range(len(ring)):
                e = bm.edges.get((ring[i], ring[(i + 1) % len(ring)]))
                if e:
                    e.smooth = False
        return faces + caps

    def tube(self, material, points, radius=0.05, segs=12, loop=False, caps=True, matrix=None):
        """Sweep a circle along a polyline. `radius` may be a number or a function of t in [0, 1]."""
        m = matrix if matrix is not None else IDENTITY
        pts = [Vector(p) for p in points]
        n = len(pts)
        tangents = []
        for i in range(n):
            if loop:
                t = pts[(i + 1) % n] - pts[i - 1]
            else:
                t = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
            tangents.append(t.normalized())
        normal = tangents[0].orthogonal().normalized()
        bm = self.bm
        rings = []
        for i, (p, t) in enumerate(zip(pts, tangents)):
            if i > 0:
                normal = tangents[i - 1].rotation_difference(t) @ normal
                normal = (normal - t * normal.dot(t)).normalized()
            binormal = t.cross(normal)
            r = radius(i / max(n - 1, 1)) if callable(radius) else radius
            rings.append([bm.verts.new(m @ (p + (normal * math.cos(a) + binormal * math.sin(a)) * r))
                          for a in (2 * math.pi * k / segs for k in range(segs))])
        pairs = list(zip(rings, rings[1:]))
        if loop:
            pairs.append((rings[-1], rings[0]))
        faces = [bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
                 for a, b in pairs for k in range(segs)]
        end_caps = []
        if caps and not loop:
            end_caps = [bm.faces.new(list(reversed(rings[0]))), bm.faces.new(rings[-1])]
        bmesh.ops.recalc_face_normals(bm, faces=faces + end_caps)
        self._paint(faces, material, True)
        self._paint(end_caps, material, False)
        return faces + end_caps

    def torus(self, material, loc=(0, 0, 0), major=0.5, minor=0.1, rot=(0, 0, 0), segs=32, tube_segs=12,
              scale=(1, 1, 1), matrix=None):
        m = (matrix if matrix is not None else IDENTITY) @ trs(loc, rot, scale)
        circle = [(major * math.cos(2 * math.pi * i / segs), major * math.sin(2 * math.pi * i / segs), 0)
                  for i in range(segs)]
        return self.tube(material, circle, minor, tube_segs, loop=True, matrix=m)

    def extrude(self, material, points2d, depth=0.1, matrix=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1),
                bevel=0.0, bevel_segs=2):
        """Extrude a 2D outline (XY) along Z, centered on z = 0."""
        m = (matrix if matrix is not None else IDENTITY) @ trs(loc, rot, scale)
        bm = self.bm
        lo = [bm.verts.new(m @ Vector((x, y, -depth / 2))) for x, y in points2d]
        hi = [bm.verts.new(m @ Vector((x, y, depth / 2))) for x, y in points2d]
        n = len(points2d)
        caps = [bm.faces.new(list(reversed(lo))), bm.faces.new(hi)]
        sides = [bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i])) for i in range(n)]
        bmesh.ops.recalc_face_normals(bm, faces=caps + sides)
        faces = self._paint(caps + sides, material, False)
        if bevel > 0:
            edges = list({e for f in caps for e in f.edges})
            res = bmesh.ops.bevel(bm, geom=edges + lo + hi, offset=bevel, offset_type="OFFSET",
                                  segments=bevel_segs, profile=0.5, affect="EDGES", clamp_overlap=True)
            self._paint(res["faces"], material, True)
            faces = faces + res["faces"]
        return faces

    def build(self, name, parent=None, location=(0, 0, 0)):
        mesh = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in self.mats:
            mesh.materials.append(material)
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = location
        if parent is not None:
            obj.parent = parent
        return obj


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    if parent is not None:
        obj.parent = parent
    return obj


def descendants(obj):
    out = [obj]
    for child in obj.children:
        out.extend(descendants(child))
    return out


def export_glb(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in descendants(root):
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_apply=True,
                              export_yup=True, export_animations=False, export_vertex_color="ACTIVE",
                              export_active_vertex_color_when_no_material=True)


def bake_ao(root, distance=0.6, samples=48):
    """Bake ambient occlusion into a point color attribute so crevices stay dark in the game."""
    scene = bpy.context.scene
    previous = scene.render.engine
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("bake_world")
    scene.world.light_settings.distance = distance
    meshes = [o for o in descendants(root) if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        attr = obj.data.color_attributes.new("ao", "BYTE_COLOR", "POINT")
        obj.data.color_attributes.active_color = attr
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.bake(type="AO", target="VERTEX_COLORS")
    scene.render.engine = previous


def points_on_arc(radius, start, end, count, center=(0, 0)):
    return [(center[0] + radius * math.cos(start + (end - start) * i / (count - 1)),
             center[1] + radius * math.sin(start + (end - start) * i / (count - 1))) for i in range(count)]
