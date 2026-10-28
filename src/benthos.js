import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spawn } from './assets.js';
import { SHADER_TIME } from './surface.js';
import { fbm, noise3 } from './ice.js';

// The polar seabed: angular slabs of dark slate and broken rubble on the mud, some boulders crusted with sea squirts,
// finger sponges and many-armed sun stars, and among them brittle stars in crowds, sea urchins, sea stars, anemones
// and, in the south, great glass sponges and lumpy yellow sponges. Each kind is one instanced mesh; the stars' arms
// writhe and the anemones' tentacles sway.
const CELL = 6;
// How far either side of the camera the seabed is stocked.
const REACH = 45;
const Z_RANGE = [-24, 6];
// Boulders keep out of the sub's lane, where it skims the seabed.
const ROCK_Z = [-45, -3];

const hash = (n, k) => {
  const s = Math.sin(n * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// A tube along a path, `radius(t)` thick and coloured `color(t, angle)`, closed off at its far end.
function tube(path, radius, radial, color, extra) {
  const n = path.length;
  const pos = [];
  const col = [];
  const tag = [];
  const idx = [];
  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const side = new THREE.Vector3();
  const d = new THREE.Vector3();
  tangent.subVectors(path[1], path[0]).normalize();
  normal.set(0, 1, 0);
  if (Math.abs(tangent.y) > 0.9) normal.set(1, 0, 0);
  normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    tangent.subVectors(path[Math.min(n - 1, i + 1)], path[Math.max(0, i - 1)]).normalize();
    normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    side.crossVectors(tangent, normal);
    const r = radius(t);
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      d.copy(normal).multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
      pos.push(path[i].x + d.x * r, path[i].y + d.y * r, path[i].z + d.z * r);
      col.push(...color(t, a));
      tag.push(...extra(t));
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j;
      const b = i * radial + ((j + 1) % radial);
      idx.push(a, a + radial, b, b, a + radial, b + radial);
    }
  }
  const tip = path[n - 1].clone().addScaledVector(tangent, radius(1));
  const tipIndex = n * radial;
  pos.push(tip.x, tip.y, tip.z);
  col.push(...color(1, 0));
  tag.push(...extra(1));
  for (let j = 0; j < radial; j++) idx.push((n - 1) * radial + j, tipIndex, (n - 1) * radial + ((j + 1) % radial));
  return built(pos, col, tag, idx);
}

