import '@fontsource/fredoka/400.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { ACHIEVEMENT_REWARD, onUnlock, setActive, unlock } from './achievements.js';
import { SHADOW_LAYER, loadModels, warmUp } from './assets.js';
import { SHADER_TIME, WATER } from './surface.js';
import { setAmbience, setMusic, sfx, toggleMute, unlockAudio } from './audio.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { Player } from './player.js';
import {
  CAMERA_FOV, CAMERA_Z, SHADOW_FAR, SHADOW_NEAR, SHADOW_SPAN, SURFACE_Y, installLightSkips, installWaterFog,
} from './water.js';
import { World } from './world.js';

installWaterFog();
installLightSkips();
WATER.surface.value = SURFACE_Y;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
const MIN_PIXEL_RATIO = Math.min(1, MAX_PIXEL_RATIO);
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
// Checking each shader for errors on its first draw stalls until the driver finishes linking it.
renderer.debug.checkShaderErrors = !import.meta.env.PROD;
// Opaque objects draw nearest first in depth bands, so graphics chips that shade every layer skip pixels already
// covered; within a band they stay grouped by material, which keeps shader switches down.
const DEPTH_BAND = 10;
renderer.setOpaqueSort((a, b) => a.groupOrder - b.groupOrder || a.renderOrder - b.renderOrder
  || Math.floor(a.z / DEPTH_BAND) - Math.floor(b.z / DEPTH_BAND) || a.material.id - b.material.id || a.z - b.z
  || a.id - b.id);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;
renderer.shadowMap.autoUpdate = false;

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
// Sunlight from high overhead, the only light that casts shadows: they fall under each sub and coral, a little
// to the right and toward the camera, where the side-on view can see them on the seabed.
const overhead = new THREE.DirectionalLight('#e8fbff', 0.6);
const OVERHEAD_OFFSET = new THREE.Vector3(-5, 20, -8).normalize().multiplyScalar(60);
const SHADOW_MAP = 2048;
overhead.position.copy(OVERHEAD_OFFSET);
overhead.castShadow = true;
overhead.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(overhead.shadow.camera, { left: -SHADOW_SPAN, right: SHADOW_SPAN, top: SHADOW_SPAN,
  bottom: -SHADOW_SPAN, near: SHADOW_NEAR, far: SHADOW_FAR });
overhead.shadow.camera.updateProjectionMatrix();
overhead.shadow.camera.layers.enable(SHADOW_LAYER);
overhead.shadow.bias = -0.0004;
overhead.shadow.normalBias = 0.04;
overhead.shadow.radius = 6;
overhead.shadow.blurSamples = 12;
scene.add(overhead, overhead.target);
const rim = new THREE.DirectionalLight('#7fdcff', 2.2);
rim.position.set(4, 6, -12);
scene.add(rim);
const under = new THREE.DirectionalLight('#3fb8c8', 0.6);
under.position.set(0, -10, 6);
scene.add(under);
const SUNLIGHT = [[hemi, 1.25], [sun, 2.1], [overhead, 0.6], [rim, 2.2], [under, 0.6]];

// Under the polar ice the light comes through turquoise: pale from the ice overhead, blue-green from the water around.
const ICY_SKY = new THREE.Color('#d6f2f6');
const ICY_GROUND = new THREE.Color('#0b4a4c');
const ICY_RIM = new THREE.Color('#78e6e0');
const ICY_UNDER = new THREE.Color('#2cb4b2');
function lightForDepth(dark, cold) {
  // The blizzard's overcast keeps the sun off the polar water.
  for (const [light, base] of SUNLIGHT) light.intensity = base * (1 - dark * 0.975) * (1 - 0.3 * cold);
  hemi.color.set('#9fe2ff').lerp(ICY_SKY, cold);
  hemi.groundColor.set('#163f4a').lerp(ICY_GROUND, cold);
  under.color.set('#3fb8c8').lerp(ICY_UNDER, cold);
  rim.color.set('#7fdcff').lerp(ICY_RIM, cold).lerp(new THREE.Color('#7a5cff'), dark);
  scene.environmentIntensity = 0.7 * (1 - dark * 0.97);
  overhead.shadow.intensity = 1 - THREE.MathUtils.smoothstep(dark, 0, 0.5);
}

