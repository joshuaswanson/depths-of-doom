import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