function built(pos, col, tag, idx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aTag', new THREE.Float32BufferAttribute(tag, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// A solid of revolution from (radius, height) pairs, coloured by height, smooth all the way round.
function lathe(points, segments, color, tag = () => [0, 0, 0, 0]) {
  const geo = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo);
  const pos = merged.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const tags = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    col.set(color(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
    tags.set(tag(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 4);
  }
  merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
  merged.setAttribute('aTag', new THREE.BufferAttribute(tags, 4));
  merged.computeVertexNormals();
  return merged;
}

// Push every vertex out along its normal by `amount(x, y, z)`, then reshade.
function displace(geo, amount) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const k = amount(pos.getX(i), pos.getY(i), pos.getZ(i));
    pos.setXYZ(i, pos.getX(i) + nor.getX(i) * k, pos.getY(i) + nor.getY(i) * k, pos.getZ(i) + nor.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return geo;
}

const mix3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// A brittle star: a small five-sided disc with five long, thin, banded arms snaking out over the mud. Each arm vertex
// carries how far out along the arm it is, which arm, and the arm's sideways direction, so the arms can writhe.
function brittleStar(seed, colors, { arms = 5, length: reachOut = 0.62, thick = 0.024, disc: discR = 0.1 } = {}) {
  const parts = [];
  const disc = new THREE.SphereGeometry(discR, 22, 10);
  disc.deleteAttribute('uv');
  const dp = disc.attributes.position;
  for (let i = 0; i < dp.count; i++) {
    const x = dp.getX(i);
    const z = dp.getZ(i);
    const a = Math.atan2(z, x);
    const lobe = 1 + 0.12 * Math.cos(a * arms);
    dp.setXYZ(i, x * lobe, Math.max(dp.getY(i), -0.02) * 0.4 + 0.035, z * lobe);
  }
  const discGeo = mergeVertices(disc);
  discGeo.deleteAttribute('normal');
  discGeo.computeVertexNormals();
  const dc = new Float32Array(discGeo.attributes.position.count * 3);
  for (let i = 0; i < discGeo.attributes.position.count; i++) {
    const p = discGeo.attributes.position;
    const rays = 0.5 + 0.5 * Math.cos(Math.atan2(p.getZ(i), p.getX(i)) * arms);
    dc.set(mix3(colors.dark, colors.pale, rays * 0.6), i * 3);
  }
  discGeo.setAttribute('color', new THREE.BufferAttribute(dc, 3));
  discGeo.setAttribute('aTag', new THREE.BufferAttribute(new Float32Array(discGeo.attributes.position.count * 4), 4));
  parts.push(discGeo);
  for (let k = 0; k < arms; k++) {
    const base = (k / arms) * Math.PI * 2 + (hash(seed, k) - 0.5) * 0.2;
    const length = reachOut + hash(seed, k + 10) * 0.2;
    const curl = (hash(seed, k + 20) - 0.5) * 2.2;
    const wave = hash(seed, k + 30) * 6.3;
    const path = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const a = base + curl * t * t + 0.25 * Math.sin(t * 7 + wave) * t;
      const r = discR * 0.7 + length * t;
      path.push(new THREE.Vector3(Math.cos(a) * r, 0.03 + 0.05 * Math.sin(Math.min(1, t * 2.2) * Math.PI) * (1 - t * 0.5), Math.sin(a) * r));
    }
    const sideX = -Math.sin(base);
    const sideZ = Math.cos(base);
    parts.push(tube(path, (t) => thick * (1 - t) ** 0.8 + 0.004, 5,
      (t) => mix3(colors.dark, colors.pale, (0.5 + 0.5 * Math.sin(t * 70)) ** 3 * 0.8),
      (t) => [t, k, sideX, sideZ]));
  }
  return mergeGeometries(parts);
}

// A slab of slate broken off along flat fracture planes, its edges worn round, faintly layered, dark grey-green with
// a thin film of growth on whatever faces up. Returns the geometry and the height of its top over a grid, for
// setting things on it.
function slate(seed, detail) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const merged = mergeVertices(geo);
  const pos = merged.attributes.position;
  const sx = 1.1 + hash(seed, 1) * 0.6;
  const sy = 0.45 + hash(seed, 2) * 0.35;
  const sz = 0.75 + hash(seed, 3) * 0.4;
  const planes = Array.from({ length: 12 }, (_, k) => {
    const a = hash(seed, 10 + k) * Math.PI * 2;
    const up = (hash(seed, 20 + k) - 0.3) * 1.4;
    const n = new THREE.Vector3(Math.cos(a), up, Math.sin(a)).normalize();
    return { n, d: 0.45 + hash(seed, 30 + k) * 0.3 };
  });
  const bed = new THREE.Vector3(hash(seed, 40) - 0.5, 3, hash(seed, 41) - 0.5).normalize();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    for (const { n, d } of planes) {
      const over = v.dot(n) - d;
      if (over > 0) v.addScaledVector(n, -over);
    }
    v.multiplyScalar(1 + fbm(v.x * 2 + seed, v.y * 2, v.z * 2) * 0.04 + noise3(v.x * 14, v.y * 14 + seed, v.z * 14) * 0.012);
    v.addScaledVector(bed, Math.sin(v.dot(bed) * 26) * 0.01);
    v.set(v.x * sx, Math.max(v.y * sy, -0.25 * sy), v.z * sz);
    pos.setXYZ(i, v.x, v.y + 0.25 * sy, v.z);
  }
  merged.computeVertexNormals();
  const nor = merged.attributes.normal;
  paint(merged, (x, y, z) => {
    const tone = 0.7 + 0.6 * (0.5 + noise3(x * 3 + seed, y * 3, z * 3));
    return [0.055 * tone, 0.075 * tone, 0.08 * tone];
  });
  const col = merged.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const film = THREE.MathUtils.smoothstep(nor.getY(i), 0.4, 0.9) * (0.5 + noise3(pos.getX(i) * 4, seed, pos.getZ(i) * 4));
    col.setXYZ(i, ...mix3([col.getX(i), col.getY(i), col.getZ(i)], [0.08, 0.14, 0.1], THREE.MathUtils.clamp(film, 0, 0.7)));
  }
  merged.computeBoundingBox();
  const box = merged.boundingBox;
  const mesh = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster();
  const N = 9;
  const tops = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = THREE.MathUtils.lerp(box.min.x, box.max.x, (i + 0.5) / N) * 0.85;
      const z = THREE.MathUtils.lerp(box.min.z, box.max.z, (j + 0.5) / N) * 0.85;
      ray.set(new THREE.Vector3(x, box.max.y + 1, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (hit && hit.face.normal.y > 0.55) tops.push([x, hit.point.y, z]);
    }
  }
  return { geometry: merged, tops };
}