// The shadow box follows the view across the floor below it, stepped in whole shadow-map texels so the edges of
// shadows hold still as the camera glides.
const sunAxes = (() => {
  const z = OVERHEAD_OFFSET.clone().normalize();
  const x = new THREE.Vector3(0, 1, 0).cross(z).normalize();
  return { x, y: z.clone().cross(x), z };
})();
const shadowCentre = new THREE.Vector3();
function followShadow() {
  const texel = (2 * SHADOW_SPAN) / overhead.shadow.mapSize.x;
  shadowCentre.set(camera.position.x, camera.position.y - 4, -10);
  const a = Math.round(shadowCentre.dot(sunAxes.x) / texel) * texel;
  const b = Math.round(shadowCentre.dot(sunAxes.y) / texel) * texel;
  const c = shadowCentre.dot(sunAxes.z);
  shadowCentre.copy(sunAxes.x).multiplyScalar(a).addScaledVector(sunAxes.y, b).addScaledVector(sunAxes.z, c);
  overhead.target.position.copy(shadowCentre);
  overhead.position.copy(shadowCentre).add(OVERHEAD_OFFSET);
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.4, 1.4);
// The glow is soft enough to compute at a quarter of the screen's resolution.
const bloomSetSize = bloom.setSize.bind(bloom);
bloom.setSize = (w, h) => bloomSetSize(Math.max(1, w / 2), Math.max(1, h / 2));
composer.addPass(bloom);
composer.addPass(new OutputPass());
// Smooths the stair-stepped edges, which otherwise crawl as anything moves, most visibly against the dark deep water.
composer.addPass(new SMAAPass());

const hudRoot = document.getElementById('hud');
let game = null;
let state = 'loading';

const hud = new Hud(hudRoot, {
  onBuy: (id) => {
    if (state === 'playing') game.buy(id);
  },
  onStart: () => startGame(),
  onHost: () => startCoop((net) => net.host()),
  onJoin: (code) => startCoop((net) => net.join(code)),
  onResume: () => resume(),
  onPause: () => {
    if (state === 'playing' && !net) pause();
  },
});
hud.showLoading(0);

const keys = new Set();
window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (hud.achievementsOpen) {
    if (e.code === 'Escape') hud.hideAchievements();
    return;
  }
  if ((e.code === 'KeyP' || e.code === 'Escape') && !net) {
    if (state === 'playing') pause();
    else if (state === 'paused') resume();
  }
  if (e.code === 'KeyM') hud.showToast(toggleMute() ? 'Sound off' : 'Sound on');
  if ((e.code === 'Enter' || e.code === 'Space') && (state === 'title' || state === 'gameover')) startGame();
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (state === 'playing' && !net) pause();
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

// Trade sharpness above 1:1 for frame rate when frames run long, and win it back with headroom.
const fpsWindow = { time: 0, frames: 0, good: 0, bad: 0, locked: false, need: 2, sinceRaise: Infinity, settle: 0 };

function setPixelRatio(r) {
  pixelRatio = Math.round(r * 100) / 100;
  renderer.setPixelRatio(pixelRatio);
  resize();
}

function lowerQuality() {
  if (pixelRatio > MIN_PIXEL_RATIO) setPixelRatio(Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.1));
}

function raiseQuality() {
  if (pixelRatio >= MAX_PIXEL_RATIO) return false;
  setPixelRatio(Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.15));
  return true;
}

// A slowdown lasting two straight seconds lowers the resolution, so a passing hitch never blurs the picture; a very
// slow machine drops a step every second. Smooth seconds raise it again, and a raise that brings the slowdown straight
// back makes the next one wait twice as long, so quality settles.
function adaptQuality(dt) {
  if (fpsWindow.locked || document.hidden || dt > 1) return;
  fpsWindow.time += dt;
  fpsWindow.frames++;
  if (fpsWindow.time < 1) return;
  const fps = fpsWindow.frames / fpsWindow.time;
  fpsWindow.time = 0;
  fpsWindow.frames = 0;
  // The second after a change can hold a shader compile, which says nothing about the new setting's speed.
  if (fpsWindow.settle > 0) {
    fpsWindow.settle--;
    return;
  }
  fpsWindow.sinceRaise++;
  fpsWindow.bad = fps < 48 ? fpsWindow.bad + 1 : 0;
  fpsWindow.good = fps > 56 ? fpsWindow.good + 1 : 0;
  if (fpsWindow.bad >= 2 || fps < 24) {
    if (fpsWindow.sinceRaise <= 3) fpsWindow.need = Math.min(fpsWindow.need * 2, 64);
    lowerQuality();
    if (fps < 12) lowerQuality();
    fpsWindow.bad = 0;
    fpsWindow.settle = 1;
  } else if (fpsWindow.good >= fpsWindow.need) {
    if (raiseQuality()) {
      fpsWindow.sinceRaise = 0;
      fpsWindow.settle = 1;
    }
    fpsWindow.good = 0;
  }
}

