// Runs inside the game page. Defines the trailer's shots on one timeline (seconds), each with a setup and a
// per-frame script, and exposes window.__trailer.frame(n) for the capture driver.
(() => {
  // Frames are captured at 60 fps and blended in pairs into 30 fps for motion blur.
  const FPS = 60;
  const D = window.__debug;
  const G = window.__game;
  const W = D.world;
  const P = D.player;

  // Cut points, snapped to beats in the music (see trailer/timeline.json).
  const CUT = {
    reef: 5.27, reefClose: 10.45, ruins: 15.44, notAlone: 20.0, kick: 24.36, fight2: 28.63, montage: 32.9,
    breach: 37.17, finale: 41.44, aftermath: 46.19, descent: 52.46, jellies: 60.17, black: 67.57, drift: 68.91,
    angler: 74.72, eyes: 77.97, drop: 83.61, boss: 87.14, chaos: 90.67, finish: 94.2, logo: 99.61, end: 106.47,
  };

  const overlay = document.createElement('div');
  overlay.innerHTML = `
    <div id="tr-fade" style="position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:50"></div>
    <div id="tr-card" style="position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;
      justify-content:center;opacity:0;z-index:60;font-family:Fredoka,system-ui,sans-serif;
      background:radial-gradient(ellipse at center,rgba(4,18,31,0.35),rgba(0,0,0,0.92))">
      <img src="${location.pathname.replace(/[^/]*$/, '')}logo.webp" style="width:58vw;filter:drop-shadow(0 1.4vw 2vw rgba(0,0,0,.6))">
      <div id="tr-tag" style="margin-top:2.5vh;font-size:2.6vw;font-weight:700;color:#cdeeff;
        text-shadow:0 3px 0 rgba(0,0,0,.45);letter-spacing:.04em">PLAY FREE IN YOUR BROWSER</div>
      <div id="tr-url" style="margin-top:1.2vh;font-size:1.7vw;font-weight:600;color:#ffd23a;
        text-shadow:0 2px 0 rgba(0,0,0,.5)">joshuaswanson.github.io/depths-of-doom</div>
    </div>`;
  document.body.append(overlay);
  const fade = document.getElementById('tr-fade');
  const card = document.getElementById('tr-card');

  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (x) => x * x * (3 - 2 * x);
  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  function face(dir) {
    P.facing = dir;
    P.yaw = P.restYaw = P.prevRestYaw = dir > 0 ? 0 : Math.PI;
    P.yawVel = 0;
  }

  function place(x, y, dir = 1) {
    P.group.position.set(x, y, 0);
    P.vel.set(0, 0);
    P.pitch = 0;
    P.pitchVel = 0;
    face(dir);
  }

  function clearBattle() {
    for (const list of [G.enemies, G.torpedoes, G.missiles, G.enemyMissiles]) {
      for (const e of list) G.scene.remove(e.obj);
      list.length = 0;
    }
    G.bullets.length = 0;
    G.queue.length = 0;
    G.waveBreak = 1e9;
  }

  function enemy(type, x, y, { tough = true, calm = false } = {}) {
    const e = G.spawnEnemy({ type, pos: { x, y } });
    if (!e) return null;
    if (tough) e.hp = e.maxHp = 1e6;
    if (calm) e.fire = 1e9;
    return e;
  }

  function kill(e) {
    if (e && !e.dead) {
      e.hp = 0;
      G.killEnemy(e);
    }
  }

  function upgrade(list) {
    for (const id of list) {
      G.coins = 1e6;
      G.buy(id);
    }
    G.coins = 2480;
  }

  const FULL_KIT = ['hull', 'hull', 'hull', 'cannon', 'cannon', 'cannon', 'torpedo', 'torpedo', 'missile', 'missile',
    'propulsion', 'propulsion', 'spotlight', 'spotlight', 'sonar', 'grapple'];

  // The sub stays simple through the trailer; only the upgrade montage and the final chaos show the full arsenal.
  const KIT_SIMPLE = ['hull', 'cannon', 'cannon', 'torpedo', 'propulsion'];
  const KIT_DEEP = [...KIT_SIMPLE, 'spotlight', 'spotlight'];

  function freshSub(kit) {
    P.reset();
    G.coins = 1e6;
    upgrade(kit);
    P.invuln = 0;
    P.hp = P.maxHp;
  }

  // Calm shots have nothing to hit the sub; in combat the shake from every blast is kept to a cinematic level.
  const hurtPlayer = G.hurtPlayer.bind(G);
  G.hurtPlayer = (amount, from) => {
    P.invuln = 0;
    hurtPlayer(amount, from);
    D.effects.shake = Math.min(D.effects.shake, 0.5);
  };

  // In the deep the fight is deadly serious: no comic bumps, and enemy subs keep their distance.
  const bump = G.bump.bind(G);
  G.bump = (e) => {
    if (!state.serious) bump(e);
  };
  function keepAway(min) {
    const c = P.center;
    for (const e of G.enemies) {
      if (e.dead || e.type === 'mine') continue;
      const p = e.obj.position;
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = min + e.def.rx * e.def.scale;
      if (d < reach) {
        p.x = c.x + (dx / d) * reach;
        p.y = c.y + (dy / d) * reach;
        e.vel.x = Math.max(0, e.vel.x * Math.sign(dx)) * Math.sign(dx);
      }
    }
  }

  // Missile volleys on the beat: `count` live enemies fire at the sub, the rest of the time they hold fire.
  function volley(count, spread = 0.18) {
    const shooters = G.enemies.filter((e) => !e.dead && e.type !== 'mine' && e.launcher);
    for (let i = 0; i < count && shooters.length; i++) {
      const e = shooters.splice(Math.floor(Math.random() * shooters.length), 1)[0];
      G.enemyAimed(e, P.center, rand(-spread, spread));
    }
  }
  // Combat flying: the sub darts up or down on every other beat, surging forward, and weaves between, so missiles
  // aimed at it streak past. It stays within `range` of the height it started the shot at.
  function evade(t, { beat, fwd = 0.6, kick = 4.5, surge = 3, range = 2.5 }) {
    state.baseY ??= P.center.y;
    const k = Math.floor(t / beat);
    if (k !== state.dodgeBeat) {
      state.dodgeBeat = k;
      if (k % 2 === 0) {
        let dir = -(state.dodgeDir || 1);
        const off = P.center.y - state.baseY;
        if (off > range) dir = -1;
        if (off < -range) dir = 1;
        state.dodgeDir = dir;
        P.vel.y += dir * kick;
        P.vel.x += surge * P.facingSign;
      }
    }
    // A banking dart, never a loop: the nose tips at most about 30 degrees.
    P.pitch = Math.max(-0.55, Math.min(0.55, P.pitch));
    P.pitchVel *= 0.8;
    return { x: fwd + 0.25 * Math.sin(t * 2.7), y: (state.dodgeDir || 1) * 0.45 };
  }

  function onBeats(t, beat, from, fn) {
    if (t < from) return;
    const k = Math.floor((t - from) / beat);
    if (k !== state.beatIndex) {
      state.beatIndex = k;
      fn(k);
    }
  }

  // Hits still flash, scorch and shake the sub, but it can never be sunk mid-shot.
  const takeHit = P.takeHit.bind(P);
  P.takeHit = (amount, from) => {
    P.hp = P.maxHp;
    const result = takeHit(amount, from);
    P.hp = P.maxHp;
    return result === 'dead' ? 'hit' : result;
  };

  // The sub holds its fire until the beat drops.
  const fireWeapons = G.fireWeapons.bind(G);
  G.fireWeapons = (dt) => {
    if (!state.holdFire) fireWeapons(dt);
  };

  // Camera: follows the sub with a lead, or eases toward a fixed point.
  const cam = { mode: 'follow', x: 0, y: 0, rate: 2.2, lead: 2.5, dy: 0.4, focus: null };
  const followCamera = G.updateCamera.bind(G);
  G.panelShare = 0;
  G.updateCamera = (dt) => {
    if (cam.mode === 'follow') {
      followCamera(dt);
      G.cam.y += cam.dy * (1 - Math.exp(-dt * 4));
      return;
    }
    if (cam.mode === 'pair' && cam.focus) {
      const pc = P.center;
      cam.x = (pc.x + cam.focus.obj.position.x) / 2;
      cam.y = (pc.y + cam.focus.obj.position.y) / 2 + 0.5;
    }
    const k = 1 - Math.exp(-dt * cam.rate);
    G.cam.x += (cam.x - G.cam.x) * k;
    G.cam.y += (cam.y - G.cam.y) * k;
  };
  function snapCamera(x, y) {
    G.cam.set(x, y);
  }

  function setHud(show) {
    D.hud.root ??= document.getElementById('hud');
    document.getElementById('hud').style.display = show ? '' : 'none';
    for (const el of [D.hud.radar, D.hud.pauseBtn, D.hud.bossBar, D.hud.banner, document.querySelector('.hud-topleft')]) {
      if (el) el.style.display = 'none';
    }
  }

  function angler() {
    return W.anglers[0];
  }

  // Keeps the anglerfish where the shot wants it, dark until `lit` turns its lure on. Hidden fish shrink to nothing,
  // since the world keeps wrapping anglers back near the camera.
  function holdAngler(x, y, z, dir, lit = false, shown = true) {
    const a = angler();
    const u = a.userData;
    a.position.set(x, y, z);
    a.scale.setScalar(shown ? 3.4 : 1e-4);
    u.target = new THREE_V2(x, y);
    u.retarget = 1e9;
    u.vel.set(0, 0);
    u.facing = dir;
    u.yaw = dir > 0 ? 0 : -Math.PI;
    u.wasNear = true;
    if (!lit && u.flash <= 0) u.untilFlash = 1e9;
    for (const other of W.anglers) {
      if (other === a) continue;
      other.scale.setScalar(1e-4);
      other.userData.untilFlash = 1e9;
      other.userData.wasNear = true;
    }
  }
  const THREE_V2 = P.vel.constructor;
  // Behind the sub and off to its tail, out of reach of its forward spotlight until the lure flares.
  const ANGLER_SPOT = [204, -187.8, -7];
  // The sub glides in from the left and eases to a stop just right of centre.
  const DRIFT = [195, 211, 6];
  function driftTo(t) {
    const k = clamp01(t / DRIFT[2]);
    const ease = 1 - (1 - k) ** 3;
    const x = DRIFT[0] + (DRIFT[1] - DRIFT[0]) * ease;
    P.vel.set((DRIFT[1] - DRIFT[0]) * 3 * (1 - k) ** 2 / DRIFT[2], 0);
    P.group.position.x = x - P.vel.x / FPS;
    P.group.position.y = -190.5 + Math.sin(t * 0.9) * 0.15;
    D.input = { x: 0, y: 0 };
    P.pitch *= 0.9;
    P.pitchVel = 0;
    face(1);
  }

  let state = {};
  const shots = [
    {
      // Sunlit surface: gulls bob on the swell as the sub cruises in along the waterline.
      start: 0, setup() {
        D.cinematic = true;
        setHud(false);
        // The surface sheet stops at the play plane; carry it out past the camera for angles looking up.
        W.surface.scale.set(1, 185 / 145, 1);
        W.surface.position.z = -52.5;
        W.surface.material.fragmentShader = W.surface.material.fragmentShader.replace('gl_FragColor = vec4(',
          'dist *= 1.0 - smoothstep( 30.0, 80.0, distance( vWorld, cameraPosition ) );\n        gl_FragColor = vec4(');
        W.surface.material.needsUpdate = true;
        W.waterline.visible = false;
        clearBattle();
        freshSub(['cannon', 'propulsion']);
        place(-58, 25.2, 1);
        cam.mode = 'follow';
        snapCamera(-54, 23.8);
        W.gulls.forEach((g, i) => W.landGull(g, -44 + i * 2.2));
      },
      frame(t) {
        fade.style.opacity = 1 - smooth(clamp01(t / 1.4));
        D.input = { x: 0.55, y: t > 3.8 ? -1 : 0 };
      },
    },
    {
      // Gliding over the big reef in the middle of the shelf.
      start: CUT.reef, setup() {
        place(-62, 0.5, 1);
        snapCamera(-59, 0.5);
      },
      frame(t) {
        D.input = { x: 0.6, y: Math.sin(t * 0.9) * 0.25 };
      },
    },
    {
      // Low between the corals, turning back past kelp and caustic light, scooping up loose coins.
      start: CUT.reefClose, setup() {
        place(-14, -2.2, -1);
        snapCamera(-17, -1.6);
        for (let i = 0; i < 6; i++) G.coinsList.push(looseCoin(-20 - i * 1.6, -1.8 + Math.sin(i) * 0.6));
      },
      frame(t) {
        D.input = { x: -0.6, y: Math.sin(t * 1.2) * 0.2 };
      },
    },
    {
      // Through the ruins, sunbeams slanting down.
      start: CUT.ruins, setup() {
        place(-98, 2.5, 1);
        snapCamera(-95, 2.8);
      },
      frame(t) {
        D.input = { x: 0.7, y: t < 2 ? -0.3 : 0.2 };
      },
    },
    {
      // Red viewports glide out of the blue ahead: not alone.
      start: CUT.notAlone, setup() {
        freshSub(KIT_SIMPLE);
        place(10, 4, 1);
        snapCamera(14, 4.4);
        clearBattle();
        state.pack = [enemy('gunner', 30, 5.5, { calm: true }), enemy('scout', 33, 2.8, { calm: true }),
          enemy('scout', 35, 7.5, { calm: true })];
        state.holdFire = true;
        state.beatIndex = -1;
      },
      frame(t) {
        D.input = t < 1.6 ? { x: t < 1.2 ? 0.4 : 0.12, y: 0 } : evade(t - 1.6, { beat: 0.534, fwd: 0.25, kick: 5 });
        for (const e of state.pack) if (e) e.vel.x = Math.min(e.vel.x, -1.6);
        // They shoot first: missile volleys on the beat before the sub returns fire on the drop.
        onBeats(t, 0.534, 1.6, (k) => volley(k % 2 ? 1 : 2));
      },
    },
    {
      // The beat drops: guns blazing, the first sub bursts apart.
      start: CUT.kick, setup() {
        state.holdFire = false;
        state.beatIndex = -1;
        kill(state.pack[1]);
        state.kills = [[1.07, state.pack[0]], [2.13, state.pack[2]]];
        state.spawned = false;
      },
      frame(t) {
        D.input = evade(t, { beat: 0.534 });
        fireOnBeats(t);
        onBeats(t, 0.534, 0, (k) => volley(k % 2 ? 1 : 2));
        if (!state.spawned && t > 2.4) {
          state.spawned = true;
          const c = P.center;
          state.wave2 = [enemy('scout', c.x + 16, c.y + 3), enemy('gunner', c.x - 15, c.y - 2), enemy('scout', c.x + 13, c.y - 4)];
        }
      },
    },
    {
      // Missiles corkscrew out, torpedoes streak ahead, the hull rings off an enemy ram.
      start: CUT.fight2, setup() {
        state.kills = [[0.53, state.wave2[0]], [1.6, state.wave2[2]], [3.2, state.wave2[1]]];
        state.beatIndex = -1;
      },
      frame(t) {
        D.input = evade(t, { beat: 0.534, fwd: 0.7 });
        fireOnBeats(t);
        onBeats(t, 0.534, 0, () => volley(1));
      },
    },
    {
      // Bolt on bigger guns: the store fills in, part after part on the beat.
      start: CUT.montage, setup() {
        clearBattle();
        freshSub(['propulsion']);
        place(4, 6, 1);
        snapCamera(6.5, 5.2);
        state.buys = ['cannon', 'hull', 'torpedo', 'cannon', 'missile', 'hull', 'shield', 'missile', 'hull', 'torpedo',
          'cannon', 'spotlight', 'sonar', 'grapple', 'propulsion', 'shield'];
        state.next = 0;
      },
      frame(t) {
        D.input = { x: 0.13, y: 0 };
        const beat = 0.534 / 2;
        while (state.next < state.buys.length && t >= state.next * beat + 0.05) {
          upgrade([state.buys[state.next]]);
          state.next++;
        }
      },
    },
    {
      // Bursting out of the surface in a spray of water as the gulls scatter.
      start: CUT.breach, setup() {
        setHud(false);
        freshSub(KIT_SIMPLE);
        place(70, 19, 1);
        P.vel.set(6, 14);
        snapCamera(74, 22);
        W.gulls.forEach((g, i) => W.landGull(g, 78 + i * 2));
        state.air = [enemy('scout', 92, 21), enemy('gunner', 96, 17)];
        state.kills = [[2.1, state.air[0]], [3.2, state.air[1]]];
      },
      frame(t) {
        D.input = { x: 0.8, y: t < 0.6 ? 1 : (t > 2.6 ? -0.6 : 0) };
        if (t < 0.3) P.vel.y = Math.max(P.vel.y, 13);
        fireOnBeats(t);
      },
    },
    {
      // A whole wave closes in and goes up in flames.
      start: CUT.finale, setup() {
        clearBattle();
        place(40, 6, 1);
        snapCamera(42.5, 6.4);
        state.wave = [];
        for (let i = 0; i < 6; i++) {
          state.wave.push(enemy(i % 3 ? 'scout' : 'gunner', 50 + (i % 3) * 4 + rand(-1, 1), 2 + Math.floor(i / 3) * 6 + rand(-1, 1)));
        }
        const b = 0.534;
        state.kills = state.wave.map((e, i) => [b * (2 + i * 1.3), e]);
        state.kills.push([4.65, null]);
        state.beatIndex = -1;
      },
      frame(t) {
        D.input = evade(t, { beat: 0.534, fwd: 0.55 });
        fireOnBeats(t);
        onBeats(t, 0.534, 0, () => volley(2));
      },
    },
    {
      // The battle won, the music settles back to the reef theme as the sub cruises through the kelp toward the edge.
      start: CUT.aftermath, setup() {
        clearBattle();
        for (const w of G.wrecks) w.gone = true;
        freshSub(KIT_DEEP);
        place(84, -1.5, 1);
      },
      frame() {
        D.input = { x: 0.32, y: 0 };
      },
    },
    {
      // Over the edge: the shelf drops away and the sub sinks along the cliff face into the dark.
      start: CUT.descent, setup() {
        place(112, -2, 1);
        snapCamera(116, -2.4);
      },
      frame(t) {
        D.input = { x: t < 2.4 ? 0.7 : 0.45, y: t < 1.6 ? 0 : -0.5 };
      },
    },
    {
      // Down through the glowing jellies, the spotlight cutting through the gloom.
      start: CUT.jellies, setup() {
        place(250, -94, 1);
        snapCamera(254, -96);
        W.jellies.forEach((j, i) => {
          const near = i < 3;
          j.position.set(250 + rand(-6, 26) + (near ? 6 : 0), rand(-122, -98), near ? rand(5, 9) : rand(-14, -3));
          j.visible = true;
        });
      },
      frame(t) {
        D.input = { x: 0.5, y: -0.32 };
        fade.style.opacity = smooth(clamp01((t - (CUT.black - CUT.jellies - 0.9)) / 0.9));
      },
    },
    {
      start: CUT.black, setup() {
        state.serious = true;
        place(196, -190.5, 1);
        cam.mode = 'fixed';
        cam.x = 212;
        cam.y = -189.6;
        cam.rate = 1.2;
        snapCamera(212, -189.6);
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1, false, false);
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1);
      },
      frame() {
        fade.style.opacity = 1;
        D.input = { x: 0, y: 0 };
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1, false, false);
      },
    },
    {
      // Pitch black. A lone spotlight drifts into frame.
      start: CUT.drift, setup() {
        place(DRIFT[0], -190.5, 1);
        fade.style.opacity = 0;
        W.anglerLight.distance = 34;
      },
      frame(t) {
        driftTo(t);
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1, false, false);
      },
    },
    {
      // Something behind the sub lights up: teeth, eyes, a glowing lure. Then it is gone.
      start: CUT.angler, setup() {
        const a = angler();
        a.userData.untilFlash = 0;
        a.userData.flash = 0;
        W.anglerLight.userData.owner = null;
      },
      frame(t) {
        driftTo(t + CUT.angler - CUT.drift);
        const a = angler();
        // One second of light: a quick flare up, a held beat, and a fast fade back to black.
        if (t > 0.75 && a.userData.flash > 0 && a.userData.flash < 2.2 - 0.25) a.userData.flash = 2.2 - 0.25;
        const showing = t < 0.5 || a.userData.flash > 0;
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1, true, showing);
      },
    },
    {
      // Back to darkness, and red viewports blink on one by one, closing in.
      start: CUT.eyes, setup() {
        cam.mode = 'follow';
        holdAngler(ANGLER_SPOT[0], ANGLER_SPOT[1], ANGLER_SPOT[2], 1, false, false);
        W.anglerLight.distance = 9;
        state.eyes = [];
        state.nextEye = 0;
        state.holdFire = true;
      },
      frame(t) {
        D.input = { x: 0.12, y: 0 };
        keepAway(8);
        const c = P.center;
        const spots = [[18, 4], [21, -3], [-19, 2], [24, 1], [-22, -4]];
        while (state.nextEye < spots.length && t >= state.nextEye * 0.88 + 0.4) {
          const [dx, dy] = spots[state.nextEye];
          state.eyes.push(enemy(state.nextEye === 3 ? 'gunner' : 'scout', c.x + dx, c.y + dy, { calm: true }));
          state.nextEye++;
        }
      },
    },
    {
      // The drop: everything opens fire.
      start: CUT.drop, setup() {
        for (const e of state.eyes) if (e) e.fire = rand(0.2, 1.2);
        state.holdFire = false;
        for (const a of W.anglers) a.scale.setScalar(1e-4);
        const b = 0.441;
        state.kills = [[0.0, state.eyes[0]], [b * 4, state.eyes[1]], [b * 6, state.eyes[2]]];
        state.beatIndex = -1;
        const c = P.center;
        state.more = [enemy('scout', c.x + 17, c.y + 6), enemy('gunner', c.x - 18, c.y + 5), enemy('scout', c.x + 20, c.y - 6)];
      },
      frame(t) {
        D.input = evade(t, { beat: 0.441, fwd: 0.45 });
        keepAway(6);
        fireOnBeats(t);
        onBeats(t, 0.441, 0, (k) => volley(k % 2 ? 2 : 3));
      },
    },
    {
      // The boss surfaces from the black, red lights blazing, mines and missile volleys everywhere.
      start: CUT.boss, setup() {
        const c = P.center;
        state.boss = enemy('boss', c.x + 10, c.y + 1.5);
        state.boss.fire = 0.4;
        state.kills = [[1.76, state.eyes[3]], [2.65, state.more[0]]];
        state.beatIndex = -1;
      },
      frame(t) {
        D.input = evade(t, { beat: 0.441, fwd: 0.45 });
        keepAway(6);
        fireOnBeats(t);
        onBeats(t, 0.441, 0, (k) => volley(k % 2 ? 3 : 4, 0.3));
      },
    },
    {
      // Chaos: torpedoes, shields flaring, wrecks spinning down.
      start: CUT.chaos, setup() {
        const c = P.center;
        // Hard cut into the finale: the full arsenal at last.
        const at = P.group.position.clone();
        const vel = P.vel.clone();
        freshSub(FULL_KIT);
        place(at.x, at.y, 1);
        P.vel.copy(vel);
        state.extra = [];
        const ring = [[-14, 3], [16, -3], [-15, -2], [18, 7], [-19, 8], [13, -8], [-11, -8], [22, 2], [-24, 1], [9, 10]];
        ring.forEach(([dx, dy], i) => state.extra.push(enemy(i % 3 === 2 ? 'gunner' : 'scout', c.x + dx, c.y + dy)));
        const b = 0.441;
        state.kills = [[b * 1, state.eyes[4]], [b * 2, state.extra[0]], [b * 3, state.more[1]], [b * 4, state.extra[1]],
          [b * 5, state.extra[3]], [b * 6, state.extra[4]], [b * 7, state.more[2]]];
        state.beatIndex = -1;
      },
      frame(t) {
        D.input = evade(t, { beat: 0.441, fwd: 0.5, kick: 5.5 });
        keepAway(6);
        fireOnBeats(t);
        onBeats(t, 0.441, 0, () => volley(6, 0.45));
      },
    },
    {
      // The boss breaks apart in a chain of blasts.
      start: CUT.finish, setup() {
        const b = 0.441;
        state.kills = [[b * 1, state.extra[2]], [b * 2, state.extra[5]], [b * 3, state.extra[6]], [b * 5, state.extra[7]],
          [b * 6, state.extra[8]], [b * 8, state.extra[9]], [b * 10, state.boss], [b * 10.2, null]];
        state.blasts = [b * 10, b * 10.5, b * 11, b * 11.5, b * 12];
        state.boss.hp = 1e6;
        state.beatIndex = -1;
        const c = P.center;
        for (const [dx, dy] of [[-17, 6], [19, -5], [-20, -6], [24, 5]]) enemy('scout', c.x + dx, c.y + dy);
      },
      frame(t) {
        D.input = evade(t, { beat: 0.441, fwd: 0.45 });
        keepAway(6);
        onBeats(t, 0.441, 0, (k) => k < 10 && volley(7, 0.5));
        const c = P.center;
        const bp = state.boss.obj.position;
        if (!state.boss.dead) {
          bp.x += (c.x + 8 * P.facingSign - bp.x) * 0.06;
          bp.y += (c.y + 3 - bp.y) * 0.06;
          bp.z += (-5 - bp.z) * 0.06;
        }
        fireOnBeats(t);
        while (state.blasts.length && t >= state.blasts[0]) {
          state.blasts.shift();
          D.effects.explosion({ x: bp.x + rand(-2.5, 2.5), y: bp.y + rand(-1.2, 1.2), z: 0.5 }, rand(1.6, 2.4));
        }
      },
    },
    {
      // Title card.
      start: CUT.logo, setup() {
        card.style.opacity = 1;
      },
      frame(t) {
        D.input = { x: 0, y: 0 };
        card.style.transform = `scale(${1.06 - 0.06 * smooth(clamp01(t / 0.6))})`;
        fade.style.opacity = smooth(clamp01((t - (CUT.end - CUT.logo - 1.6)) / 1.6));
      },
    },
  ];

  // Kills scheduled in shot time, so explosions land on the beat.
  function fireOnBeats(t) {
    if (!state.kills) return;
    for (const k of state.kills) {
      if (!k.done && t >= k[0]) {
        k.done = true;
        if (k[1]) kill(k[1]);
        else for (const e of [...G.enemies]) if (e.type !== 'mine' && e.type !== 'boss') kill(e);
      }
    }
  }

  function looseCoin(x, y) {
    const obj = new P.group.constructor();
    obj.scale.setScalar(0.6);
    obj.position.set(x, y, 0.3);
    return { obj, value: 1, vx: 0, vy: 0, t: 0, spin: 2, loose: true, homeY: y };
  }

  // Cinematic camera. Each scene has a list of camera cuts timed to the beat. A cut's function gets the time since
  // the cut and an anchor (the sub's position when the cut began) and returns a pose: orbit-style (a target with yaw,
  // pitch and distance; yaw 0 looks at the sub's side, positive swings round to its nose) or an explicit position and
  // look point. Targets ease along so moves stay smooth; `hand` adds handheld drift, `roll` tilts the horizon.
  const sub = (dx = 0, dy = 0, dz = 0) => {
    const c = P.center;
    return [c.x + dx * P.facingSign, c.y + dy, dz];
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (t, a, b) => smooth(clamp01((t - a) / (b - a)));
  const rig = { pose: null, target: null, snap: true, t: 0, cut: -1, anchor: [0, 0] };
  D.cameraRig = (camera, shake) => {
    const pose = rig.pose;
    if (!pose) return;
    const want = pose.look ?? pose.target ?? sub();
    if (rig.snap || !rig.target) rig.target = [...want];
    const k = rig.snap ? 1 : 1 - Math.exp(-(pose.rate ?? 5) / FPS);
    for (let i = 0; i < 3; i++) rig.target[i] = lerp(rig.target[i], want[i], k);
    const [tx, ty, tz] = rig.target;
    let pos;
    if (pose.pos) {
      pos = pose.pos;
    } else {
      const yaw = (pose.yaw ?? 0) * (pose.absolute ? 1 : P.facingSign);
      const pitch = pose.pitch ?? 0;
      const dist = pose.dist ?? 20;
      pos = [tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist,
        tz + Math.cos(yaw) * Math.cos(pitch) * dist];
    }
    rig.snap = false;
    const hand = (pose.hand ?? 0.3) * 0.05 + Math.min(shake, 0.5) * 0.25;
    const t = rig.t;
    camera.position.set(pos[0] + Math.sin(t * 1.7) * hand + Math.sin(t * 23) * shake * 0.08,
      pos[1] + Math.sin(t * 2.3 + 1) * hand + Math.sin(t * 29 + 2) * shake * 0.08, pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, ty, tz);
    camera.rotateZ((pose.roll ?? 0) + Math.sin(t * 0.9) * hand * 0.04);
    const fov = pose.fov ?? 40;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  // A fly-past: the camera holds still just ahead of where the sub will be and lets it rush past the lens.
  const flyPast = (a, ahead, side, up, fov = 58) => (t) => ({
    pos: [a[0] + ahead * P.facingSign, a[1] + up, side], look: sub(0.6, 0.2), fov, rate: 7,
  });

  const CAMS = [
    // Opening, at the surface: from underwater looking up at the sub floating against the sunlight, then straight
    // at its nose as it tips over and dives toward us.
    { cuts: [
      [0, (t) => ({ target: sub(0.4, 0.4), yaw: lerp(0.35, 0.15, ease(t, 0, 2.6)), pitch: -0.42, dist: 12, fov: 52, rate: 3 })],
      [2.62, (t) => ({ target: sub(0, 0), yaw: 1.32, pitch: lerp(-0.05, 0.12, ease(t, 0, 2.6)),
        dist: lerp(11, 7.5, ease(t, 0, 2.6)), fov: 40, rate: 4 })],
    ] },
    // Over the reef: a low front three-quarter as the sub glides toward us, then it rushes past the lens.
    { cuts: [
      [0, (t) => ({ target: sub(0.5, 0.4), yaw: 0.85, pitch: -0.03, dist: lerp(15, 10.5, ease(t, 0, 2.6)), fov: 40 })],
      [2.67, (t, a) => flyPast(a, 9.5, 2.9, -0.7)(t)],
    ] },
    // Scooping up coins: a drone shot straight down on the reef, then a close-up on the nose viewport.
    { cuts: [
      [0, (t) => ({ target: sub(-0.5, 0), yaw: lerp(-0.25, 0.25, ease(t, 0, 2.5)), pitch: 1.2,
        dist: lerp(14, 19, ease(t, 0, 2.5)), fov: 45 })],
      [2.48, (t) => ({ target: sub(0.4, 0.3), yaw: 1.38, pitch: 0.03, dist: lerp(7.5, 5.8, ease(t, 0, 2.5)), fov: 38 })],
    ] },
    // Through the ruins: from the sea floor looking up as the sub passes over against the sunbeams, then a chase.
    { cuts: [
      [0, (t) => ({ target: sub(0.5, 1.2), yaw: lerp(0.65, 0.2, ease(t, 0, 2.5)), pitch: -0.4, dist: 11, fov: 54 })],
      [2.49, (t) => ({ target: sub(1.5, 0.3), yaw: -0.95, pitch: 0.1, dist: lerp(10, 12, ease(t, 0, 2.1)), fov: 42 })],
    ] },
    // Not alone: the sub's face, then the reverse angle from behind the enemies as they open fire, then the face
    // again with missiles streaking in.
    { cuts: [
      [0, (t) => ({ target: sub(0.3, 0.3), yaw: 1.3, pitch: 0.02, dist: lerp(7.5, 6.3, ease(t, 0, 1.6)), fov: 38 })],
      [1.6, (t) => ({ target: sub(5, 0.6), yaw: 1.22, pitch: 0.06, dist: lerp(26, 24, ease(t, 0, 1.6)), fov: 38 })],
      [3.2, (t) => ({ target: sub(1, 0.3), yaw: 1.05, pitch: 0.0, dist: lerp(9, 7.5, ease(t, 0, 1.1)), fov: 42, hand: 1.2 })],
    ] },
    // The drop: wide and rolling, a low front angle, overhead, then a chase from behind.
    { cuts: [
      [0, () => ({ target: sub(3, 0.5), yaw: 0.3, dist: 17, fov: 42, roll: 0.07, hand: 1.2 })],
      [1.07, () => ({ target: sub(1, 0.5), yaw: 0.95, pitch: -0.1, dist: 11, fov: 46, hand: 1 })],
      [2.13, () => ({ target: sub(2, 0), yaw: 0.2, pitch: 0.95, dist: 19, fov: 44, roll: 0.1 })],
      [3.2, () => ({ target: sub(4, 0.3), yaw: -1.0, pitch: 0.08, dist: 11, fov: 44, hand: 1 })],
    ] },
    // Torpedoes away, seen from behind; then head-on into the gunfire; then a low angle.
    { cuts: [
      [0, () => ({ target: sub(5, 0.3), yaw: -1.08, pitch: 0.08, dist: 11, fov: 44, hand: 1 })],
      [2.13, () => ({ target: sub(0, 0.3), yaw: 1.25, pitch: 0.02, dist: 11, fov: 42, hand: 1.2 })],
      [3.2, () => ({ target: sub(1, 1), yaw: 0.6, pitch: -0.32, dist: 12, fov: 50, roll: -0.05 })],
    ] },
    // Upgrade montage: one long orbit, from the side round to the nose, as part after part bolts on.
    { cuts: [
      [0, (t) => ({ target: sub(0, 0.3), yaw: lerp(-0.8, 1.45, ease(t, 0, 4.27)), pitch: lerp(0.2, 0.04, ease(t, 0, 4.27)),
        dist: lerp(12.5, 9, ease(t, 0, 4.27)), fov: 38 })],
    ] },
    // Breach: low near the surface, slow motion as the sub soars overhead, then a chase as it crashes back in.
    {
      cuts: [
        [0, (t) => ({ target: sub(1, 1), yaw: lerp(0.5, 0.2, ease(t, 0, 2.7)), pitch: -0.12, dist: 16, fov: 44, rate: 4 })],
        [2.7, () => ({ target: sub(3, 0.3), yaw: -0.85, pitch: 0.1, dist: 12, fov: 44, hand: 1 })],
      ],
      timeScale: (t) => (t > 0.35 && t < 2.6 ? 0.36 : 1),
    },
    // Sink the fleet: wide push-in, a close front angle in the middle of the blasts, then overhead on the last wave.
    { cuts: [
      [0, (t) => ({ target: sub(4, 0.5), yaw: -0.35, pitch: 0.06, dist: lerp(20, 16, ease(t, 0, 2.1)), fov: 40, hand: 1 })],
      [2.14, () => ({ target: sub(1.5, 0.3), yaw: 1.0, pitch: -0.04, dist: 9.5, fov: 44, hand: 1.4 })],
      [3.73, () => ({ target: sub(3, 0), yaw: 0.15, pitch: 1.0, dist: 21, fov: 44, roll: -0.08 })],
    ] },
    // Aftermath: a slow tracking shot past the kelp, then the nose easing toward the drop.
    { cuts: [
      [0, (t) => ({ target: sub(1, 0.4), yaw: lerp(-0.55, -0.2, ease(t, 0, 3.1)), pitch: 0.06, dist: 13, fov: 40, rate: 3 })],
      [3.13, (t) => ({ target: sub(0.5, 0.3), yaw: 1.15, pitch: 0.05, dist: lerp(10, 8, ease(t, 0, 3.1)), fov: 40 })],
    ] },
    // Over the edge: looking straight down the cliff as the sub drops off it, then from below, a silhouette
    // against the last of the light.
    { cuts: [
      [0, (t) => ({ target: sub(1, -1), yaw: lerp(0.35, 0.1, ease(t, 0, 3.8)), pitch: 0.8, dist: lerp(15, 18, ease(t, 0, 3.8)),
        fov: 46, rate: 3 })],
      [3.81, (t) => ({ target: sub(0.5, 0.6), yaw: 0.3, pitch: -0.55, dist: lerp(11, 13, ease(t, 0, 3.9)), fov: 56, rate: 3 })],
    ] },
    // Through the jellies: a front three-quarter with jellies drifting past the lens, then up from below.
    { cuts: [
      [0, (t) => ({ target: sub(0.5, 0.3), yaw: 0.9, pitch: 0.05, dist: lerp(13, 11, ease(t, 0, 3.6)), fov: 42 })],
      [3.6, (t) => ({ target: sub(0.5, 1), yaw: 0.35, pitch: -0.42, dist: lerp(12, 14, ease(t, 0, 3.8)), fov: 52 })],
    ] },
    { cuts: [[0, () => ({ target: sub(), dist: 12, fov: 40 })]] },
    // In the dark: the sub drifts in from the left with the black empty water behind it.
    { cuts: [
      [0, (t) => ({ target: [DRIFT[1] - 3.2, -189, -2.5], yaw: lerp(0.46, 0.36, ease(t, 0, 5.8)), pitch: 0.04,
        dist: lerp(20.5, 17.5, ease(t, 0, 5.8)), fov: 40, rate: 2, absolute: true })],
    ] },
    // The lure flares behind it: a jolt and a snap zoom, then darkness again.
    { cuts: [
      [0, (t) => ({ target: [DRIFT[1] - 3.2, -189, -2.5], yaw: 0.36, pitch: 0.04, dist: 17.5,
        fov: lerp(40, 33, ease(t, 0, 0.35)), hand: t < 0.5 ? 4 : 0.4, rate: 2, absolute: true })],
    ] },
    // Red viewports wake up around it: close on the nose, then over its shoulder toward them.
    { cuts: [
      [0, (t) => ({ target: sub(0.3, 0.3), yaw: 1.3, pitch: 0.03, dist: lerp(8, 6.5, ease(t, 0, 2.75)), fov: 38 })],
      [2.75, (t) => ({ target: sub(3.5, 0.5), yaw: -0.85, pitch: 0.08, dist: lerp(14, 12.5, ease(t, 0, 2.9)), fov: 42 })],
    ] },
    // The drop in the deep: wide and rolling, then low in front.
    { cuts: [
      [0, () => ({ target: sub(2, 0.5), yaw: -0.3, pitch: 0.05, dist: 18, fov: 42, roll: 0.07, hand: 1.4 })],
      [1.76, () => ({ target: sub(1, 0.6), yaw: 1.0, pitch: -0.1, dist: 10, fov: 48, hand: 1.2 })],
    ] },
    // The boss: from below and behind the sub looking up at it, then from behind the boss down onto the sub.
    { cuts: [
      [0, () => {
        const b = state.boss.obj.position;
        const c = P.center;
        return { pos: [c.x - 6 * P.facingSign, c.y - 3.5, 7.5], look: [(b.x + c.x) / 2 + 1.5, b.y + 1, b.z], fov: 50,
          hand: 1, rate: 4 };
      }],
      [1.76, () => {
        const b = state.boss.obj.position;
        const c = P.center;
        return { pos: [b.x + 4.5 * P.facingSign, b.y + 1.6, 5.5], look: [c.x, c.y, 0], fov: 40, hand: 1.2, rate: 5 };
      }],
    ] },
    // Chaos: hard cuts every two beats between a chase, the nose, overhead and a rolling wide.
    { cuts: [
      [0, () => ({ target: sub(4, 0.3), yaw: -1.0, pitch: 0.08, dist: 12, fov: 46, hand: 1.4 })],
      [0.88, () => ({ target: sub(0, 0.3), yaw: 1.25, pitch: 0.02, dist: 10, fov: 44, hand: 1.4 })],
      [1.76, () => ({ target: sub(2, 0), yaw: 0.25, pitch: 1.05, dist: 24, fov: 46, roll: 0.12 })],
      [2.65, () => ({ target: sub(2, 0.5), yaw: -0.45, pitch: 0.04, dist: 20, fov: 46, roll: -0.08, hand: 1.6 })],
    ] },
    // The boss blows apart in slow motion; the camera pushes in on the sub in the glow.
    {
      cuts: [
        [0, (t) => ({ target: sub(4, 0.8), yaw: lerp(-0.2, 0.35, ease(t, 0, 4.3)), pitch: 0.06,
          dist: lerp(21, 15, ease(t, 0, 4.3)), fov: 42, hand: 1.2 })],
        [4.3, (t) => ({ target: sub(0.5, 0.3), yaw: 1.2, pitch: 0.02, dist: lerp(9, 7, ease(t, 0, 1.1)), fov: 40 })],
      ],
      timeScale: (t) => (t > 4.3 && t < 5.3 ? 0.35 : 1),
    },
    { cuts: [[0, () => ({ target: sub(), dist: 14, fov: 40 })]] },
  ];

  // Title cards slam in on the beat between the acts.
  const titles = document.createElement('div');
  titles.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:55;'
    + 'pointer-events:none;font-family:Fredoka,system-ui,sans-serif';
  document.body.append(titles);
  const TITLES = [
    { at: 32.9, until: 34.8, text: 'UPGRADE EVERYTHING' },
    { at: 41.44, until: 43.3, text: 'SINK THE FLEET' },
    { at: 67.62, until: 68.87, text: 'THE DEEP IS WAITING', dark: true },
  ];
  function showTitle(t) {
    const card = TITLES.find((c) => t >= c.at && t < c.until);
    if (!card) {
      titles.innerHTML = '';
      return;
    }
    const k = t - card.at;
    const out = card.until - t;
    const scale = 1.25 - 0.25 * smooth(clamp01(k / 0.18)) + 0.03 * k;
    const opacity = Math.min(clamp01(k / 0.12), clamp01(out / 0.25));
    titles.innerHTML = `<div style="font-size:6.2vw;font-weight:700;letter-spacing:.08em;color:#fff;opacity:${opacity};
      transform:scale(${scale});filter:blur(${(1 - clamp01(k / 0.18)) * 6}px);text-shadow:0 0.35vw 0 #06263f,
      0 0 2.5vw rgba(0,0,0,.75);${card.dark ? 'color:#d9f2ff' : ''}">${card.text}</div>`;
  }

  let current = -1;
  window.__trailer = {
    fps: FPS,
    duration: CUT.end,
    frame(n) {
      const t = n / FPS;
      let i = shots.length - 1;
      while (i > 0 && t < shots[i].start) i--;
      if (i !== current) {
        current = i;
        rig.cut = -1;
        state.baseY = undefined;
        state.dodgeBeat = undefined;
        shots[i].setup();
      }
      const local = t - shots[i].start;
      shots[i].frame(local);
      const { cuts } = CAMS[i];
      let c = cuts.length - 1;
      while (c > 0 && local < cuts[c][0]) c--;
      if (c !== rig.cut) {
        rig.cut = c;
        rig.snap = true;
        const centre = P.center;
        rig.anchor = [centre.x, centre.y];
      }
      rig.pose = cuts[c][1](local - cuts[c][0], rig.anchor);
      rig.t = t;
      showTitle(t);
      D.effects.shake = Math.min(D.effects.shake, 0.6);
      D.step((CAMS[i].timeScale?.(local) ?? 1) / FPS);
    },
  };
})();
