// Runs inside the game page. Defines the trailer's shots on one timeline (seconds), each with a setup and a
// per-frame script, and exposes window.__trailer.frame(n) for the capture driver.
(() => {
  const FPS = 30;
  const D = window.__debug;
  const G = window.__game;
  const W = D.world;
  const P = D.player;

  // Cut points, snapped to beats in the music (see trailer/timeline.json).
  const CUT = {
    reef: 5.27, reefClose: 10.45, ruins: 15.44, notAlone: 20.0, kick: 24.36, fight2: 28.63, montage: 32.9,
    breach: 37.17, finale: 41.44, descent: 46.19, jellies: 53.9, black: 61.3, drift: 62.64, angler: 69.75,
    eyes: 73.0, drop: 78.64, boss: 82.17, chaos: 85.7, finish: 89.23, logo: 94.64, end: 101.5,
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

  function freshSub(kit) {
    P.reset();
    G.coins = 1e6;
    upgrade(kit);
    P.invuln = 1e9;
    P.hp = P.maxHp;
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
  const ANGLER_SPOT = [204, -186.4, -7];
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
        freshSub(FULL_KIT);
        place(10, 4, 1);
        snapCamera(14, 4.4);
        clearBattle();
        state.pack = [enemy('gunner', 34, 5.5, { calm: true }), enemy('scout', 37, 2.8, { calm: true }),
          enemy('scout', 40, 7.5, { calm: true })];
        state.holdFire = true;
      },
      frame(t) {
        D.input = { x: t < 1.2 ? 0.4 : 0.12, y: 0 };
        for (const e of state.pack) if (e) e.vel.x = Math.min(e.vel.x, -2.2);
      },
    },
    {
      // The beat drops: guns blazing, the first sub bursts apart.
      start: CUT.kick, setup() {
        state.holdFire = false;
        for (const e of state.pack) if (e) { e.fire = 1.2; }
        kill(state.pack[1]);
        state.kills = [[1.07, state.pack[0]], [2.13, state.pack[2]]];
        state.spawned = false;
      },
      frame(t) {
        D.input = { x: 0.5 + Math.sin(t * 1.5) * 0.1, y: Math.sin(t * 2) * 0.14 };
        fireOnBeats(t);
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
      },
      frame(t) {
        D.input = { x: t < 2 ? 0.5 : -0.4, y: Math.sin(t * 1.7) * 0.22 };
        fireOnBeats(t);
      },
    },
    {
      // Bolt on bigger guns: the store fills in, part after part on the beat.
      start: CUT.montage, setup() {
        clearBattle();
        freshSub(['propulsion']);
        place(4, 6, 1);
        snapCamera(6.5, 5.2);
        setHud(true);
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
        freshSub(FULL_KIT);
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
      },
      frame(t) {
        D.input = { x: 0.5 + Math.sin(t) * 0.1, y: Math.sin(t * 2.2) * 0.14 };
        fireOnBeats(t);
      },
    },
    {
      // Over the edge: the shelf drops away and the sub sinks along the cliff face into the dark.
      start: CUT.descent, setup() {
        clearBattle();
        for (const w of G.wrecks) w.gone = true;
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
        P.invuln = 0;
        const b = 0.441;
        state.kills = [[0.0, state.eyes[0]], [b * 4, state.eyes[1]], [b * 6, state.eyes[2]]];
      },
      frame(t) {
        D.input = { x: 0.16, y: Math.sin(t * 1.9) * 0.05 };
        fireOnBeats(t);
      },
    },
    {
      // The boss surfaces from the black, red lights blazing, mines and missile volleys everywhere.
      start: CUT.boss, setup() {
        const c = P.center;
        state.boss = enemy('boss', c.x + 10, c.y + 1.5);
        state.boss.fire = 0.4;
        state.kills = [[1.76, state.eyes[3]]];
      },
      frame(t) {
        D.input = { x: 0.16, y: Math.sin(t * 1.4) * 0.05 };
        fireOnBeats(t);
      },
    },
    {
      // Chaos: torpedoes, shields flaring, wrecks spinning down.
      start: CUT.chaos, setup() {
        const c = P.center;
        state.extra = [enemy('scout', c.x - 14, c.y + 3), enemy('scout', c.x + 16, c.y - 3), enemy('gunner', c.x - 15, c.y - 2)];
        const b = 0.441;
        state.kills = [[b * 2, state.eyes[4]], [b * 4, state.extra[0]], [b * 6, state.extra[1]]];
      },
      frame(t) {
        D.input = { x: 0.16, y: Math.sin(t * 2.1) * 0.05 };
        fireOnBeats(t);
      },
    },
    {
      // The boss breaks apart in a chain of blasts.
      start: CUT.finish, setup() {
        const b = 0.441;
        state.kills = [[b * 4, state.extra[2]], [b * 10, state.boss]];
        state.blasts = [b * 10, b * 10.5, b * 11, b * 11.5, b * 12];
        state.boss.hp = 1e6;
      },
      frame(t) {
        D.input = { x: 0.16, y: Math.sin(t * 1.5) * 0.05 };
        const c = P.center;
        const bp = state.boss.obj.position;
        if (!state.boss.dead) {
          bp.x += (c.x + 8.5 - bp.x) * 0.06;
          bp.y += (c.y + 1.8 - bp.y) * 0.06;
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

  // Cinematic camera. Each shot's `cam(t)` returns a pose: either orbit-style (a target with yaw, pitch and distance)
  // or an explicit position and look point. Targets ease along so moves stay smooth; `hand` adds handheld drift.
  const sub = (dx = 0, dy = 0, dz = 0) => {
    const c = P.center;
    return [c.x + dx, c.y + dy, dz];
  };
  const lerp = (a, b, k) => a + (b - a) * k;
  const ease = (t, a, b) => smooth(clamp01((t - a) / (b - a)));
  const rigState = { pose: null, target: null, snap: true, t: 0 };
  D.cameraRig = (camera, shake) => {
    const pose = rigState.pose;
    if (!pose) return;
    const want = pose.look ?? pose.target ?? sub();
    if (rigState.snap || !rigState.target) rigState.target = [...want];
    const k = rigState.snap ? 1 : 1 - Math.exp(-(pose.rate ?? 4) / FPS);
    for (let i = 0; i < 3; i++) rigState.target[i] = lerp(rigState.target[i], want[i], k);
    const [tx, ty, tz] = rigState.target;
    let pos;
    if (pose.pos) {
      pos = pose.pos;
    } else {
      const yaw = pose.yaw ?? 0;
      const pitch = pose.pitch ?? 0;
      const dist = pose.dist ?? 20;
      pos = [tx + Math.sin(yaw) * Math.cos(pitch) * dist, ty + Math.sin(pitch) * dist, tz + Math.cos(yaw) * Math.cos(pitch) * dist];
    }
    rigState.snap = false;
    const hand = (pose.hand ?? 0.25) * 0.06 + shake * 0.35;
    const t = rigState.t;
    camera.position.set(pos[0] + Math.sin(t * 1.7) * hand + (Math.random() - 0.5) * shake * 0.3,
      pos[1] + Math.sin(t * 2.3 + 1) * hand + (Math.random() - 0.5) * shake * 0.3, pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(tx, ty, tz);
    camera.rotateZ((pose.roll ?? 0) + Math.sin(t * 1.1) * hand * 0.05);
    const fov = pose.fov ?? 38;
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  };

  // Camera moves and slow motion for each shot, in the same order as `shots`.
  const CAMS = [
    // Opener: head-on at the surface, pushing in as the sub cruises.
    { cam: (t) => ({ target: sub(3, 0.6), dist: lerp(30, 19, ease(t, 0, 5.27)), fov: 38, rate: 3 }) },
    // Reef glide: rear three-quarter tracking shot, coral running past in depth.
    { cam: (t) => ({ target: sub(1.6, 0.2, -1), yaw: lerp(-0.62, -0.42, ease(t, 0, 5)), pitch: 0.13, dist: 11, fov: 42 }) },
    // Low front three-quarter between the corals, pushing in.
    { cam: (t) => ({ target: sub(-1, 0.3), yaw: -0.78, pitch: 0.04, dist: lerp(8.5, 6.5, ease(t, 0, 5)), fov: 42 }) },
    // Slow orbit through the ruins.
    { cam: (t) => ({ target: sub(0.5, 0.4), yaw: lerp(0.6, -0.35, ease(t, 0, 4.6)), pitch: 0.08, dist: 13, fov: 40 }) },
    // Over the shoulder toward the red viewports.
    { cam: (t) => ({ target: sub(10, 0.8), yaw: -0.9, pitch: 0.1, dist: lerp(19, 16, ease(t, 0, 4.3)), fov: 40, rate: 3 }) },
    // The drop: punchy, a little handheld.
    { cam: () => ({ target: sub(3, 0.5), yaw: 0.25, dist: 16, fov: 40, roll: 0.04, hand: 1 }) },
    // Chase from the front quarter.
    { cam: (t) => ({ target: sub(2, 0.4), yaw: lerp(0.5, 0.3, ease(t, 0, 4)), pitch: 0.05, dist: 12, fov: 40, roll: -0.05, hand: 1 }) },
    // Upgrade montage: orbit close around the sub as the parts bolt on.
    { cam: (t) => ({ target: sub(0, 0.3), yaw: lerp(-0.85, 0.85, ease(t, 0, 4.27)), pitch: 0.12, dist: 11.5, fov: 38 }) },
    // Breach: head-on and close, slowed right down while the sub is in the air.
    {
      cam: () => ({ target: sub(1, 0.8), dist: 17, fov: 38, rate: 3 }),
      timeScale: (t) => (t > 0.35 && t < 2.7 ? 0.38 : 1),
    },
    // Wave finale: wide three-quarter push-in, shaking with the blasts.
    { cam: (t) => ({ target: sub(4, 0.5), yaw: -0.35, pitch: 0.06, dist: lerp(19, 15, ease(t, 0, 4.7)), fov: 40, hand: 1.2 }) },
    // Over the edge and down the cliff, looking down a little.
    { cam: () => ({ target: sub(0.5, -0.5), yaw: 0.18, pitch: 0.22, dist: 15, fov: 40, rate: 3 }) },
    // Through the jellies, some drifting right past the lens.
    { cam: () => ({ target: sub(0.5, 0.3), yaw: 0.35, pitch: 0.05, dist: 14, fov: 40 }) },
    { cam: () => ({ target: sub(), dist: 12, fov: 40 }) },
    // In the dark: front three-quarter, slowly pushing in, the empty water behind the sub over its shoulder.
    { cam: (t) => ({ target: [DRIFT[1] - 3.2, -189.2, -2.5], yaw: lerp(0.46, 0.36, ease(t, 0, 7)), pitch: 0.05,
      dist: lerp(19, 16, ease(t, 0, 7)), fov: 40, rate: 2 }) },
    // The lure flares: a jolt and a quick zoom.
    { cam: (t) => ({ target: [DRIFT[1] - 3.2, -189.2, -2.5], yaw: 0.36, pitch: 0.05, dist: 16,
      fov: lerp(40, 33, ease(t, 0, 0.35)), hand: t < 0.5 ? 4 : 0.4, rate: 2 }) },
    // Red viewports close in: slow orbit.
    { cam: (t) => ({ target: sub(0, 0.5), yaw: lerp(0.4, -0.3, ease(t, 0, 5.6)), pitch: 0.06, dist: 12, fov: 40 }) },
    // The drop: wide, rolling, handheld.
    { cam: () => ({ target: sub(2, 0.5), yaw: -0.3, pitch: 0.05, dist: 18, fov: 42, roll: 0.06, hand: 1.5 }) },
    // The boss looms: low over the sub's shoulder, looking up at it.
    { cam: () => {
      const b = state.boss.obj.position;
      const c = P.center;
      return { pos: [c.x - 9, c.y - 1.4, 10], look: [(b.x + c.x) / 2 + 1.5, b.y + 0.4, b.z], fov: 44, hand: 1, rate: 3 };
    } },
    // Chaos: tracking with roll.
    { cam: () => ({ target: sub(2, 0.4), yaw: 0.45, pitch: 0.05, dist: 13, fov: 40, roll: -0.07, hand: 1.5 }) },
    // The boss blows apart in slow motion.
    {
      cam: (t) => {
        const b = state.boss.obj.position;
        const c = P.center;
        return { target: [(b.x + c.x) / 2, (b.y + c.y) / 2 + 0.4, 0], yaw: -0.2, pitch: 0.05,
          dist: lerp(17, 12.5, ease(t, 0, 5.4)), fov: 40, hand: 1 };
      },
      timeScale: (t) => (t > 4.3 && t < 5.25 ? 0.35 : 1),
    },
    { cam: () => ({ target: sub(), dist: 14, fov: 40 }) },
  ];

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
        shots[i].setup();
        rigState.snap = true;
      }
      const local = t - shots[i].start;
      shots[i].frame(local);
      rigState.pose = CAMS[i].cam(local);
      rigState.t = t;
      D.step((CAMS[i].timeScale?.(local) ?? 1) / FPS);
    },
  };
})();