// A clump of sea squirts: soft olive-green barrels standing together, each with two short siphons gaping at its top.
function seaSquirts(seed) {
  const parts = [];
  const count = 7 + Math.floor(hash(seed, 1) * 6);
  for (let i = 0; i < count; i++) {
    const a = hash(seed, 10 + i) * Math.PI * 2;
    const d = Math.sqrt(hash(seed, 20 + i)) * 0.28;
    const h = 0.22 + hash(seed, 30 + i) * 0.16;
    const w = 0.07 + hash(seed, 40 + i) * 0.03;
    const shade = 0.8 + hash(seed, 50 + i) * 0.4;
    const body = lathe([[0.001, 0], [w * 0.7, 0], [w * 1.15, h * 0.35], [w * 1.05, h * 0.75], [w * 0.7, h * 0.95],
      [w * 0.35, h], [0.001, h * 0.98]], 20, (x, y, z) => {
      const stripe = 0.85 + 0.15 * Math.sin(Math.atan2(z, x) * 7 + y * 20);
      return mix3([0.2, 0.32, 0.14], [0.5, 0.62, 0.32], y / h).map((c) => c * shade * stripe);
    });
    const tilt = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler((hash(seed, 60 + i) - 0.5) * 0.4, 0,
      (hash(seed, 70 + i) - 0.5) * 0.4));
    body.applyMatrix4(tilt);
    for (const side of [-1, 1]) {
      const start = new THREE.Vector3(side * w * 0.35, h * 0.97, 0).applyMatrix4(tilt);
      const dir = new THREE.Vector3(side * 0.5, 1, 0).transformDirection(tilt);
      const path = [0, 1, 2, 3].map((k) => start.clone().addScaledVector(dir, k * 0.022));
      parts.push(tube(path, (t) => w * (0.32 - t * 0.06), 8, () => [0.62 * shade, 0.66 * shade, 0.36 * shade],
        () => [0, 0, 0, 0]).translate(Math.cos(a) * d, 0, Math.sin(a) * d));
    }
    parts.push(body.translate(Math.cos(a) * d, 0, Math.sin(a) * d));
  }
  return mergeGeometries(parts);
}

// A finger sponge: a knobbly mound bunched into rounded lobes, like a cauliflower, pocked with tiny pores.
function fingerSponge(seed, color) {
  const geo = new THREE.SphereGeometry(0.3, 48, 32);
  geo.deleteAttribute('uv');
  const merged = mergeVertices(geo);
  merged.deleteAttribute('normal');
  const lobes = Array.from({ length: 11 }, (_, k) => {
    const a = hash(seed, k) * Math.PI * 2;
    const up = 0.15 + hash(seed, k + 20) * 0.85;
    return { c: new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - up * up), up, Math.sin(a) * Math.sqrt(1 - up * up)),
      size: 0.25 + hash(seed, k + 40) * 0.35 };
  });
  const pos = merged.attributes.position;
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    let r = 0.8;
    for (const { c, size } of lobes) r += size * Math.exp(-(1 - d.dot(c)) * 9);
    r += fbm(d.x * 4 + seed, d.y * 4, d.z * 4) * 0.12;
    pos.setXYZ(i, d.x * r * 0.3, Math.max(-0.02, d.y * r * 0.3 * 1.15) + 0.02, d.z * r * 0.3);
  }
  merged.computeVertexNormals();
  paint(merged, (x, y, z) => {
    const pore = noise3(x * 60, y * 60 + seed, z * 60) > 0.38 ? 0.7 : 1;
    return color.map((c) => c * pore * (0.82 + 0.3 * (0.5 + noise3(x * 8, y * 8, z * 8 + seed))));
  });
  return displace(merged, (x, y, z) => noise3(x * 30 + seed, y * 30, z * 30) * 0.006);
}