// Co-op: the game only starts once the room is ready, the host's registered or the guest's been welcomed in.
let net = null;
function startCoop(connect) {
  if (net) return;
  unlockAudio();
  net = new Net(game, {
    onStatus: (text, failed) => {
      if (state === 'playing') hud.showToast(text);
      else hud.coopStatus(text);
      if (failed && state !== 'playing') {
        net.close();
        net = null;
      }
    },
    onReady: ({ code, slot }) => {
      startGame();
      hud.showRoom(code, slot);
    },
  });
  connect(net);
}

let hintsShown = false;
function startGame() {
  unlockAudio();
  game.reset();
  state = 'playing';
  hud.hideOverlay();
  hud.setVisible(true);
  if (!hintsShown) {
    hintsShown = true;
    hud.showControlHints();
  }
}

const hintPoint = new THREE.Vector3();
function placeHints() {
  if (!hud.hints) return;
  hud.hints.hidden = state !== 'playing';
  const move = readInput();
  if (state === 'playing' && (move.x || move.y)) {
    hud.dismissHints();
    return;
  }
  const w = window.innerWidth;
  const h = window.innerHeight;
  const { x: cx, y: cy } = player.center;
  const z = player.group.position.z;
  const centre = hintPoint.set(cx, cy, z).project(camera);
  const x = (centre.x * 0.5 + 0.5) * w;
  const y = (0.5 - centre.y * 0.5) * h;
  const edge = hintPoint.set(cx + player.bodyHalf.hx, cy, z).project(camera);
  hud.placeHints(x, y, Math.abs((edge.x * 0.5 + 0.5) * w - x) + w * 0.07);
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
  world.effects = effects;
  player = new Player(scene);
  game = new Game({ scene, camera, world, effects, player, hud });
  resize();
  const cleanup = game.prewarm();
  // Creatures stay hidden until they appear, and hidden objects are skipped by the warm-up; show them for it.
  const hidden = [...world.jellies, ...world.anglers, world.whale, world.spermWhale, ...world.dolphins.pod, world.marlin,
    ...world.mantas, ...world.polar.warmers, ...world.polar.swimmers].filter((j) => !j.visible);
  for (const j of hidden) j.visible = true;
  renderer.shadowMap.needsUpdate = true;
  await warmUp(renderer, scene, camera, composer.readBuffer);
  // Draw a real frame, shadows and bloom included, so every shader's first use happens behind the loading screen.
  renderer.shadowMap.needsUpdate = true;
  composer.render();
  for (const j of hidden) j.visible = false;
  cleanup();
  state = 'title';
  hud.showTitle();
  const params = new URLSearchParams(location.search);
  if (params.has('autostart')) startGame();
  // An invite link drops straight into the host's game.
  const invite = params.get('join');
  if (invite && /^[a-z]{4}$/i.test(invite)) {
    hud.coopStatus(`Joining room ${invite.toUpperCase()}...`);
    startCoop((n) => n.join(invite));
  }
  window.__game = game;
  window.__debug = { scene, world, bloom, renderer, composer, effects, player, get pixelRatio() { return pixelRatio; },
    lockResolution(r) { fpsWindow.locked = true; setPixelRatio(r); },
    manual(on) { renderer.setAnimationLoop(on ? null : frame); },
    step(dt) { tick(dt); },
    set input(v) { scriptedInput = v; },
    set cinematic(v) { cinematic = v; },
    set cameraRig(fn) { cameraRig = fn; },
    camera,
    start: startGame, hud };
  renderer.setAnimationLoop(frame);
}

const timer = new THREE.Timer();
let titleT = 0;

