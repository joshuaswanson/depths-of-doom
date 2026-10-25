import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applySurfaceDetail } from './surface.js';
import { addSkullDecals } from './decals.js';

const MODEL_NAMES = [
  'player_hull', 'part_cannon', 'part_torpedo', 'part_missile', 'part_shield', 'part_grapple', 'part_sonar',
  'part_thruster', 'part_spotlight', 'junk_crate', 'junk_ammo', 'junk_toolbox', 'junk_canister', 'junk_barrel', 'junk_duck',
  'proj_torpedo', 'proj_missile', 'proj_player_missile', 'pickup_coin', 'enemy_scout', 'enemy_gunner', 'enemy_boss',
  'mine', 'ruin_pillar_a', 'ruin_pillar_b', 'ruin_arch', 'ruin_wall', 'ruin_pier', 'ruin_tower', 'anchor', 'chain',
  'seaweed_a', 'seaweed_b', 'coral_pink', 'coral_orange', 'coral_brain', 'rock_a', 'rock_b', 'deep_jelly',
  'anglerfish', 'wreck_sub',
];

const models = {};

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(MODEL_NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
    gltf.scene.traverse((o) => {
      if (o.isMesh) o.material.envMapIntensity = 0.55;
    });
    applySurfaceDetail(gltf.scene);
    models[name] = gltf.scene;
    onProgress?.(++done / MODEL_NAMES.length);
  }));
  addSkullDecals(models);
  for (const model of Object.values(models)) mergeStatic(model);
}

// Nodes the game moves, swaps, or toggles on their own; everything else in a model is rigid and gets merged.
const MOVING = /^(propeller|thruster_prop|sonar_dish|grapple_arm|grapple_claw|cannon_barrels|jaw|lure|wing_|wings_folded|skull_mark|muzzle|lens|jelly_bell|spotlight_head)/;

// Merge each rigid group of meshes into one mesh per material, cutting draw calls from dozens per model to a few.
function mergeStatic(root) {
  const groups = [root];
  root.traverse((o) => {
    if (o !== root && MOVING.test(o.name)) groups.push(o);
  });
  root.updateMatrixWorld(true);
  for (const group of groups) {
    const toLocal = group.matrixWorld.clone().invert();
    const buckets = new Map();
    const collect = (node) => {
      for (const child of node.children) {
        if (MOVING.test(child.name)) continue;
        if (child.isMesh) {
          const attrs = Object.keys(child.geometry.attributes).sort().join(',');
          const key = `${child.material.uuid}|${attrs}|${child.renderOrder}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(child);
        }
        collect(child);
      }
    };
    collect(group);
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geos = meshes.map((m) => m.geometry.clone().applyMatrix4(toLocal.clone().multiply(m.matrixWorld)));
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, meshes[0].material);
      mesh.name = meshes[0].name;
      mesh.renderOrder = meshes[0].renderOrder;
      group.add(mesh);
      for (const m of meshes) {
        for (const child of [...m.children]) m.parent.attach(child);
        m.removeFromParent();
      }
    }
  }
}

// Compile every model's shaders up front so the first enemy or upgrade of each kind doesn't stall a frame.
export async function warmUp(renderer, scene, camera) {
  const holder = new THREE.Group();
  for (const name of MODEL_NAMES) holder.add(spawn(name));
  holder.position.set(0, 0, -5);
  scene.add(holder);
  await renderer.compileAsync(scene, camera);
  scene.remove(holder);
}

export function spawn(name) {
  return models[name].clone(true);
}

// Blender suffixes repeated object names (propeller.001), which glTF exports as propeller001.
export function findNode(root, prefix) {
  let found = null;
  root.traverse((o) => {
    if (!found && o.name.startsWith(prefix)) found = o;
  });
  return found;
}

export function findNodes(root, prefix) {
  const found = [];
  root.traverse((o) => {
    if (o.name.startsWith(prefix)) found.push(o);
  });
  return found;
}

export function cloneMaterial(m) {
  const c = m.clone();
  c.onBeforeCompile = m.onBeforeCompile;
  c.customProgramCacheKey = m.customProgramCacheKey;
  return c;
}

// Swap a model's detailed surface shaders for plain ones; used where it sits too far back in the fog to see detail.
const plainCache = new Map();
export function plainMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material.onBeforeCompile || o.material.transparent) return;
    const src = o.material;
    if (!plainCache.has(src.uuid)) {
      plainCache.set(src.uuid, new THREE.MeshStandardMaterial({
        name: src.name, color: src.color, roughness: src.roughness, metalness: src.metalness, emissive: src.emissive,
        emissiveIntensity: src.emissiveIntensity, vertexColors: src.vertexColors,
      }));
    }
    o.material = plainCache.get(src.uuid);
  });
  return root;
}

export function ownMaterials(root) {
  const mats = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = cloneMaterial(o.material);
    mats.push(o.material);
  });
  return mats;
}

export function tint(root, color, amount) {
  const target = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.material = cloneMaterial(o.material);
    o.material.color.lerp(target, amount);
    if (o.material.emissiveIntensity) o.material.emissiveIntensity *= 1 - amount;
  });
  return root;
}