// A sea urchin: a flattened round test bristling with spines, which thin out toward its underside.
function urchin(colors) {
  const body = new THREE.SphereGeometry(0.2, 28, 18);
  body.deleteAttribute('uv');
  body.scale(1, 0.62, 1);
  body.translate(0, 0.11, 0);
  const bodyGeo = mergeVertices(body);
  bodyGeo.deleteAttribute('normal');
  bodyGeo.computeVertexNormals();
  const parts = [paint(bodyGeo, () => colors.body)];
  const count = 170;
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 1.6;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const a = i * 2.39996;
    const dir = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
    const at = new THREE.Vector3(dir.x * 0.19, dir.y * 0.115 + 0.11, dir.z * 0.19);
    dir.x += (hash(i, 1) - 0.5) * 0.3;
    dir.z += (hash(i, 2) - 0.5) * 0.3;
    dir.normalize();
    const length = 0.17 + hash(i, 3) * 0.12;
    const spine = new THREE.ConeGeometry(0.011, length, 5, 1, true);
    spine.deleteAttribute('uv');
    spine.translate(0, length / 2, 0);
    spine.applyQuaternion(q.setFromUnitVectors(up, dir));
    spine.translate(at.x, at.y, at.z);
    const sp = spine.attributes.position;
    const sc = new Float32Array(sp.count * 3);
    for (let v = 0; v < sp.count; v++) {
      const t = Math.min(1, Math.hypot(sp.getX(v) - at.x, sp.getY(v) - at.y, sp.getZ(v) - at.z) / length);
      sc.set(mix3(colors.spine, colors.tip, t * t), v * 3);
    }
    spine.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    spine.setAttribute('aTag', new THREE.BufferAttribute(new Float32Array(sp.count * 4), 4));
    parts.push(spine);
  }
  return mergeGeometries(parts);
}

function paint(geo, color) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) col.set(color(pos.getX(i), pos.getY(i), pos.getZ(i)), i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aTag', new THREE.BufferAttribute(new Float32Array(pos.count * 4), 4));
  return geo;
}

// A glass sponge: a barrel or vase of woven silica, open at the top, its wall knobbly and furred with spicules,
// pale outside and shadowed within.
function glassSponge(height, radius, wall, colors, seed, lean) {
  const pts = [[0.001, 0]];
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const v = i / steps;
    pts.push([radius(v), v * height]);
  }
  const rim = radius(1);
  pts.push([rim - wall * 0.5, height + wall * 0.45], [rim - wall, height]);
  for (let i = steps; i >= Math.round(steps * 0.3); i--) {
    const v = i / steps;
    pts.push([Math.max(0.02, radius(v) - wall), v * height]);
  }
  pts.push([0.001, height * 0.3 - 0.02]);
  const geo = lathe(pts, 64, (x, y, z) => {
    const inner = Math.hypot(x, z) < radius(Math.min(1, y / height)) - wall * 0.5 && y > height * 0.25;
    const shade = 0.72 + 0.42 * (0.5 + noise3(x * 5 + seed, y * 3, z * 5));
    const pore = noise3(x * 34, y * 34 + seed, z * 34) > 0.3 ? 0.72 : 1;
    return (inner ? colors.inner : colors.outer).map((c) => c * shade * pore);
  });
  // Swollen into lobes here and there, furred with spicules, and leaning as it grew.
  displace(geo, (x, y, z) => (fbm(x * 1.6 + seed, y * 1.2, z * 1.6) * 0.16 + noise3(x * 26, y * 26 + seed, z * 26) * 0.018)
    * Math.min(1, y * 4));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / height;
    pos.setX(i, pos.getX(i) + lean * t * t * height);
  }
  geo.computeVertexNormals();
  return geo;
}

// A lumpy cushion of sponge, pocked with a few vents.
function lumpSponge(colors, seed) {
  const geo = new THREE.SphereGeometry(0.4, 56, 36);
  geo.deleteAttribute('uv');
  const merged = mergeVertices(geo);
  merged.deleteAttribute('normal');
  const pos = merged.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 1 + fbm(x * 2.5 + seed, y * 2.5, z * 2.5) * 0.55;
    pos.setXYZ(i, x * k * 1.2, Math.max(0, (y + 0.12) * k * 0.75), z * k);
  }
  merged.computeVertexNormals();
  paint(merged, (x, y, z) => {
    const pore = noise3(x * 14, y * 14 + seed, z * 14) > 0.42 ? 0.55 : 1;
    return colors.body.map((c) => c * pore * (0.85 + 0.25 * noise3(x * 5, y * 5, z * 5 + seed)));
  });
  return displace(merged, (x, y, z) => (y > 0.01 ? noise3(x * 18 + seed, y * 18, z * 18) * 0.015 : 0));
}