// Sunlit music near the surface gives way to the deep track below; fights swap in the battle tracks.
function musicMix() {
  if (state === 'title') return {};
  const deep = THREE.MathUtils.smoothstep(world.dark, 0.15, 0.45);
  const fight = game.inCombat ? 1 : 0;
  const duck = state === 'paused' ? 0.35 : 1;
  return {
    surface: (1 - deep) * (1 - fight) * duck, deep: deep * (1 - fight) * duck,
    battle: (1 - deep) * fight * duck, battleDeep: deep * fight * duck,
  };
}

function frame() {
  timer.update();
  const rawDt = timer.getDelta();
  adaptQuality(rawDt);
  tick(Math.min(rawDt, 1 / 20));
}

// Browsers stop animation frames in a hidden tab. In co-op that would freeze the game for everyone (the host runs the
// enemies), so a worker's timer, which isn't throttled the same way, keeps the game ticking until the tab is back.
let hiddenLast = 0;
const backgroundTicker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33);'])));
backgroundTicker.onmessage = () => {
  if (!document.hidden || !net || state !== 'playing') {
    hiddenLast = 0;
    return;
  }
  const now = performance.now();
  const dt = hiddenLast ? Math.min((now - hiddenLast) / 1000, 1 / 10) : 1 / 30;
  hiddenLast = now;
  game.update(dt, { x: 0, y: 0 });
  net.tick(dt);
};

// Scripted input and fixed-step frames let the trailer capture drive the game frame by frame.
let scriptedInput = null;
let cinematic = false;
let cameraRig = null;

// Each achievement pops up, chimes, and adds a few coins to the dive it was earned in.
onUnlock((def) => {
  hud.showAchievement(def, ACHIEVEMENT_REWARD);
  sfx.achievement();
  game.coins += ACHIEVEMENT_REWARD;
  game.coinsTotal += ACHIEVEMENT_REWARD;
  hud.pulseCoins();
});

function tick(dt) {
  setActive(state === 'playing' && !cinematic);
  if (state !== 'paused') SHADER_TIME.value += dt;
  if (state === 'playing') {
    game.update(dt, scriptedInput ?? readInput());
    if (net) {
      net.tick(dt);
      hud.setPlayers(game.players.map((p) => p.netId ?? 1).sort());
      if (game.players.length > 1) unlock('coop');
    }
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
  game.status.group.visible = !cinematic && (state === 'playing' || state === 'paused') && player.alive;
  const shake = state === 'paused' ? 0 : effects.shake;
  camera.position.x = game.cam.x + (Math.random() - 0.5) * shake * 0.5;
  camera.position.y = game.cam.y + (Math.random() - 0.5) * shake * 0.5;
  if (cameraRig) {
    cameraRig(camera, shake);
  } else if (camera.position.z !== CAMERA_Z || camera.fov !== CAMERA_FOV || camera.quaternion.w !== 1) {
    camera.position.z = CAMERA_Z;
    camera.quaternion.identity();
    camera.fov = CAMERA_FOV;
    camera.updateProjectionMatrix();
  }
  world.calm = !(state === 'playing' && game.inCombat);
  if (state !== 'paused') world.update(dt, camera, player.alive ? player.group.position : null, player.alive ? player : null);
  setAmbience(dt, state === 'playing' && {
    active: true,
    surface: 1 - THREE.MathUtils.smoothstep(Math.abs(player.center.y - SURFACE_Y), 0.8, 5),
    speed: THREE.MathUtils.clamp(player.vel.length() / 9, 0, 1),
    underwater: THREE.MathUtils.smoothstep(SURFACE_Y - player.center.y, 0.3, 1.5),
    depth: world.dark,
  });
  setMusic(musicMix());
  lightForDepth(world.dark, world.polar.cold);
  followShadow();
  player.setDarkness(world.dark);
  if (state === 'playing' || state === 'gameover') {
    hud.update({ player, coins: game.coins, wave: game.wave, boss: game.boss });
    hud.drawRadar(player, game.radarEnemies(), game.radarRange, game.radarSweep, game.radarCoins());
  }
  placeHints();
  // Shadows fade out completely in the dark water, so there is nothing to redraw.
  renderer.shadowMap.needsUpdate = !overhead.shadow.map || overhead.shadow.intensity > 0;
  composer.render();
}

boot();
