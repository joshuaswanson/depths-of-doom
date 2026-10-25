import * as THREE from 'three';
import { SURFACE_Y } from './water.js';

const rand = (a, b) => a + Math.random() * (b - a);

function canvasTexture(draw, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const softTexture = canvasTexture((g, s) => {
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
});

const puffTexture = canvasTexture((g, s) => {
  const grad = g.createRadialGradient(s * 0.45, s * 0.4, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.65, 'rgba(235,240,245,0.95)');
  grad.addColorStop(0.85, 'rgba(200,210,220,0.5)');
  grad.addColorStop(1, 'rgba(200,210,220,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  g.fill();
});

const bubbleTexture = canvasTexture((g, s) => {
  const c = s / 2;
  const grad = g.createRadialGradient(c, c, s * 0.3, c, c, s * 0.48);
  grad.addColorStop(0, 'rgba(160,230,255,0.08)');
  grad.addColorStop(0.8, 'rgba(190,240,255,0.55)');
  grad.addColorStop(1, 'rgba(220,250,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(c, c, s * 0.48, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(c - s * 0.15, c - s * 0.17, s * 0.1, s * 0.06, -0.7, 0, Math.PI * 2);
  g.fill();
});

class ParticlePool {
  constructor(scene, { max, texture, blending, ceiling = Infinity }) {
    this.max = max;
    this.ceiling = ceiling;
    this.count = 0;
    this.p = [];
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending,
      uniforms: { uMap: { value: texture }, uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        attribute float size;
        attribute vec3 color;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_PointSize = size * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D( uMap, gl_PointCoord );
          gl_FragColor = vec4( vColor * t.rgb, t.a * vAlpha );
        }`,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(o) {
    if (this.p.length >= this.max) this.p.shift();
    this.p.push({
      x: o.pos.x, y: o.pos.y, z: o.pos.z ?? 0,
      vx: o.vel?.x ?? 0, vy: o.vel?.y ?? 0, vz: o.vel?.z ?? 0,
      life: 0, maxLife: o.life ?? 1,
      size0: o.size ?? 0.5, size1: o.size1 ?? o.size ?? 0.5,
      c0: new THREE.Color(o.color ?? '#ffffff'), c1: new THREE.Color(o.color1 ?? o.color ?? '#ffffff'),
      a0: o.alpha ?? 1, a1: o.alpha1 ?? 0,
      drag: o.drag ?? 0, rise: o.rise ?? 0, scroll: o.scroll ?? 1,
      wobble: o.wobble ?? 0, seed: Math.random() * 10,
    });
  }

  update(dt, scrollSpeed) {
    const c = new THREE.Color();
    let n = 0;
    const alive = [];
    for (const q of this.p) {
      q.life += dt;
      if (q.life >= q.maxLife || q.y > this.ceiling) continue;
      alive.push(q);
      const damp = Math.exp(-q.drag * dt);
      q.vx *= damp;
      q.vy = q.vy * damp + q.rise * dt;
      q.vz *= damp;
      q.x += (q.vx - scrollSpeed * q.scroll) * dt + Math.sin(q.life * 6 + q.seed) * q.wobble * dt;
      q.y += q.vy * dt;
      q.z += q.vz * dt;
      const t = q.life / q.maxLife;
      this.pos[n * 3] = q.x;
      this.pos[n * 3 + 1] = q.y;
      this.pos[n * 3 + 2] = q.z;
      c.copy(q.c0).lerp(q.c1, t);
      this.col[n * 3] = c.r;
      this.col[n * 3 + 1] = c.g;
      this.col[n * 3 + 2] = c.b;
      this.alpha[n] = q.a0 + (q.a1 - q.a0) * t;
      this.size[n] = q.size0 + (q.size1 - q.size0) * Math.sqrt(t);
      n++;
    }
    this.p = alive;
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'alpha', 'size']) this.geo.attributes[name].needsUpdate = true;
  }
}

export class Effects {
  constructor(scene) {
    this.bubbles = new ParticlePool(scene, {
      max: 2200, texture: bubbleTexture, blending: THREE.NormalBlending, ceiling: SURFACE_Y - 0.15,
    });
    this.puffs = new ParticlePool(scene, { max: 900, texture: puffTexture, blending: THREE.NormalBlending });
    this.glow = new ParticlePool(scene, { max: 700, texture: softTexture, blending: THREE.AdditiveBlending });
    this.puffs.points.renderOrder = 5;
    this.glow.points.renderOrder = 6;
    this.bubbles.points.renderOrder = 7;
    this.shake = 0;
  }

  setViewport(height, fov) {
    const scale = height / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)));
    for (const pool of [this.bubbles, this.puffs, this.glow]) pool.material.uniforms.uScale.value = scale;
  }

  bubble(pos, { spread = 0.2, size = [0.12, 0.3], vel = { x: 0, y: 0 }, life = [1.2, 2.2] } = {}) {
    if (pos.y > SURFACE_Y) return;
    this.bubbles.emit({
      pos: { x: pos.x + rand(-spread, spread), y: pos.y + rand(-spread, spread), z: (pos.z ?? 0) + rand(-spread, spread) },
      vel: { x: vel.x + rand(-0.4, 0.4), y: vel.y + rand(0.3, 1.0), z: 0 },
      life: rand(life[0], life[1]), size: rand(size[0], size[1]), size1: rand(size[0], size[1]) * 1.3,
      alpha: 0.95, alpha1: 0, drag: 1.5, rise: 2.2, wobble: 1.2,
    });
  }

  muzzle(pos, dir = null) {
    this.glow.emit({ pos, life: 0.07, size: 1.0, size1: 0.5, color: '#fff3a0', alpha: 0.9, alpha1: 0.1 });
    this.glow.emit({ pos, life: 0.1, size: 0.6, size1: 1.1, color: '#ffb52e', alpha: 0.7, alpha1: 0 });
    if (!dir) return;
    const tip = { x: pos.x + dir.x * 0.35, y: pos.y + dir.y * 0.35, z: pos.z };
    this.glow.emit({ pos: tip, vel: { x: dir.x * 6, y: dir.y * 6 }, life: 0.08, size: 0.5, size1: 0.9,
      color: '#ffd76a', alpha: 0.7, alpha1: 0 });
    if (pos.y > SURFACE_Y) return;
    for (let i = 0; i < 3; i++) {
      this.bubbles.emit({
        pos: { x: tip.x + rand(-0.1, 0.1), y: tip.y + rand(-0.1, 0.1), z: tip.z },
        vel: { x: dir.x * rand(2, 5) + rand(-0.6, 0.6), y: dir.y * rand(2, 5) + rand(-0.6, 0.6) },
        life: rand(0.5, 1.0), size: rand(0.07, 0.16), size1: 0.2, alpha: 0.9, alpha1: 0, drag: 4, rise: 2.5, wobble: 1,
      });
    }
  }

  trailBubble(pos) {
    if (pos.y > SURFACE_Y) return;
    this.bubbles.emit({
      pos: { x: pos.x + rand(-0.05, 0.05), y: pos.y + rand(-0.05, 0.05), z: pos.z },
      vel: { x: rand(-0.2, 0.2), y: rand(0.1, 0.4) }, life: rand(0.35, 0.6), size: rand(0.05, 0.1), size1: 0.12,
      alpha: 0.7, alpha1: 0, drag: 3, rise: 1.5,
    });
  }

  smokeTrail(pos, scale = 1) {
    this.puffs.emit({
      pos: { x: pos.x, y: pos.y + rand(-0.05, 0.05), z: pos.z ?? 0 },
      vel: { x: rand(-0.3, 0.3), y: rand(-0.2, 0.3) }, life: rand(0.6, 1.0), size: 0.35 * scale,
      size1: 1.1 * scale, color: '#f4f8fb', color1: '#c9d8e3', alpha: 0.75, alpha1: 0, drag: 2,
    });
  }

  flame(pos, scale = 1) {
    this.glow.emit({ pos, vel: { x: rand(-1, 1), y: rand(-0.5, 0.5) }, life: 0.12, size: 0.55 * scale,
      size1: 0.2 * scale, color: '#ffe27a', color1: '#ff6a1a', alpha: 1, alpha1: 0 });
  }

  sparkle(pos, color = '#fff6b0', count = 8, speed = 4) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(speed * 0.4, speed);
      this.glow.emit({ pos, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life: rand(0.25, 0.5), size: rand(0.15, 0.3),
        size1: 0.05, color, alpha: 1, alpha1: 0, drag: 3 });
    }
  }

  explosion(pos, scale = 1) {
    const p = { x: pos.x, y: pos.y, z: (pos.z ?? 0) + 0.5 };
    this.glow.emit({ pos: p, life: 0.18, size: 7 * scale, size1: 9 * scale, color: '#fff2c0', alpha: 0.9, alpha1: 0 });
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(1, 5) * scale;
      this.glow.emit({ pos: p, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life: rand(0.45, 0.8),
        size: rand(1.2, 2.0) * scale, size1: rand(2.4, 3.4) * scale, color: '#ffd35a', color1: '#e2401c',
        alpha: 1, alpha1: 0, drag: 3.5 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(0.8, 3.2) * scale;
      this.puffs.emit({ pos: { x: p.x, y: p.y, z: p.z - 0.3 }, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s },
        life: rand(1.0, 1.7), size: rand(1.2, 2.0) * scale, size1: rand(2.6, 3.8) * scale, color: '#5a4a48',
        color1: '#2b2c33', alpha: 0.95, alpha1: 0, drag: 2.2, rise: 0.6 });
    }
    this.sparkle(p, '#ffe08a', Math.round(12 * scale), 9 * scale);
    for (let i = 0; i < 14 * scale; i++) this.bubble(p, { spread: 0.8 * scale, size: [0.12, 0.35] });
    this.shake = Math.min(1.2, this.shake + 0.35 * scale);
  }

  splash(pos, scale = 1) {
    for (let i = 0; i < 22 * scale; i++) {
      const a = rand(0.25, Math.PI - 0.25);
      const s = rand(2, 7) * scale;
      this.puffs.emit({ pos: { x: pos.x + rand(-1.2, 1.2), y: pos.y, z: pos.z ?? 0.5 },
        vel: { x: Math.cos(a) * s * 0.6, y: Math.sin(a) * s }, life: rand(0.5, 0.9), size: rand(0.25, 0.6) * scale,
        size1: rand(0.1, 0.3), color: '#ffffff', color1: '#bfefff', alpha: 0.95, alpha1: 0, rise: -14, drag: 0.5 });
    }
    for (let i = 0; i < 16 * scale; i++) {
      this.bubble({ x: pos.x + rand(-1.5, 1.5), y: pos.y - rand(0.3, 1.5), z: pos.z }, { spread: 0.3 });
    }
  }

  debris(pos) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(2, 5);
      this.puffs.emit({ pos, vel: { x: Math.cos(a) * s, y: Math.sin(a) * s }, life: rand(0.5, 0.9), size: rand(0.25, 0.5),
        size1: rand(0.6, 1.0), color: '#3a3230', color1: '#1c1a1c', alpha: 0.9, alpha1: 0, drag: 3, rise: 0.4 });
    }
  }

  damageSmoke(pos, damage) {
    const heavy = damage > 0.6;
    this.puffs.emit({
      pos: { x: pos.x + rand(-0.1, 0.1), y: pos.y + rand(-0.1, 0.1), z: pos.z }, vel: { x: rand(-0.3, 0.3), y: rand(0.6, 1.2) },
      life: rand(1.0, 1.7), size: rand(0.45, 0.7), size1: rand(1.4, 2.1) * (heavy ? 1.3 : 1),
      color: heavy ? '#2a2526' : '#7d828a', color1: heavy ? '#0e0c0e' : '#4c5158', alpha: 0.85, alpha1: 0, drag: 1, rise: 0.8,
    });
    if (heavy && Math.random() < 0.3) this.sparkle(pos, '#ffb347', 3, 3);
    if (heavy && pos.y < SURFACE_Y) this.bubble(pos, { spread: 0.1, size: [0.06, 0.14] });
  }

  coinBurst(pos) {
    this.sparkle(pos, '#ffe35c', 10, 5);
  }

  update(dt, scrollSpeed) {
    this.bubbles.update(dt, scrollSpeed);
    this.puffs.update(dt, scrollSpeed);
    this.glow.update(dt, scrollSpeed);
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
}