// An anemone: a stout column on a broad foot, crowned with rings of tapering tentacles that curl outward. Tentacle
// vertices carry how far out along the tentacle they are, so the crown can sway.
function anemone(colors, seed) {
  const column = lathe([[0.001, 0], [0.22, 0], [0.2, 0.03], [0.15, 0.1], [0.14, 0.2], [0.17, 0.3], [0.2, 0.33],
    [0.12, 0.35], [0.001, 0.33]], 48, (x, y) => (y > 0.32 ? colors.disc : mix3(colors.column, colors.disc, y * 1.2)));
  displace(column, (x, y, z) => noise3(x * 16 + seed, y * 16, z * 16) * 0.01);
  const parts = [column];
  const rings = [[12, 0.18, 0.34, 0.25], [14, 0.135, 0.28, 0.55], [16, 0.085, 0.2, 0.85]];
  rings.forEach(([count, ringR, length, rise], ring) => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + ring * 0.4 + (hash(seed + ring, i) - 0.5) * 0.15;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const len = length * (0.85 + hash(seed, i + ring * 40) * 0.3);
      const path = [];
      const p = new THREE.Vector3(Math.cos(a) * ringR, 0.34, Math.sin(a) * ringR);
      for (let k = 0; k <= 8; k++) {
        const t = k / 8;
        path.push(p.clone());
        const e = (rise + 0.35) * (1 - t) * Math.PI / 2 - 0.25 * t;
        p.addScaledVector(out, Math.cos(e) * len / 8).y += Math.sin(e) * len / 8;
      }
      parts.push(tube(path, (t) => 0.02 * (1 - t * 0.65), 5, (t) => mix3(colors.tentacle, colors.tip, t * t),
        (t) => [t, 0, 0, 0]));
    }
  });
  return mergeGeometries(parts);
}

// A sea star from the starfish model, smooth all over, in its own colour.
function modelGeometry(name) {
  const model = spawn(name);
  model.updateMatrixWorld(true);
  const found = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    let geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
    geo.deleteAttribute('normal');
    geo = mergeVertices(geo);
    geo.computeVertexNormals();
    found.push({ geo, material: o.material.clone() });
  });
  return found;
}

