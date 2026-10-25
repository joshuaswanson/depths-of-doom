import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { loadModels, warmUp } from './assets.js';
import { SHADER_TIME } from './surface.js';
import { toggleMute, unlockAudio } from './audio.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Player } from './player.js';
import { UPGRADES } from './upgrades.js';
import { CAMERA_FOV, CAMERA_Z, installWaterFog } from './water.js';
import { World } from './world.js';

installWaterFog();

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
});
hud.showLoading(0);

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit && state === 'playing') game.buy(UPGRADES[Number(digit[1]) - 1].id);
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }
  if (e.code === 'KeyM') hud.showToast(toggleMute() ? 'Sound off' : 'Sound on');
  if (e.code === 'KeyU' && game) {
    game.unlimited = !game.unlimited;
    hud.showToast(game.unlimited ? 'Unlimited coins on' : 'Unlimited coins off');
  }
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
  composer.setSize(w, h);
  bloom.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  effects?.setViewport(h * renderer.getPixelRatio(), CAMERA_FOV);
  world?.setAspect(camera.aspect);
  game?.setAspect(camera.aspect);
}
window.addEventListener('resize', resize);

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
  game.unlimited = import.meta.env.DEV;
  resize();
  await warmUp(renderer, scene, camera);
  state = 'title';
  hud.showTitle();
  if (new URLSearchParams(location.search).has('autostart')) startGame();
  window.__game = game;
  window.__debug = { scene, world, bloom, renderer };
  renderer.setAnimationLoop(frame);
}

const timer = new THREE.Timer();
let titleT = 0;

function frame() {
  timer.update();
  const dt = Math.min(timer.getDelta(), 1 / 20);
  SHADER_TIME.value += dt;
  if (state === 'playing') {
    game.update(dt, readInput());
    if (game.over && game.overTimer <= 0) {
      state = 'gameover';
      hud.showGameOver({ wave: game.wave, kills: game.kills, coins: game.coinsTotal, parts: game.partCount });
    }
  } else if (state === 'title' || state === 'gameover') {
    titleT += dt;
    const auto = { x: Math.sin(titleT * 0.5) * 0.15, y: Math.sin(titleT * 0.8) * 0.5 };
    if (state === 'title') player.update(dt, auto, { left: -4, right: 4, top: 6, bottom: () => -1 });
    if (state === 'gameover') game.update(dt, { x: 0, y: 0 });
  }
  if (state !== 'paused') effects.update(dt, 0);
  const shake = effects.shake;
  camera.position.x = game.cam.x + (Math.random() - 0.5) * shake * 0.5;
  camera.position.y = game.cam.y + (Math.random() - 0.5) * shake * 0.5;
  if (state !== 'paused') world.update(dt, camera, player.alive ? player.group.position : null);
  lightForDepth(world.dark);
  player.setDarkness(world.dark);
  if (state === 'playing' || state === 'gameover') {
    hud.update({ player, coins: game.coins, wave: game.wave, boss: game.boss, unlimited: game.unlimited });
    hud.drawRadar(player, game.radarEnemies(), game.radarRange, game.radarSweep, game.radarCoins());
  }
  composer.render();
}

boot();
