import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { loadModels, warmUp } from './assets.js';
import { SHADER_TIME, WATER } from './surface.js';
import { toggleMute, unlockAudio } from './audio.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Player } from './player.js';
import { CAMERA_FOV, CAMERA_Z, SURFACE_Y, installWaterFog } from './water.js';
import { World } from './world.js';

installWaterFog();
WATER.surface.value = SURFACE_Y;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
const MIN_PIXEL_RATIO = 0.75;
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 20, 125);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.5, 400);
camera.position.set(0, 0, CAMERA_Z);

const hemi = new THREE.HemisphereLight('#9fe2ff', '#163f4a', 1.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.1);
sun.position.set(-6, 14, 10);
scene.add(sun);
const rim = new THREE.DirectionalLight('#7fdcff', 2.2);
rim.position.set(4, 6, -12);
scene.add(rim);
const under = new THREE.DirectionalLight('#3fb8c8', 0.6);
under.position.set(0, -10, 6);
scene.add(under);
const SUNLIGHT = [[hemi, 1.25], [sun, 2.1], [rim, 2.2], [under, 0.6]];

function lightForDepth(dark) {
  for (const [light, base] of SUNLIGHT) light.intensity = base * (1 - dark * 0.975);
  rim.color.set('#7fdcff').lerp(new THREE.Color('#7a5cff'), dark);
  scene.environmentIntensity = 0.7 * (1 - dark * 0.97);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 1.4);
// The glow is soft enough to compute at a quarter of the screen's resolution.
const bloomSetSize = bloom.setSize.bind(bloom);
bloom.setSize = (w, h) => bloomSetSize(Math.max(1, w / 2), Math.max(1, h / 2));
composer.addPass(bloom);
composer.addPass(new OutputPass());

const hudRoot = document.getElementById('hud');
let game = null;
let state = 'loading';

const hud = new Hud(hudRoot, {
  onBuy: (id) => {
    if (state === 'playing') game.buy(id);
  },
  onStart: () => startGame(),
  onResume: () => resume(),
  onPause: () => {
    if (state === 'playing') pause();
  },
});
hud.showLoading(0);

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }
  if (e.code === 'KeyM') hud.showToast(toggleMute() ? 'Sound off' : 'Sound on');
  if ((e.code === 'Enter' || e.code === 'Space') && (state === 'title' || state === 'gameover')) startGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (state === 'playing') pause();
});

function readInput() {
  const x = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const y = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  return { x, y };
}

let world;
let effects;
let player;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects?.setViewport(h * renderer.getPixelRatio(), CAMERA_FOV);
  world?.setAspect(camera.aspect);
  game?.setAspect(camera.aspect);
}
window.addEventListener('resize', resize);

// Trade sharpness for frame rate: drop the render resolution when frames run long, raise it again with headroom.
const fpsWindow = { time: 0, frames: 0, good: 0, locked: false };
function adaptResolution(dt) {
  if (fpsWindow.locked || document.hidden || dt > 0.5) return;
  fpsWindow.time += dt;
  fpsWindow.frames++;
  if (fpsWindow.time < 0.5) return;
  const fps = fpsWindow.frames / fpsWindow.time;
  fpsWindow.time = 0;
  fpsWindow.frames = 0;
  let next = pixelRatio;
  if (fps < 52) {
    next = Math.max(MIN_PIXEL_RATIO, pixelRatio - (fps < 40 ? 0.25 : 0.1));
    fpsWindow.good = 0;
  } else if (fps > 58 && ++fpsWindow.good >= 6) {
    next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.1);
    fpsWindow.good = 0;
  }
  if (next !== pixelRatio) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    resize();
  }
}

function startGame() {
  unlockAudio();
  game.reset();
  state = 'playing';
  hud.hideOverlay();
  hud.setVisible(true);
}

function pause() {
  state = 'paused';
  hud.showPause();
}

function resume() {
  state = 'playing';
  hud.hideOverlay();
}

async function boot() {
  await loadModels((p) => hud.showLoading(p));
  world = new World(scene);
  effects = new Effects(scene);
  player = new Player(scene);
  game = new Game({ scene, camera, world, effects, player, hud });
  resize();
  const cleanup = game.prewarm();
  const hidden = world.jellies.filter((j) => !j.visible);
  for (const j of hidden) j.visible = true;
  await warmUp(renderer, scene, camera, composer.readBuffer);
  for (const j of hidden) j.visible = false;
  cleanup();
  state = 'title';
  hud.showTitle();
  if (new URLSearchParams(location.search).has('autostart')) startGame();
  window.__game = game;
  window.__debug = { scene, world, bloom, renderer, composer, effects, player, get pixelRatio() { return pixelRatio; },
    lockResolution(r) { fpsWindow.locked = true; pixelRatio = r; renderer.setPixelRatio(r); resize(); } };
  renderer.setAnimationLoop(frame);
}

const timer = new THREE.Timer();
let titleT = 0;

function frame() {
  timer.update();
  const rawDt = timer.getDelta();
  adaptResolution(rawDt);
  const dt = Math.min(rawDt, 1 / 20);
  SHADER_TIME.value += dt;
  if (state === 'playing') {
    game.update(dt, readInput());
    if (game.over && game.overTimer <= 0) {
      state = 'gameover';
      hud.showGameOver({ wave: game.wave, kills: game.kills, coins: game.coinsTotal, parts: game.partCount });
    }
  } else if (state === 'title' || state === 'gameover') {
    titleT += dt;
    const auto = { x: 0, y: 0 };
    if (state === 'title') player.update(dt, auto, { left: -4, right: 4, top: 6, bottom: () => -1 });
    if (state === 'gameover') game.update(dt, { x: 0, y: 0 });
  }
  if (state !== 'paused') effects.update(dt, 0);
  game.status.group.visible = (state === 'playing' || state === 'paused') && player.alive;
  const shake = state === 'paused' ? 0 : effects.shake;
  camera.position.x = game.cam.x + (Math.random() - 0.5) * shake * 0.5;
  camera.position.y = game.cam.y + (Math.random() - 0.5) * shake * 0.5;
  if (state !== 'paused') world.update(dt, camera, player.alive ? player.group.position : null, player.alive ? player : null);
  lightForDepth(world.dark);
  player.setDarkness(world.dark);
  if (state === 'playing' || state === 'gameover') {
    hud.update({ player, coins: game.coins, wave: game.wave, boss: game.boss });
    hud.drawRadar(player, game.radarEnemies(), game.radarRange, game.radarSweep, game.radarCoins());
  }
  composer.render();
}

boot();