function animate(material, kind) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = SHADER_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec4 aTag;')
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vec3 where = vec3( instanceMatrix[ 3 ] );
        float phase = where.x * 1.7 + where.z * 2.3;
        ${kind === 'brittle' ? /* glsl */ `
        // Each arm sweeps slowly from side to side, more toward its tip.
        float sweep = sin( uTime * 0.7 + aTag.y * 1.9 + phase ) * 0.6 + sin( uTime * 1.3 + aTag.y * 2.7 + phase ) * 0.4;
        transformed.xz += aTag.zw * sweep * aTag.x * aTag.x * 0.09;
        transformed.y += max( 0.0, sweep ) * aTag.x * aTag.x * 0.03;` : /* glsl */ `
        // The crown sways in the current, the tentacle tips most.
        float sway = aTag.x * aTag.x;
        transformed.x += sin( uTime * 1.1 + phase + position.y * 3.0 ) * sway * 0.05;
        transformed.z += cos( uTime * 0.8 + phase * 1.3 ) * sway * 0.04;`}`);
  };
  material.customProgramCacheKey = () => `benthos-${kind}`;
}

function vertexMaterial(roughness, kind) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  if (kind) animate(m, kind);
  return m;
}

export class Benthos {
  // `ground(x, z)` is the seabed's height; `where(x)` is 'north' or 'south' over a polar shelf's floor, else null.
  constructor(scene, ground, where) {
    this.ground = ground;
    this.where = where;
    const kinds = [];
    const add = (name, geometry, material, capacity, opts = {}) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.frustumCulled = false;
      mesh.castShadow = !!opts.shadow;
      mesh.receiveShadow = true;
      scene.add(mesh);
      kinds.push({ name, mesh, capacity, ...opts });
    };
    const brittle = vertexMaterial(0.75, 'brittle');
    add('brittleA', brittleStar(1, { dark: [0.22, 0.19, 0.16], pale: [0.62, 0.55, 0.46] }), brittle, 160);
    add('brittleB', brittleStar(2, { dark: [0.3, 0.2, 0.15], pale: [0.7, 0.58, 0.44] }), brittle, 160);
    const spiny = vertexMaterial(0.55);
    add('urchinSouth', urchin({ body: [0.16, 0.05, 0.1], spine: [0.32, 0.1, 0.2], tip: [0.62, 0.38, 0.48] }), spiny, 60);
    add('urchinNorth', urchin({ body: [0.15, 0.18, 0.08], spine: [0.28, 0.36, 0.14], tip: [0.55, 0.6, 0.35] }), spiny, 60);
    const sponge = vertexMaterial(0.92);
    add('barrel', glassSponge(1.3, (v) => 0.3 + 0.13 * Math.sin(v * Math.PI) - 0.04 * v, 0.07,
      { outer: [0.68, 0.62, 0.44], inner: [0.26, 0.23, 0.15] }, 3, 0.12), sponge, 40, { shadow: true, upright: true });
    add('vase', glassSponge(1.9, (v) => 0.16 + 0.26 * v ** 1.6, 0.06,
      { outer: [0.72, 0.68, 0.55], inner: [0.3, 0.28, 0.22] }, 7, -0.18), sponge, 40, { shadow: true, upright: true });
    add('lump', lumpSponge({ body: [0.86, 0.66, 0.16] }, 11), sponge, 40, { shadow: true, upright: true });
    const anemoneMat = vertexMaterial(0.6, 'anemone');
    add('anemoneRed', anemone({ column: [0.55, 0.14, 0.1], disc: [0.75, 0.32, 0.22], tentacle: [0.86, 0.55, 0.5],
      tip: [0.95, 0.85, 0.8] }, 5), anemoneMat, 60, { shadow: true, upright: true });
    add('anemoneWhite', anemone({ column: [0.78, 0.74, 0.68], disc: [0.85, 0.8, 0.74], tentacle: [0.9, 0.86, 0.82],
      tip: [0.97, 0.95, 0.92] }, 9), anemoneMat, 60, { shadow: true, upright: true });
    const stone = vertexMaterial(0.85);
    this.tops = new Map();
    for (let i = 0; i < 4; i++) {
      const rock = slate(100 + i, 4);
      add(`boulder${i}`, rock.geometry, stone, 50, { shadow: true, upright: true });
      this.tops.set(`boulder${i}`, rock.tops);
    }
    for (let i = 0; i < 3; i++) add(`rubble${i}`, slate(200 + i, 2).geometry, stone, 160, { upright: true });
    const soft = vertexMaterial(0.7);
    add('squirtsA', seaSquirts(1), soft, 24, { upright: true });
    add('squirtsB', seaSquirts(2), soft, 24, { upright: true });
    add('fingerWhite', fingerSponge(3, [0.88, 0.86, 0.74]), sponge, 40, { upright: true });
    add('fingerYellow', fingerSponge(4, [0.9, 0.8, 0.42]), sponge, 40, { upright: true });
    add('sunstar', brittleStar(5, { dark: [0.75, 0.32, 0.08], pale: [0.95, 0.62, 0.25] },
      { arms: 13, length: 0.42, thick: 0.034, disc: 0.17 }), brittle, 60);
    for (const { geo, material } of modelGeometry('starfish')) {
      material.color.multiply(new THREE.Color(1, 0.42, 0.32));
      add('star', geo, material, 50);
    }
    this.kinds = kinds;
    this.byName = new Map();
    for (const k of kinds) {
      if (!this.byName.has(k.name)) this.byName.set(k.name, []);
      this.byName.get(k.name).push(k);
      k.mesh.count = k.capacity;
    }
    this.warmers = kinds.map((k) => k.mesh);
    this.window = null;
    this.matrix = new THREE.Matrix4();
    this.quat = new THREE.Quaternion();
    this.tilt = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.normal = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.scale = new THREE.Vector3();
  }

  update(cx) {
    const first = Math.floor((cx - REACH) / CELL);
    const last = Math.ceil((cx + REACH) / CELL);
    const key = `${first},${last}`;
    if (key === this.window) return;
    this.window = key;
    const used = new Map(this.kinds.map((k) => [k, 0]));
    for (let c = first; c <= last; c++) this.stock(c, used);
    for (const k of this.kinds) {
      k.mesh.count = used.get(k);
      k.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // The same creatures in the same places every time a stretch of seabed comes back into view.
  stock(c, used) {
    const x0 = c * CELL;
    const sea = this.where(x0 + CELL / 2);
    if (!sea) return;
    const south = sea === 'south';
    let k = 0;
    const r = () => hash(c, k++);
    // `at` sets a place and height on something other than the mud.
    const put = (name, size, sink = 0, zRange = Z_RANGE, at = null) => {
      const x = at ? at.x : x0 + r() * CELL;
      const z = at ? at.z : zRange[0] + r() * (zRange[1] - zRange[0]);
      const kinds = this.byName.get(name);
      const yaw = r() * Math.PI * 2;
      const s = size[0] + r() * (size[1] - size[0]);
      const y = at ? at.y : this.ground(x, z);
      for (const kind of kinds) {
        const n = used.get(kind);
        if (n >= kind.capacity) continue;
        used.set(kind, n + 1);
        this.quat.setFromAxisAngle(this.up, yaw);
        if (!kind.upright && !at) {
          // Things lying flat follow the slope of the mud under them.
          const e = 0.3;
          this.normal.set(this.ground(x - e, z) - this.ground(x + e, z), 2 * e, this.ground(x, z - e) - this.ground(x, z + e))
            .normalize();
          this.quat.premultiply(this.tilt.setFromUnitVectors(this.up, this.normal));
        }
        this.matrix.compose(this.pos.set(x, y - sink * s, z), this.quat, this.scale.setScalar(s));
        kind.mesh.setMatrixAt(n, this.matrix);
      }
      return { x, y: y - sink * s, z, yaw, s };
    };
    // A boulder with life growing over its top: squirts, sponges and sun stars set on its upper faces.
    const outcrop = () => {
      const name = `boulder${Math.floor(r() * 4)}`;
      const rock = put(name, [1.6, 2.6], 0.12, [-30, -6]);
      const tops = this.tops.get(name);
      if (!tops.length) return;
      const cos = Math.cos(rock.yaw);
      const sin = Math.sin(rock.yaw);
      const spot = () => {
        const [lx, ly, lz] = tops[Math.floor(r() * tops.length)];
        return { x: rock.x + (lx * cos + lz * sin) * rock.s, y: rock.y + ly * rock.s, z: rock.z + (-lx * sin + lz * cos) * rock.s };
      };
      put(r() < 0.5 ? 'squirtsA' : 'squirtsB', [1.2, 1.8], 0.02, Z_RANGE, spot());
      for (let i = 0; i < 1 + Math.floor(r() * 2); i++) put(r() < 0.5 ? 'fingerWhite' : 'fingerYellow', [0.7, 1.2], 0.03, Z_RANGE, spot());
      for (let i = 0; i < 1 + Math.floor(r() * 3); i++) put('sunstar', [0.8, 1.2], 0, Z_RANGE, spot());
      if (r() < 0.4) put(r() < 0.5 ? 'anemoneRed' : 'anemoneWhite', [1, 1.5], 0.02, Z_RANGE, spot());
    };
    for (let i = 0; i < 1 + Math.floor(r() * 3); i++) put(`boulder${Math.floor(r() * 4)}`, [0.5, 2], 0.1, ROCK_Z);
    for (let i = 0; i < 8 + Math.floor(r() * 8); i++) put(`rubble${Math.floor(r() * 3)}`, [0.1, 0.35], 0.15);
    if (r() < 0.45) outcrop();
    if (r() < 0.25) put('sunstar', [0.8, 1.2]);
    const crowd = (south ? 4 : 6) + Math.floor(r() * 5);
    for (let i = 0; i < crowd; i++) put(r() < 0.5 ? 'brittleA' : 'brittleB', [0.9, 1.4]);
    for (let i = 0; i < 1 + Math.floor(r() * 3); i++) put(south ? 'urchinSouth' : 'urchinNorth', [1.1, 1.7], 0.02);
    for (let i = 0; i < Math.floor(r() * 3); i++) put('star', [0.55, 0.85]);
    if (r() < 0.6) put(r() < 0.5 ? 'anemoneRed' : 'anemoneWhite', [1.2, 2], 0.03);
    if (south) {
      if (r() < 0.45) put(r() < 0.5 ? 'barrel' : 'vase', [0.9, 1.7], 0.05);
      if (r() < 0.3) put('lump', [0.8, 1.4], 0.05);
    }
  }
}
