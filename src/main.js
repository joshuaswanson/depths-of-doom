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
import { setAmbience, setMusic, toggleMute, unlockAudio } from './audio.js';
import { Effects } from './effects.js';
import { Game } from './game.js';
import { Hud } from './hud.js';
import { Net } from './net.js';
import { Player } from './player.js';
import { CAMERA_FOV, CAMERA_Z, SURFACE_Y, installWaterFog } from './water.js';
import { World } from './world.js';

installWaterFog();
WATER.surface.value = SURFACE_Y;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PIXEL_RATIO = Math.min(window.devicePixelRatio, 1.5);
const MIN_PIXEL_RATIO = Math.min(1, MAX_PIXEL_RATIO);
let pixelRatio = MAX_PIXEL_RATIO;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xffffff, 20, 125);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.7;

const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.5, 400);
camera.position.set(0, 0, CAMERA_Z);

const hemi = new THREE.HemisphereLight('#9fe2ff', '#163f4a', 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff1d6', 2.1);
sun.position.set(-6, 14, 10);
scene.add(sun);
// Sunlight from nearly straight overhead, the only light that casts shadows: they fall just under each sub and
// coral, a little toward the camera, where the side-on view can see them on the seabed.
const overhead = new THREE.DirectionalLight('#e8fbff', 0.6);
const OVERHEAD_OFFSET = new THREE.Vector3(-2, 20, -4).normalize().multiplyScalar(60);
const SHADOW_SPAN = 30;
const SHADOW_MAP = 2048;
overhead.position.copy(OVERHEAD_OFFSET);
overhead.castShadow = true;
overhead.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
Object.assign(overhead.shadow.camera, { left: -SHADOW_SPAN, right: SHADOW_SPAN, top: SHADOW_SPAN,
  bottom: -SHADOW_SPAN, near: 1, far: 140 });
overhead.shadow.camera.updateProjectionMatrix();
overhead.shadow.bias = -0.0004;
overhead.shadow.normalBias = 0.04;
overhead.shadow.radius = 3;
scene.add(overhead, overhead.target);
const rim = new THREE.DirectionalLight('#7fdcff', 2.2);
rim.position.set(4, 6, -12);
scene.add(rim);
const under = new THREE.DirectionalLight('#3fb8c8', 0.6);
under.position.set(0, -10, 6);
scene.add(under);
const SUNLIGHT = [[hemi, 1.0], [sun, 2.1], [overhead, 0.6], [rim, 2.2], [under, 0.6]];

function lightForDepth(dark) {
  for (const [light, base] of SUNLIGHT) light.intensity = base * (1 - dark * 0.975);
  rim.color.set('#7fdcff').lerp(new THREE.Color('#7a5cff'), dark);
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
  const texel = (2 * SHADOW_SPAN) / SHADOW_MAP;
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

// Trade sharpness for frame rate: drop the render resolution when frames run long, raise it again with headroom.
const fpsWindow = { time: 0, frames: 0, good: 0, bad: 0, locked: false };
// Only a slowdown lasting two straight seconds lowers the resolution, so a passing hitch never blurs the picture;
// two smooth seconds raise it again.
function adaptResolution(dt) {
  if (fpsWindow.locked || document.hidden || dt > 0.25) return;
  fpsWindow.time += dt;
  fpsWindow.frames++;
  if (fpsWindow.time < 1) return;
  const fps = fpsWindow.frames / fpsWindow.time;
  fpsWindow.time = 0;
  fpsWindow.frames = 0;
  fpsWindow.bad = fps < 48 ? fpsWindow.bad + 1 : 0;
  fpsWindow.good = fps > 56 ? fpsWindow.good + 1 : 0;
  let next = pixelRatio;
  if (fpsWindow.bad >= 2) {
    next = Math.max(MIN_PIXEL_RATIO, pixelRatio - 0.1);
    fpsWindow.bad = 0;
  } else if (fpsWindow.good >= 2) {
    next = Math.min(MAX_PIXEL_RATIO, pixelRatio + 0.15);
    fpsWindow.good = 0;
  }
  if (next !== pixelRatio) {
    pixelRatio = next;
    renderer.setPixelRatio(pixelRatio);
    resize();
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
  world.effects = effects;
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
    lockResolution(r) { fpsWindow.locked = true; pixelRatio = r; renderer.setPixelRatio(r); resize(); },
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
  adaptResolution(rawDt);
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

function tick(dt) {
  if (state !== 'paused') SHADER_TIME.value += dt;
  if (state === 'playing') {
    game.update(dt, scriptedInput ?? readInput());
    if (net) {
      net.tick(dt);
      hud.setPlayers(game.players.map((p) => p.netId ?? 1).sort());
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
  lightForDepth(world.dark);
  followShadow();
  player.setDarkness(world.dark);
  if (state === 'playing' || state === 'gameover') {
    hud.update({ player, coins: game.coins, wave: game.wave, boss: game.boss });
    hud.drawRadar(player, game.radarEnemies(), game.radarRange, game.radarSweep, game.radarCoins());
  }
  composer.render();
}

boot();
