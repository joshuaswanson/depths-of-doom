import * as THREE from 'three';

// Smooth 3D gradient noise, -1 to 1.
const PERM = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1234567;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h, x, y, z) {
  const u = h & 8 ? y : x;
  const v = h & 12 ? (h === 12 || h === 14 ? x : z) : y;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  const L = THREE.MathUtils.lerp;
  return L(
    L(L(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      L(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    L(L(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      L(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

export function fbm(x, y, z, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x, y, z) * amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 3.7;
    z = z * 2.03 + 9.3;
    amp *= 0.5;
  }
  return sum;
}

// How far a star-shaped outline reaches from its middle at each angle, as a function of the angle.
// Corners are [angle, reach] pairs in increasing angle order.
export function polygonReach(corners) {
  return (a) => {
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const n = corners.length;
    for (let i = 0; i < n; i++) {
      const [a0, r0] = corners[i];
      const [a1raw, r1] = corners[(i + 1) % n];
      const a1 = i + 1 === n ? a1raw + Math.PI * 2 : a1raw;
      const at = a < a0 ? a + Math.PI * 2 : a;
      if (at < a0 || at > a1) continue;
      // The ray from the middle at angle `at` meets the edge between the two corners.
      const x0 = Math.cos(a0) * r0;
      const y0 = Math.sin(a0) * r0;
      const x1 = Math.cos(a1) * r1;
      const y1 = Math.sin(a1) * r1;
      const dx = Math.cos(at);
      const dy = Math.sin(at);
      const ex = x1 - x0;
      const ey = y1 - y0;
      const den = dx * ey - dy * ex;
      return Math.abs(den) < 1e-9 ? r0 : (x0 * ey - y0 * ex) / den;
    }
    return corners[0][1];
  };
}

// A jagged outline: a handful of broken corners, the edges between them wandering a little.
export function jaggedOutline(r, corners, irregular) {
  const pts = [];
  for (let i = 0; i < corners; i++) {
    pts.push([(i + 0.5 + (r() - 0.5) * 0.7) / corners * Math.PI * 2, 1 - irregular * r()]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const reach = polygonReach(pts);
  const waves = Array.from({ length: 5 }, (_, k) => [k + 2, r() * 6.28, (r() - 0.5) * 0.05 / (k + 1)]);
  return (a) => reach(a) * (1 + waves.reduce((s, [f, p, amp]) => s + Math.sin(a * f + p) * amp, 0));
}

// A smooth, closed, weathered block of ice, built in its own frame with the waterline at y = 0: a snowy top swelling
// up over rounded shoulders, cliffs grooved by meltwater, a wave-cut notch at the waterline, and a broad keel below
// that tapers to a rounded bottom, its deepest point pushed off to one side by `lean`. `reach(angle)` scales the
// outline; the bulk is `width` by `depth`.
// Returns the geometry and `topAt(x, z)`, the height of the snow surface over a point well inside the top.
export function iceBlock(r, o) {
  const {
    reach, width, depth, top, draft, dome = 0.1, bulge = 0.15, blunt = 2, rough = 1, topRough = 1, lean = 0, cuts = [],
    segments = 96,
    capRows = 10, cliffRows = 6, keelRows = 16,
  } = o;
  const hx = width / 2;
  const hz = depth / 2;
  const size = Math.min(hx, hz);
  const ox = r() * 200;
  const oy = r() * 200;
  const oz = r() * 200;
  const round = Math.min(top * 0.35, 0.8, size * 0.3);
  const shoulderScale = round / ((hx + hz) / 2);
  const capTop = top - round;
  const domeHeight = dome * top;
  const batter = 0.04;
  const rows = [];
  for (let k = 1; k <= capRows; k++) {
    const p = k / capRows;
    rows.push({ scale: p * (1 - shoulderScale), y: capTop + domeHeight * (1 - p * p), up: 1, cap: true });
  }
  for (let k = 1; k <= 3; k++) {
    const a = (k / 3) * Math.PI / 2;
    rows.push({ scale: 1 - shoulderScale * (1 - Math.sin(a)), y: capTop - round * (1 - Math.cos(a)), up: Math.cos(a) });
  }
  const cliffTop = capTop - round;
  for (let k = 1; k <= cliffRows; k++) {
    const y = cliffTop * (1 - k / cliffRows);
    rows.push({ scale: 1 + batter * (1 - y / Math.max(cliffTop, 0.01)), y, up: 0 });
  }
  for (let k = 1; k < keelRows; k++) {
    const t = Math.pow(k / keelRows, 1.15);
    const y = -draft * t;
    // Waves wear a notch in just below the waterline.
    const notch = 1 - 0.07 * Math.exp(-(((y + Math.min(0.35, draft * 0.15)) / Math.min(0.3, draft * 0.12)) ** 2));
    const profile = (1 + bulge * Math.sin(Math.PI * Math.min(1, t * 1.3))) * Math.pow(1 - Math.pow(t, blunt), 1 / blunt);
    rows.push({ scale: (1 + batter) * profile * notch, y, up: -Math.pow(t, 3), shift: lean * t * t });
  }
  const outline = new Float32Array(segments);
  for (let i = 0; i < segments; i++) outline[i] = reach((i / segments) * Math.PI * 2);

  // The snowy top swells and dips gently; the sides carry broad lumps, vertical meltwater grooves on the cliffs,
  // and smaller knobbly detail everywhere.
  const lump = size * 0.09 * rough;
  const displace = (x, y, z, up) => {
    const big = fbm(x * 0.09 + ox, y * 0.09 + oy, z * 0.09 + oz, 3);
    const small = fbm(x * 0.45 + ox, y * 0.45 + oy, z * 0.45 + oz, 3);
    if (up >= 1) return (big * top * 0.22 + small * 0.08) * topRough;
    const grooves = y > -1 ? noise3(x * 0.9 + ox, y * 0.06, z * 0.9 + oz) * 0.22 * rough * Math.min(1, top) : 0;
    return big * lump + small * 0.22 * rough + grooves;
  };
  const position = [];
  const v = new THREE.Vector3();
  const pushVertex = (x, y, z, up) => {
    const d = displace(x, y, z, up);
    const radial = Math.hypot(x, z);
    const horizontal = 1 - Math.abs(up);
    // Thin parts of the keel near its bottom cannot be pushed in further than they are wide.
    const limit = Math.min(1, radial / Math.max(size * 0.4, 0.01));
    v.set(radial > 1e-6 ? (x / radial) * horizontal : 0, up, radial > 1e-6 ? (z / radial) * horizontal : 0).normalize();
    position.push(x + v.x * d * limit, y + v.y * d * (up > 0 ? 1 : limit), z + v.z * d * limit);
  };
  pushVertex(0, capTop + domeHeight, 0, 1);
  for (const row of rows) {
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      pushVertex(Math.cos(a) * hx * outline[i] * row.scale + (row.shift ?? 0) * hx, row.y,
        Math.sin(a) * hz * outline[i] * row.scale, row.up);
    }
  }
  pushVertex(lean * hx, -draft, 0, -1);
  // Calving leaves flat fracture faces: each cut shears off everything beyond a plane, `keep` of the way out from the
  // middle to the farthest point in that direction.
  const planes = cuts.map(({ dir, keep }) => {
    const n = new THREE.Vector3(...dir).normalize();
    let reachOut = 0;
    for (let i = 0; i < position.length; i += 3) {
      reachOut = Math.max(reachOut, n.x * position[i] + n.y * position[i + 1] + n.z * position[i + 2]);
    }
    return { n, c: reachOut * keep };
  });
  for (const { n, c } of planes) {
    for (let i = 0; i < position.length; i += 3) {
      const d = n.x * position[i] + n.y * position[i + 1] + n.z * position[i + 2] - c;
      if (d <= 0) continue;
      position[i] -= n.x * d;
      position[i + 1] -= n.y * d;
      position[i + 2] -= n.z * d;
    }
  }
  const index = [];
  const ring = (k, i) => 1 + k * segments + (i % segments);
  for (let i = 0; i < segments; i++) index.push(0, ring(0, i + 1), ring(0, i));
  for (let k = 0; k < rows.length - 1; k++) {
    for (let i = 0; i < segments; i++) {
      index.push(ring(k, i), ring(k, i + 1), ring(k + 1, i));
      index.push(ring(k, i + 1), ring(k + 1, i + 1), ring(k + 1, i));
    }
  }
  const bottom = position.length / 3 - 1;
  const last = rows.length - 1;
  for (let i = 0; i < segments; i++) index.push(ring(last, i), ring(last, i + 1), bottom);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();

  const topAt = (x, z) => {
    const a = Math.atan2(z / hz, x / hx);
    const f = (((a / (Math.PI * 2)) % 1) + 1) % 1 * segments;
    const i = Math.floor(f);
    const out = THREE.MathUtils.lerp(outline[i % segments], outline[(i + 1) % segments], f - i);
    const p = Math.min(1, Math.hypot(x / hx, z / hz) / out / (1 - shoulderScale));
    const y = capTop + domeHeight * (1 - p * p);
    let surface = y + displace(x, y, z, 1);
    for (const { n, c } of planes) {
      if (n.y > 0.2) surface = Math.min(surface, (c - n.x * x - n.z * z) / n.y);
    }
    return surface;
  };
  // Whether a point on the top lies at least `margin` in from every edge on fairly level snow, where something can
  // stand.
  const walkable = (x, z, margin) => {
    const a = Math.atan2(z / hz, x / hx);
    const f = (((a / (Math.PI * 2)) % 1) + 1) % 1 * segments;
    const i = Math.floor(f);
    const out = THREE.MathUtils.lerp(outline[i % segments], outline[(i + 1) % segments], f - i);
    const r = Math.hypot(x / hx, z / hz) * size;
    if (r > out * (1 - shoulderScale) * size - margin) return false;
    const y = topAt(x, z);
    // Nothing stands on a steep slope.
    if (Math.hypot(topAt(x + 0.5, z) - topAt(x - 0.5, z), topAt(x, z + 0.5) - topAt(x, z - 0.5)) > 0.3) return false;
    return planes.every(({ n, c }) => n.y > 0.5 || n.x * x + n.y * y + n.z * z <= c - margin);
  };
  return { geometry: geo, topAt, walkable };
}

// The lowest point of the geometry's surface above each step along x in the plane z = zPlane, by slicing every
// triangle that crosses the plane. Steps with nothing above them are Infinity.
export function undersideAlong(geo, zPlane, x0, step, count) {
  const samples = new Array(count).fill(Infinity);
  const pos = geo.attributes.position.array;
  const idx = geo.index.array;
  const pts = [];
  for (let t = 0; t < idx.length; t += 3) {
    pts.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e] * 3;
      const b = idx[t + ((e + 1) % 3)] * 3;
      const za = pos[a + 2] - zPlane;
      const zb = pos[b + 2] - zPlane;
      if ((za < 0) === (zb < 0)) continue;
      const k = za / (za - zb);
      pts.push(pos[a] + (pos[b] - pos[a]) * k, pos[a + 1] + (pos[b + 1] - pos[a + 1]) * k);
    }
    if (pts.length < 4) continue;
    let [xa, ya, xb, yb] = pts;
    if (xa > xb) [xa, ya, xb, yb] = [xb, yb, xa, ya];
    const from = Math.max(0, Math.ceil((xa - x0) / step));
    const to = Math.min(count - 1, Math.floor((xb - x0) / step));
    for (let s = from; s <= to; s++) {
      const x = x0 + s * step;
      const y = xb - xa > 1e-6 ? ya + (yb - ya) * ((x - xa) / (xb - xa)) : Math.min(ya, yb);
      if (y < samples[s]) samples[s] = y;
    }
  }
  return samples;
}

const loader = new THREE.TextureLoader();
function iceTexture(name) {
  const t = loader.load(`${import.meta.env.BASE_URL}textures/${name}`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}
let textures = null;

// Ice that looks like ice, from photographed snow (Poly Haven, CC0): soft packed snow on whatever faces up,
// wind-streaked snow on the walls, pale blue in the shaded hollows. Below the waterline it is smooth, wet,
// translucent ice, pale aqua near the surface and deepening to teal, glowing faintly where light passes through.
// Everything is worked out from the surface's own position and facing, so it needs no UVs and stays put on ice that
// moves. `bob` makes each piece of a merged field of pack ice rock on the swell on its own; `snow` makes the whole
// surface packed snow.
export function iceMaterial({ name = 'ice', bob = false, snow = false } = {}) {
  textures ??= {
    softAlbedo: iceTexture('snow_soft_albedo.webp'), softNormal: iceTexture('snow_soft_normal.webp'),
    windAlbedo: iceTexture('snow_wind_albedo.webp'), windNormal: iceTexture('snow_wind_normal.webp'),
  };
  const mat = new THREE.MeshStandardMaterial({ name, roughness: 0.6, metalness: 0, envMapIntensity: 1 });
  const time = { value: 0 };
  mat.userData.time = time;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSoftAlbedo = { value: textures.softAlbedo };
    shader.uniforms.uSoftNormal = { value: textures.softNormal };
    shader.uniforms.uWindAlbedo = { value: textures.windAlbedo };
    shader.uniforms.uWindNormal = { value: textures.windNormal };
    shader.uniforms.uIceTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vIcePos;
        varying vec3 vIceNormal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        ${bob ? 'attribute vec4 aPlate;\nuniform float uIceTime;' : ''}`)
      .replace('#include <begin_vertex>', /* glsl */ `#include <begin_vertex>
        vIcePos = position;
        vIceNormal = normal;
        ${bob ? /* glsl */ `
        float tiltX = sin( uIceTime * 0.9 + aPlate.w ) * 0.02 * aPlate.z;
        float tiltZ = cos( uIceTime * 0.8 + aPlate.w * 1.3 ) * 0.02 * aPlate.z;
        transformed.y += ( sin( uIceTime * 1.1 + aPlate.w ) * 0.04 + ( position.x - aPlate.x ) * tiltZ
          + ( position.z - aPlate.y ) * tiltX ) * aPlate.z;` : ''}
        mat3 iceBasis = mat3( 1.0 );
        #ifdef USE_INSTANCING
          iceBasis = mat3( instanceMatrix );
        #endif
        vAxisX = normalize( normalMatrix * ( iceBasis * vec3( 1.0, 0.0, 0.0 ) ) );
        vAxisY = normalize( normalMatrix * ( iceBasis * vec3( 0.0, 1.0, 0.0 ) ) );
        vAxisZ = normalize( normalMatrix * ( iceBasis * vec3( 0.0, 0.0, 1.0 ) ) );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        uniform sampler2D uSoftAlbedo;
        uniform sampler2D uSoftNormal;
        uniform sampler2D uWindAlbedo;
        uniform sampler2D uWindNormal;
        varying vec3 vIcePos;
        varying vec3 vIceNormal;
        varying vec3 vAxisX;
        varying vec3 vAxisY;
        varying vec3 vAxisZ;
        vec3 iceGlow;`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        {
          vec3 n0 = normalize( vIceNormal );
          vec3 w = pow( abs( n0 ), vec3( 6.0 ) );
          w /= w.x + w.y + w.z;
          float h = vIcePos.y;
          float above = smoothstep( -0.15, 0.15, h );
          // Walls take the wind-streaked snow, running up and down them; tops take the soft snow.
          vec2 uvX = vec2( vIcePos.z, vIcePos.y * 0.6 ) * 0.22;
          vec2 uvZ = vec2( vIcePos.x, vIcePos.y * 0.6 ) * 0.22;
          vec2 uvY = vIcePos.xz * 0.3;
          float albedo = texture2D( uWindAlbedo, uvX ).r * w.x + texture2D( uSoftAlbedo, uvY ).r * w.y
            + texture2D( uWindAlbedo, uvZ ).r * w.z;
          vec2 dx = texture2D( uWindNormal, uvX ).rg * 2.0 - 1.0;
          vec2 dy = texture2D( uSoftNormal, uvY ).rg * 2.0 - 1.0;
          vec2 dz = texture2D( uWindNormal, uvZ ).rg * 2.0 - 1.0;
          // Underwater the ice is melted smooth into broad, shallow hollows.
          vec3 big = vIcePos * 0.06;
          vec2 bx = texture2D( uSoftNormal, big.zy ).rg * 2.0 - 1.0;
          vec2 by = texture2D( uSoftNormal, big.xz ).rg * 2.0 - 1.0;
          vec2 bz = texture2D( uSoftNormal, big.xy ).rg * 2.0 - 1.0;
          vec3 fine = vec3( 0.0, dx.y, dx.x ) * w.x + vec3( dy.x, 0.0, dy.y ) * w.y + vec3( dz.x, dz.y, 0.0 ) * w.z;
          vec3 broad = vec3( 0.0, bx.y, bx.x ) * w.x + vec3( by.x, 0.0, by.y ) * w.y + vec3( bz.x, bz.y, 0.0 ) * w.z;
          vec3 n = normalize( n0 + fine * mix( 0.15, 1.0, above ) + broad * mix( 1.6, 0.3, above ) );
          normal = normalize( n.x * vAxisX + n.y * vAxisY + n.z * vAxisZ );
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif

          float snowy = ${snow ? '1.0' : 'smoothstep( 0.5, 0.85, n0.y )'};
          float lum = smoothstep( 0.25, 0.95, albedo );
          // Shaded hollows and the ice of the walls pick up the blue of the ice beneath the snow.
          vec3 wall = mix( vec3( 0.48, 0.66, 0.74 ), vec3( 0.8, 0.86, 0.9 ), lum );
          vec3 snowColor = mix( vec3( 0.66, 0.74, 0.8 ), vec3( 0.86, 0.9, 0.93 ), lum );
          // Kept below full white, so sunlit snow stays clear of the bloom threshold.
          vec3 top = mix( wall, snowColor, snowy ) * 0.7;
          float deep = clamp( -h / 12.0, 0.0, 1.0 );
          vec3 under = mix( vec3( 0.5, 0.8, 0.82 ), vec3( 0.1, 0.38, 0.46 ), sqrt( deep ) );
          // Faces turned up to the light from the surface glow; overhangs and undersides fall into deep teal shadow.
          under *= mix( 0.45, 1.15, smoothstep( -0.8, 0.7, n.y ) );
          diffuseColor.rgb = mix( under, top, above );
          roughnessFactor = mix( 0.12, mix( 0.55, 0.9, snowy ), above );
          // Light scattering through the ice: strongest at grazing angles and in the clear ice under the water.
          float rim = 1.0 - abs( dot( normal, normalize( vViewPosition ) ) );
          iceGlow = vec3( 0.05, 0.3, 0.34 ) * ( 0.35 + 0.65 * rim * rim ) * ( 1.0 - deep * 0.7 ) * ( 1.0 - above );
        }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += iceGlow;');
  };
  mat.customProgramCacheKey = () => `${name}-${bob}-${snow}`;
  return mat;
}
