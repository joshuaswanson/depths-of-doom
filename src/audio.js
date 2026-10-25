let ctx = null;
let master = null;
let muted = false;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlockAudio() {
  ensure();
  if (ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

function tone({ type = 'sine', freq = 440, to = freq, dur = 0.15, vol = 0.3, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(gain).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.4, freq = 800, to = 200, q = 1, delay = 0 }) {
  if (!ctx || muted) return;
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

let lastShot = 0;

export const sfx = {
  shoot() {
    if (!ctx) return;
    if (ctx.currentTime - lastShot < 0.05) return;
    lastShot = ctx.currentTime;
    tone({ type: 'square', freq: 900, to: 300, dur: 0.06, vol: 0.05 });
  },
  torpedo() {
    noise({ dur: 0.5, vol: 0.25, freq: 1500, to: 300 });
    tone({ type: 'sine', freq: 200, to: 90, dur: 0.3, vol: 0.2 });
  },
  missile() {
    noise({ dur: 0.45, vol: 0.2, freq: 3000, to: 600, q: 3 });
  },
  enemyShot() {
    tone({ type: 'sawtooth', freq: 320, to: 140, dur: 0.18, vol: 0.06 });
  },
  boom(big = false) {
    noise({ dur: big ? 1.2 : 0.6, vol: big ? 0.8 : 0.5, freq: big ? 1200 : 1800, to: 60 });
    tone({ type: 'sine', freq: big ? 110 : 160, to: 30, dur: big ? 0.9 : 0.45, vol: 0.45 });
  },
  pop() {
    tone({ type: 'sine', freq: 500, to: 1100, dur: 0.08, vol: 0.12 });
  },
  coin() {
    tone({ type: 'square', freq: 988, dur: 0.07, vol: 0.06 });
    tone({ type: 'square', freq: 1319, dur: 0.16, vol: 0.06, delay: 0.06 });
  },
  hurt() {
    tone({ type: 'sawtooth', freq: 220, to: 60, dur: 0.4, vol: 0.3 });
    noise({ dur: 0.3, vol: 0.3, freq: 900, to: 100 });
  },
  shield() {
    tone({ type: 'triangle', freq: 1400, to: 700, dur: 0.35, vol: 0.2 });
    tone({ type: 'sine', freq: 2100, to: 1800, dur: 0.4, vol: 0.1 });
  },
  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.18, delay: i * 0.07 }));
    noise({ dur: 0.12, vol: 0.25, freq: 4000, to: 1500, delay: 0.3 });
  },
  denied() {
    tone({ type: 'square', freq: 180, to: 150, dur: 0.15, vol: 0.08 });
  },
  clank() {
    tone({ type: 'square', freq: 260, to: 120, dur: 0.08, vol: 0.1 });
  },
  wave() {
    [392, 523, 659].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.25, vol: 0.15, delay: i * 0.12 }));
  },
  splash() {
    noise({ dur: 0.6, vol: 0.35, freq: 2500, to: 400, q: 0.7 });
    tone({ type: 'sine', freq: 300, to: 120, dur: 0.25, vol: 0.12 });
  },
  thud(strength = 1) {
    noise({ dur: 0.5, vol: 0.25 * strength, freq: 500, to: 60 });
    tone({ type: 'sine', freq: 90, to: 40, dur: 0.35, vol: 0.3 * Math.min(1, strength) });
  },
  gull() {
    [0, 0.22, 0.4].forEach((d) => {
      tone({ type: 'sawtooth', freq: 1900, to: 1100, dur: 0.16, vol: 0.05, delay: d });
      tone({ type: 'square', freq: 2400, to: 1500, dur: 0.12, vol: 0.02, delay: d });
    });
  },
  sonar() {
    tone({ type: 'sine', freq: 1500, to: 1400, dur: 0.6, vol: 0.06 });
  },
};
