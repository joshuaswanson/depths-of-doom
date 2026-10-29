// Optimize the raw Blender exports in models-src/ into the web-ready models in public/models/:
// trims over-dense scenery meshes and Draco-compresses every model.
//
//   node scripts/optimize-models.mjs [name ...]
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, draco, flatten, join, prune, resample, simplify, weld } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptSimplifier } from 'meshoptimizer';

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const SRC = path.join(ROOT, 'models-src');
const OUT = path.join(ROOT, 'public', 'models');

// Share of triangles kept for scenery that never comes close to the camera, and how far the shape may drift.
const SIMPLIFY = {
  anglerfish: [0.45, 0.004],
  reef_large: [0.3, 0.01],
  reef_small: [0.32, 0.01],
  kelp_tall: [0.45, 0.006],
  kelp_short: [0.45, 0.006],
  coral_staghorn: [0.4, 0.008],
  coral_table: [0.6, 0.004],
  sponge_cluster: [0.6, 0.004],
  anemone_patch: [0.6, 0.004],
  wreck_sub: [0.6, 0.004],
  deep_jelly: [0.7, 0.003],
  manta: [0.35, 0.003],
  rusted_vessel: [0.5, 0.003],
  polar_bear: [0.5, 0.002],
  penguin: [0.4, 0.0015],
  blue_tang: [0.2, 0.0015],
  clownfish: [0.4, 0.0015],
  pufferfish: [0.35, 0.0015],
  seahorse: [0.35, 0.0015],
  starfish: [0.6, 0.0015],
};

// Scenery whose shadow comes from a much coarser stand-in: the soft shadow blur hides the lost detail.
// Values are the stand-in's triangle count.
const SHADOW_PROXY = {
  reef_large: 1500,
  reef_small: 1000,
  coral_staghorn: 800,
  coral_fan: 300,
  coral_brain: 250,
  coral_table: 300,
  sponge_cluster: 250,
};

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'draco3d.encoder': await draco3d.createEncoderModule(),
    'draco3d.decoder': await draco3d.createDecoderModule(),
  });

await MeshoptSimplifier.ready;
fs.mkdirSync(path.join(OUT, 'shadow'), { recursive: true });
const only = process.argv.slice(2);
let before = 0;
let after = 0;
for (const file of fs.readdirSync(SRC).filter((f) => f.endsWith('.glb')).sort()) {
  const name = file.replace(/\.glb$/, '');
  if (only.length && !only.includes(name)) continue;
  const doc = await io.read(path.join(SRC, file));
  // Empty nodes stay: the game finds muzzles, lenses and lures by name.
  const steps = [dedup(), prune({ keepLeaves: true })];
  if (doc.getRoot().listAnimations().length) steps.push(resample({ tolerance: 5e-4 }));
  if (SIMPLIFY[name]) {
    const [ratio, error] = SIMPLIFY[name];
    steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error }));
  }
  steps.push(draco({ method: 'edgebreaker', quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12 }));
  await doc.transform(...steps);
  const out = path.join(OUT, file);
  await io.write(out, doc);
  const a = fs.statSync(path.join(SRC, file)).size;
  const b = fs.statSync(out).size;
  before += a;
  after += b;
  console.log(`${name.padEnd(22)} ${(a / 1024).toFixed(0).padStart(6)}K -> ${(b / 1024).toFixed(0).padStart(5)}K`);
  if (SHADOW_PROXY[name]) await writeShadowProxy(name, SHADOW_PROXY[name]);
}
console.log(`total ${(before / 1048576).toFixed(1)} MB -> ${(after / 1048576).toFixed(1)} MB`);

// Positions only, simplified hard, for the shadow pass alone.
async function writeShadowProxy(name, triangles) {
  const doc = await io.read(path.join(SRC, `${name}.glb`));
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) if (semantic !== 'POSITION') prim.setAttribute(semantic, null);
    }
  }
  for (const material of doc.getRoot().listMaterials()) material.dispose();
  for (const texture of doc.getRoot().listTextures()) texture.dispose();
  await doc.transform(dedup(), flatten(), join({ keepNamed: false }), prune(), weld());
  // Coral is many small closed tubes, which the careful simplifier keeps whole; the sloppy one merges across them.
  const prims = doc.getRoot().listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const total = prims.reduce((sum, prim) => sum + prim.getIndices().getCount(), 0);
  const ratio = Math.min(1, (triangles * 3) / total);
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = new Uint32Array(prim.getIndices().getArray());
      const positions = new Float32Array(prim.getAttribute('POSITION').getArray());
      const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3);
      const [kept] = MeshoptSimplifier.simplifySloppy(indices, positions, 3, null, target, 0.2);
      prim.getIndices().setArray(kept);
    }
  }
  await doc.transform(prune(), draco({ method: 'edgebreaker', quantizePosition: 12 }));
  await io.write(path.join(OUT, 'shadow', `${name}.glb`), doc);
}
