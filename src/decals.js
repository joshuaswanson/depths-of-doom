import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';

// Spray-painted skull and crossbones: soft overspray edges, speckles, and drips running down from the paint.
function sprayTexture(faded) {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const paint = faded ? 'rgba(225,220,205,0.75)' : 'rgba(222,218,206,1)';
  const shape = (ctx) => {
    ctx.save();
    ctx.translate(S / 2, S / 2);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(-190, -22, 380, 44);
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(sx * 192, sy * 22, 30, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(0, -30, 120, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-70, 40, 140, 80);
    ctx.globalCompositeOperation = 'destination-out';
    for (const ex of [-46, 46]) {
      ctx.beginPath();
      ctx.ellipse(ex, -20, 34, 40, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, 22);
    ctx.lineTo(-16, 54);
    ctx.lineTo(16, 54);
    ctx.closePath();
    ctx.fill();
    for (const tx of [-36, -12, 12, 36]) ctx.fillRect(tx - 4, 84, 8, 40);
    ctx.restore();
  };
  g.fillStyle = faded ? 'rgba(225,220,205,0.25)' : 'rgba(244,242,234,0.35)';
  g.filter = 'blur(10px)';
  shape(g);
  g.filter = 'blur(1.5px)';
  g.fillStyle = paint;
  g.globalCompositeOperation = 'source-over';
  shape(g);
  g.filter = 'none';
  g.fillStyle = paint;
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 150 + Math.random() * 110;
    g.globalAlpha = Math.random() * 0.6;
    g.beginPath();
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, Math.random() * 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (const dx of [-60, -20, 25, 58, -150, 140]) {
    const x = S / 2 + dx + Math.random() * 10;
    const y0 = S / 2 + (Math.abs(dx) > 100 ? 150 : 115);
    const len = 25 + Math.random() * 60;
    g.fillRect(x - 3, y0, 6, len);
    g.beginPath();
    g.arc(x, y0 + len, 5, 0, Math.PI * 2);
    g.fill();
  }
  if (faded) {
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.globalAlpha = Math.random() * 0.8;
      g.beginPath();
      g.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 14, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function paintMaterial(faded) {
  return new THREE.MeshStandardMaterial({
    map: sprayTexture(faded), transparent: true, depthWrite: false, roughness: 0.85, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
}

const ENEMY_PLATES = ['enemy_hull', 'enemy_plate', 'enemy_red'];

// Where each hull gets its skull, in model space: x along the hull, the size of the stencil, and whether it is
// always painted or only on some of the fleet.
const TARGETS = {
  enemy_scout: { x: 0.04, size: 1.25, name: 'skull_mark_optional', hull: 'enemy_scout_body', paintable: ENEMY_PLATES },
  enemy_gunner: { x: 0.07, size: 1.6, name: 'skull_mark_optional', hull: 'enemy_gunner_body', paintable: ENEMY_PLATES },
  enemy_boss: { x: 0.1, size: 2.6, name: 'skull_mark', hull: 'enemy_boss_body', paintable: ENEMY_PLATES },
  wreck_sub: { x: -1.6, size: 2.6, name: 'skull_mark_wreck', hull: 'wreck_front', faded: true,
    paintable: ['wreck_hull', 'rust_patch'] },
};

function meshesUnder(root, prefix, materials) {
  const out = [];
  root.traverse((o) => {
    if (o.isMesh && o.name.startsWith(prefix) && materials.includes(o.material.name)) out.push(o);
  });
  return out;
}

export function addSkullDecals(models) {
  const raycaster = new THREE.Raycaster();
  const materials = { fresh: paintMaterial(false), faded: paintMaterial(true) };
  for (const [name, t] of Object.entries(TARGETS)) {
    const model = models[name];
    if (!model) continue;
    model.updateMatrixWorld(true);
    const meshes = meshesUnder(model, t.hull, t.paintable);
    if (!meshes.length) continue;
    const group = new THREE.Group();
    group.name = t.name;
    for (const side of [1, -1]) {
      raycaster.set(new THREE.Vector3(t.x, 0.12 * t.size, side * 10), new THREE.Vector3(0, 0, -side));
      const hit = raycaster.intersectObjects(meshes, false)[0];
      if (!hit) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      const aim = new THREE.Object3D();
      aim.position.copy(hit.point);
      aim.lookAt(hit.point.clone().add(normal));
      const orientation = aim.rotation.clone();
      const size = new THREE.Vector3(t.size, t.size, t.size * 0.8);
      for (const mesh of meshes) {
        const geo = new DecalGeometry(mesh, hit.point, orientation, size);
        if (!geo.attributes.position.count) continue;
        const decal = new THREE.Mesh(geo, t.faded ? materials.faded : materials.fresh);
        decal.renderOrder = 3;
        group.add(decal);
      }
    }
    const holder = model.children[0] ?? model;
    holder.updateMatrixWorld(true);
    group.applyMatrix4(holder.matrixWorld.clone().invert());
    holder.add(group);
  }
}
