import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { addWaterline, applySurfaceDetail } from './surface.js';
import { addSkullDecals } from './decals.js';

const MODEL_NAMES = [
  'player_hull', 'player_hull_big', 'part_cannon', 'part_torpedo', 'part_missile', 'part_shield', 'part_grapple_1', 'part_grapple_2', 'part_grapple_3', 'part_grapple_4', 'part_sonar',
  'part_thruster', 'part_spotlight', 'junk_crate', 'junk_ammo', 'junk_toolbox', 'junk_canister', 'junk_barrel', 'junk_duck',
  'proj_torpedo', 'proj_missile', 'proj_player_missile', 'pickup_coin', 'enemy_scout', 'enemy_gunner', 'enemy_boss',
  'mine', 'ruin_pillar_a', 'ruin_pillar_b', 'ruin_arch', 'ruin_wall', 'ruin_pier', 'ruin_tower', 'anchor', 'chain',
  'coral_brain', 'rock_a', 'rock_b', 'deep_jelly', 'kelp_tall', 'kelp_short', 'coral_staghorn', 'coral_fan',
  'coral_table', 'sponge_cluster', 'anemone_patch', 'reef_small', 'reef_large',
  'wreck_sub', 'anglerfish', 'seagull', 'humpback', 'sperm_whale', 'dolphin', 'marlin', 'manta', 'rusted_vessel',
  'penguin', 'polar_bear', 'blue_tang', 'discus', 'tigerfish', 'clownfish', 'pufferfish', 'seahorse', 'starfish',
  'sheephead',
];

const models = {};
const clips = {};

// The soft shadow blur smears anything this fine into nothing, so drawing it into the shadow map is wasted work.
const FINE_DETAIL = /^(anemone_|kelp_bladder|jelly_)|_tip$/;

export function castsShadow(material) {
  return !material.transparent && !FINE_DETAIL.test(material.name);
}

// Dense scenery casts its shadow from a coarse stand-in that only the shadow camera sees.
const SHADOW_PROXIES = ['reef_large', 'reef_small', 'coral_staghorn', 'coral_fan', 'coral_brain', 'coral_table',
  'sponge_cluster'];
export const SHADOW_LAYER = 1;
const proxyMaterial = new THREE.MeshBasicMaterial({ name: 'shadow_proxy' });
const proxies = {};

function mergedPositions(root) {
  root.updateMatrixWorld(true);
  const geos = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = new THREE.BufferGeometry().setAttribute('position', o.geometry.attributes.position.clone());
    geo.setIndex(o.geometry.index);
    geos.push(geo.applyMatrix4(o.matrixWorld));
  });
  return mergeGeometries(geos, false);
}

export async function loadModels(onProgress) {
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  let done = 0;
  await Promise.all(MODEL_NAMES.map(async (name) => {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material.envMapIntensity = 0.55;
      o.castShadow = castsShadow(o.material) && !SHADOW_PROXIES.includes(name);
      // The sub and its parts are closed shapes, so their front faces alone cast the shadow. That keeps them on the
      // shadow shader everything else already uses, so their first shadow never stalls a frame.
      if (/^(player_|part_)/.test(name)) o.material.shadowSide = THREE.FrontSide;
    });
    applySurfaceDetail(gltf.scene);
    models[name] = gltf.scene;
    clips[name] = gltf.animations;
    onProgress?.(++done / MODEL_NAMES.length);
  }));
  await Promise.all(SHADOW_PROXIES.map(async (name) => {
    const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/shadow/${name}.glb`);
    proxies[name] = mergedPositions(gltf.scene);
  }));
  draco.dispose();
  addSkullDecals(models);
  for (const model of Object.values(models)) mergeStatic(model);
}

// Nodes the game moves, swaps, or toggles on their own; everything else in a model is rigid and gets merged.
const MOVING = /^(turret_guns|side_detail|propeller|thruster_prop|sonar_dish|grapple_arm|grapple_claw|cannon_barrels|jaw|lure|wing_|wings_folded|skull_mark|muzzle|lens|jelly_bell|spotlight_head)/;

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
      mesh.castShadow = meshes[0].castShadow;
      group.add(mesh);
      for (const m of meshes) {
        for (const child of [...m.children]) m.parent.attach(child);
        m.removeFromParent();
      }
    }
  }
}

// Compile every model's shaders up front so the first enemy or upgrade of each kind doesn't stall a frame.
// Shader variants depend on the render target, so compile against the post-processing buffer the game draws into.
export async function warmUp(renderer, scene, camera, target) {
  const holder = new THREE.Group();
  for (const name of MODEL_NAMES) {
    const obj = spawn(name);
    // Parts bolted onto a sub catch the waterline shimmer, a shader variant of their own.
    if (/^(part_|junk_)/.test(name)) for (const m of ownMaterials(obj)) addWaterline(m, { topOnly: true });
    holder.add(obj);
  }
  holder.position.set(0, 0, -5);
  scene.add(holder);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  await renderer.compileAsync(scene, camera);
  // Compiling alone leaves each shader's first use, and the stall that comes with it, for the first frame that draws
  // it; draw everything once now, including what lies outside the view.
  const culled = [];
  scene.traverse((o) => {
    if (o.frustumCulled) {
      o.frustumCulled = false;
      culled.push(o);
    }
  });
  renderer.render(scene, camera);
  for (const o of culled) o.frustumCulled = true;
  renderer.setRenderTarget(previous);
  scene.remove(holder);
}

export function animationsOf(name) {
  return clips[name] ?? [];
}

// Skinned models need their skeleton rebound to the copy, which a plain clone does not do.
export function spawnSkinned(name) {
  return cloneSkinned(models[name]);
}

export function spawn(name) {
  const obj = models[name].clone(true);
  if (proxies[name]) {
    const proxy = new THREE.Mesh(proxies[name], proxyMaterial);
    proxy.layers.set(SHADOW_LAYER);
    proxy.castShadow = true;
    obj.add(proxy);
  }
  return obj;
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
