import * as THREE from 'three';

// Procedural surface detail layered onto the flat Blender materials: mottled paint, scratches, grime,
// rust, stone cracks, wood grain, and matching bump relief. Each material name maps to a profile.
const PROFILE_BY_MATERIAL = {
  paint: ['yellow', 'yellow_dark', 'red', 'orange', 'white', 'blue', 'blue_dark', 'green', 'green_dark', 'olive',
    'duck', 'pink', 'skull'],
  metal: ['steel', 'steel_dark', 'gunmetal', 'brass', 'gold', 'gold_dark', 'missile_body'],
  enemy: ['enemy_hull', 'enemy_plate', 'enemy_red', 'mine'],
  stone: ['stone', 'stone_dark'],
  moss: ['moss'],
  wood: ['wood', 'wood_dark'],
  rock: ['rock'],
  rust: ['rust', 'rust_patch'],
  enemy_old: ['wreck_hull', 'wreck_red'],
  coral: ['coral_pink', 'coral_purple', 'coral_orange', 'coral_yellow', 'coral_teal', 'coral_red', 'sponge_orange',
    'sponge_purple'],
  weed: ['kelp_stipe', 'kelp_blade', 'kelp_bladder'],
};

const PROFILES = {
  paint: { scale: 2.2, mottle: 0.12, scratch: 0.32, grime: 0.22, rust: 0.0, bump: 0.55, crack: 0.0, rough: 0.12 },
  metal: { scale: 3.0, mottle: 0.1, scratch: 0.45, grime: 0.28, rust: 0.0, bump: 0.45, crack: 0.0, rough: 0.2 },
  enemy: { scale: 2.0, mottle: 0.14, scratch: 0.4, grime: 0.3, rust: 0.55, bump: 0.6, crack: 0.0, rough: 0.2 },
  stone: { scale: 1.4, mottle: 0.28, scratch: 0.0, grime: 0.18, rust: 0.0, bump: 2.0, crack: 0.9, rough: 0.0 },
  moss: { scale: 6.0, mottle: 0.35, scratch: 0.0, grime: 0.2, rust: 0.0, bump: 1.2, crack: 0.0, rough: 0.0 },
  wood: { scale: 2.0, mottle: 0.2, scratch: 0.15, grime: 0.25, rust: 0.0, bump: 0.9, crack: 0.0, rough: 0.0 },
  rock: { scale: 1.6, mottle: 0.35, scratch: 0.0, grime: 0.3, rust: 0.0, bump: 1.5, crack: 0.45, rough: 0.0 },
  enemy_old: { scale: 1.6, mottle: 0.25, scratch: 0.25, grime: 0.4, rust: 0.9, bump: 1.1, crack: 0.0, rough: 0.15 },
  rust: { scale: 2.5, mottle: 0.25, scratch: 0.2, grime: 0.3, rust: 0.8, bump: 1.0, crack: 0.0, rough: 0.1 },
  coral: { scale: 9.0, mottle: 0.25, scratch: 0.0, grime: 0.25, rust: 0.0, bump: 1.4, crack: 0.0, rough: 0.0 },
  weed: { scale: 4.0, mottle: 0.22, scratch: 0.0, grime: 0.2, rust: 0.0, bump: 0.6, crack: 0.0, rough: 0.0 },
};

export const NOISE_GLSL = /* glsl */ `
float dHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float dNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( dHash( i ), dHash( i + vec3( 1, 0, 0 ) ), f.x ),
                   mix( dHash( i + vec3( 0, 1, 0 ) ), dHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( dHash( i + vec3( 0, 0, 1 ) ), dHash( i + vec3( 1, 0, 1 ) ), f.x ),
                   mix( dHash( i + vec3( 0, 1, 1 ) ), dHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float dFbm( vec3 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 3; i++ ) {
    v += a * dNoise( p );
    p = p * 2.03 + vec3( 1.7, 9.2, 3.1 );
    a *= 0.5;
  }
  return v;
}
vec3 dPerturb( vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir ) {
  vec3 sx = normalize( dFdx( surfPos ) );
  vec3 sy = normalize( dFdy( surfPos ) );
  vec3 r1 = cross( sy, surfNorm );
  vec3 r2 = cross( surfNorm, sx );
  float det = dot( sx, r1 ) * faceDir;
  vec3 grad = sign( det ) * ( dHdxy.x * r1 + dHdxy.y * r2 );
  return normalize( abs( det ) * surfNorm - grad );
}
`;

function f(v) {
  return v.toFixed(3);
}

// Builds the detail shader for one material profile, emitting only the terms whose weights are non-zero.
function detailShader(p, kind) {
  const has = { scratch: p.scratch > 0, crack: p.crack > 0, rust: p.rust > 0, grime: p.grime > 0 };
  const decl = [`vec3 dp = vDetailPos * ${f(p.scale)};`, 'float dMottle = dFbm( dp );'];
  decl.push(has.grime || kind === 'stone' || kind === 'rock' ? 'float dLow = dFbm( dp * 0.35 + 4.0 );' : 'float dLow = 0.0;');
  if (has.scratch) {
    decl.push(`float dScratchMask = smoothstep( 0.5, 0.68, dNoise( dp * 0.7 + 11.0 ) );
      float dScratch = ( 1.0 - smoothstep( 0.0, 0.035, abs( dNoise( dp * vec3( 9.0, 1.3, 9.0 ) ) - 0.5 ) ) ) * dScratchMask;`);
  } else decl.push('float dScratch = 0.0;');
  decl.push(has.crack ? 'float dCrack = 1.0 - smoothstep( 0.0, 0.035, abs( dFbm( dp * 1.3 + 7.0 ) - 0.5 ) );' : 'float dCrack = 0.0;');
  decl.push(has.rust ? `float dRust = smoothstep( 0.55, 0.75, dNoise( dp * 0.9 + 21.0 ) ) * ${f(p.rust)};` : 'float dRust = 0.0;');
  decl.push(kind === 'wood' ? 'float dGrain = 0.5 + 0.5 * sin( dp.x * 26.0 + dNoise( dp * vec3( 0.5, 3.0, 3.0 ) ) * 9.0 );' : 'float dGrain = 0.0;');
  decl.push(kind === 'weed' ? 'float dVein = 1.0 - smoothstep( 0.0, 0.12, abs( fract( dp.y * 1.5 + dMottle ) - 0.5 ) );' : 'float dVein = 0.0;');
  decl.push(kind === 'coral' ? 'float dPore = smoothstep( 0.62, 0.72, dNoise( dp * 1.8 ) );' : 'float dPore = 0.0;');

  const color = [`diffuseColor.rgb *= 1.0 + ( dMottle - 0.5 ) * 2.0 * ${f(p.mottle)};`];
  if (has.grime) {
    color.push(`vec3 dWorldN = inverseTransformDirection( normalize( vNormal ), viewMatrix );
      diffuseColor.rgb *= 1.0 - ${f(p.grime)} * ( smoothstep( 0.45, 0.8, dLow ) * 0.6 + smoothstep( 0.1, -0.9, dWorldN.y ) * 0.7 );`);
  }
  if (has.rust) color.push('diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 0.75, 0.5 ) + vec3( 0.06, 0.02, 0.0 ), dRust );');
  if (has.scratch) color.push(`diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.8, 0.82 ) * ( 0.6 + 0.4 * dMottle ), dScratch * ${f(p.scratch)} );`);
  if (has.crack) color.push(`diffuseColor.rgb *= 1.0 - dCrack * ${f(p.crack)} * 0.7;`);
  if (kind === 'wood' || kind === 'coral') color.push('diffuseColor.rgb *= 1.0 - dGrain * 0.28 - dPore * 0.35;');
  if (kind === 'weed') color.push('diffuseColor.rgb *= 1.0 + dVein * 0.18;');
  if (kind === 'stone' || kind === 'rock') {
    // Weathered underwater masonry: per-block tone, granite speckle, pitting, algae streaks running down, and
    // pale encrusting spots, with moss gathering on upward faces.
    decl.push(`vec3 dUpN = inverseTransformDirection( normalize( vNormal ), viewMatrix );
      float sBlock = dNoise( floor( vDetailPos * 1.15 + 0.5 ) * 3.7 );
      float sSpeck = dNoise( dp * 9.0 );
      float sPit = smoothstep( 0.6, 0.85, dNoise( dp * 4.5 + 9.0 ) ) * smoothstep( 0.5, 0.8, dNoise( dp * 1.3 + 4.0 ) );
      float sStreak = smoothstep( 0.45, 0.85, dNoise( vec3( dp.x * 5.0, dp.y * 0.45, dp.z * 5.0 ) + 2.0 ) )
        * smoothstep( 0.2, 0.7, dLow );`);
    color.push(`diffuseColor.rgb *= 0.9 + sBlock * 0.4;
      diffuseColor.rgb *= 0.9 + sSpeck * 0.2;
      diffuseColor.rgb *= 1.0 - sPit * 0.35;
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.75, 0.6 ), sStreak * 0.6 * ( 1.0 - max( dUpN.y, 0.0 ) ) );
      diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.18, 0.36, 0.12 ), smoothstep( 0.55, 0.9, dUpN.y ) * smoothstep( 0.45, 0.62, dLow ) * 0.85 );`);
  }
  return { decl: decl.join('\n'), color: color.join('\n') };
}

function patch(material, profileName) {
  const p = PROFILES[profileName];
  const code = detailShader(p, profileName);
  material.customProgramCacheKey = () => `detail-${profileName}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDetailPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${code.decl}\n${code.color}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor + ( dMottle - 0.5 ) * ${f(p.rough * 2)} + dScratch * ${f(p.scratch * 0.3)} + dRust * 0.4, 0.04, 1.0 );`)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        float dHeight = dMottle * 0.35 - dScratch * 0.5 - dCrack * ${f(p.crack * 0.9)} + dGrain * 0.5 - dPore * 0.8
          + dRust * dMottle * 0.6${profileName === 'stone' || profileName === 'rock' ? ' + sSpeck * 0.25 - sPit * 0.7' : ''};
        normal = dPerturb( - vViewPosition, normal, vec2( dFdx( dHeight ), dFdy( dHeight ) ) * ${f(p.bump * 0.12)}, faceDirection );`);
  };
  material.needsUpdate = true;
}

// Viewport glass: clear in the middle, mirror-bright at grazing angles, with sharp environment reflections.
function glass(color, opacity) {
  const m = new THREE.MeshPhysicalMaterial({
    color, transparent: true, opacity, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02,
    envMapIntensity: 2.5, depthWrite: false, side: THREE.FrontSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', /* glsl */ `
      float glassFresnel = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
      diffuseColor.a = mix( diffuseColor.a, 1.0, glassFresnel * 0.85 );
      outgoingLight += vec3( 0.6, 0.9, 1.0 ) * glassFresnel * 0.35;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'viewport-glass';
  return m;
}

// Shared clock for animated surface effects; main bumps it every frame.
export const SHADER_TIME = { value: 0 };

const REPLACEMENTS = {
  viewport_glass: () => glass('#bff3ff', 0.18),
  enemy_glass: () => glass('#7a2a2a', 0.35),
};

const lookup = new Map();
for (const [profile, names] of Object.entries(PROFILE_BY_MATERIAL)) for (const n of names) lookup.set(n, profile);

const patched = new WeakSet();

// Subs look different either side of the waterline: tinted and softened underwater, and glossy, darker, and
// streaked with running water above it while they are still wet.
export const WATER = { surface: { value: 26 }, wet: { value: 0 } };

const WATERLINE_GLSL = /* glsl */ `
  float wHash( vec3 p ) {
    p = fract( p * 0.3183099 + 0.1 );
    p *= 17.0;
    return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
  }
  float wNoise( vec3 x ) {
    vec3 i = floor( x );
    vec3 f = fract( x );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( mix( wHash( i ), wHash( i + vec3( 1, 0, 0 ) ), f.x ),
                     mix( wHash( i + vec3( 0, 1, 0 ) ), wHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
                mix( mix( wHash( i + vec3( 0, 0, 1 ) ), wHash( i + vec3( 1, 0, 1 ) ), f.x ),
                     mix( wHash( i + vec3( 0, 1, 1 ) ), wHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
  }
`;

// `ripple` scales the caustic light; `topOnly` keeps it to surfaces facing up toward the sun.
export function addWaterline(material, { ripple = 1, topOnly = false } = {}) {
  if (material.userData.waterline) return;
  material.userData.waterline = true;
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.() ?? material.name;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uSurface = WATER.surface;
    shader.uniforms.uWet = WATER.wet;
    shader.uniforms.uTime = SHADER_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWaterPos;
        uniform float uSurface, uWet, uTime;
        ${WATERLINE_GLSL}`)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        float above = smoothstep( uSurface - 0.05, uSurface + 0.08, vWaterPos.y );
        vec3 wp = vWaterPos;
        float runs = smoothstep( 0.62, 0.82, wNoise( vec3( wp.x * 9.0, wp.y * 0.9 + uTime * 1.1, wp.z * 9.0 ) ) );
        float beads = smoothstep( 0.72, 0.8, wNoise( wp * 14.0 + vec3( 0.0, uTime * 0.4, 0.0 ) ) );
        float wet = above * uWet;
        diffuseColor.rgb *= mix( 1.0, 0.64 - runs * 0.15, wet );
        roughnessFactor = mix( roughnessFactor, mix( 0.08, 0.02, max( runs, beads ) ), wet );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.55, 0.8, 0.95 ) + vec3( 0.0, 0.03, 0.06 ),
          1.0 - above );`)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        float meniscus = smoothstep( uSurface + 0.18, uSurface + 0.02, vWaterPos.y ) * above;
        totalEmissiveRadiance += vec3( 0.55, 0.8, 0.9 ) * meniscus * 0.35 * uWet;
        totalEmissiveRadiance += vec3( 0.7, 0.85, 0.9 ) * max( runs, beads ) * wet * 0.12;
        vec3 cp = vec3( wp.x * 2.2 + uTime * 0.25, wp.y * 2.2 - uTime * 0.5, wp.z * 2.2 );
        float ripple = pow( 1.0 - abs( wNoise( cp ) * 2.0 - 1.0 ), 7.0 ) + pow( 1.0 - abs( wNoise( cp * 1.9 + 5.0 ) * 2.0 - 1.0 ), 9.0 ) * 0.6;
        float shallow = smoothstep( uSurface - 26.0, uSurface - 1.0, wp.y );
        float lit = ${topOnly ? 'smoothstep( -0.1, 0.55, inverseTransformDirection( normal, viewMatrix ).y )' : '1.0'};
        totalEmissiveRadiance += vec3( 0.45, 0.85, 0.95 ) * ripple * ( 1.0 - above ) * shallow * lit * ${(0.22 * ripple).toFixed(3)};`);
  };
  material.customProgramCacheKey = () => `${key}-waterline${topOnly ? '-top' : ''}${ripple}`;
  material.needsUpdate = true;
}

// The anglerfish swims by bending the rear of its body in a travelling wave, fading out toward the head so the
// jaws, eyes, and lure stay steady.
// Its lower jaw hinges at the back of the gape and slowly works open and shut as an idle chew.
const JAW_HINGE = [0.2, -0.1];
const SWAY_GLSL = /* glsl */ `
  float swaySeed = modelMatrix[ 3 ].x * 0.37 + modelMatrix[ 3 ].y * 0.21;
  float jawW = smoothstep( 0.1, 0.5, transformed.x ) * smoothstep( -0.02, -0.2, transformed.y );
  float jawA = 0.09 * sin( uTime * 0.8 + swaySeed * 1.7 ) * jawW;
  vec2 jawP = transformed.xy - vec2( ${JAW_HINGE[0]}, ${JAW_HINGE[1]} );
  transformed.xy = vec2( ${JAW_HINGE[0]}, ${JAW_HINGE[1]} )
    + vec2( cos( jawA ) * jawP.x + sin( jawA ) * jawP.y, -sin( jawA ) * jawP.x + cos( jawA ) * jawP.y );
  float swayRear = smoothstep( 0.3, -1.7, transformed.x );
  transformed.z += sin( uTime * 3.0 - transformed.x * 2.2 + swaySeed ) * 0.42 * swayRear * swayRear;
`;

function addSway(material) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.() ?? material.name;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uTime = SHADER_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`);
  };
  material.customProgramCacheKey = () => `${key}-sway`;
  material.needsUpdate = true;
}

// The humpback has no rig: a slow wave runs down its body from the chest to the flukes, which beat up and down the
// most. The model is one unit long with its head along +X.
// How far the whale's body curves sideways, set each frame by the world: into a C as it turns, a slow sway otherwise.
export const WHALE_BEND = { value: 0 };
const WHALE_GLSL = /* glsl */ `
  transformed.z += uWhaleBend * transformed.x * transformed.x * 4.0;
  float whaleRear = smoothstep( 0.15, -0.5, transformed.x );
  // The head is at +X, so the phase grows with x to send the wave back toward the flukes.
  float whalePhase = uTime * 1.1 + transformed.x * 5.5;
  transformed.y += sin( whalePhase ) * 0.05 * whaleRear * whaleRear;
  transformed.y += sin( uTime * 1.1 + 1.2 ) * 0.006 * smoothstep( 0.1, 0.4, abs( transformed.z ) );
`;

function addWhaleSwim(material) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.() ?? material.name;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uTime = SHADER_TIME;
    shader.uniforms.uWhaleBend = WHALE_BEND;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWhaleBend;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WHALE_GLSL}`);
  };
  material.customProgramCacheKey = () => `${key}-whale`;
  material.needsUpdate = true;
}

// A swimming beat for unrigged creatures one unit long with the head along +X. The whole body undulates gently and
// the tail stock and flukes swing the most, all in one rhythm. `controls` holds per-copy uniforms: `beat` scales the
// motion (0 stops it, say while airborne) and `phase` offsets its timing.
export function addTailBeat(material, { rate = 6, amount = 0.06, controls = null } = {}) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.() ?? material.name;
  const own = controls ?? { beat: { value: 1 }, phase: { value: 0 } };
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uTime = SHADER_TIME;
    shader.uniforms.uBeat = own.beat;
    shader.uniforms.uBeatPhase = own.phase;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uBeat;\nuniform float uBeatPhase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float beatA = uTime * ${rate.toFixed(2)} + uBeatPhase;
        // The bend grows steadily from the head back to the flukes, so the whole body rides the same wave.
        float beatAlong = smoothstep( 0.5, -0.5, transformed.x );
        float beatWave = sin( beatA + transformed.x * 2.4 );
        transformed.y += beatWave * uBeat * ${amount.toFixed(3)} * mix( 0.3, 1.0, pow( beatAlong, 2.0 ) );`);
  };
  material.customProgramCacheKey = () => `${key}-tail${rate}`;
  material.needsUpdate = true;
}

// Kelp and anemone tentacles bend in the current: still at the root, swaying more with height.
export const CURRENT_MATERIALS = new Set(['kelp_stipe', 'kelp_blade', 'kelp_bladder', 'anemone_tentacle', 'anemone_tip']);
const CURRENT_GLSL = /* glsl */ `
  float curH = max( transformed.y - aBase, 0.0 );
  float curSeed = ( modelMatrix[ 3 ].x + transformed.x ) * 0.31 + ( modelMatrix[ 3 ].z + transformed.z ) * 0.17;
  float curBend = pow( curH, 1.25 );
  transformed.x += sin( uTime * 0.9 + curSeed + curH * 0.35 ) * 0.07 * curBend;
  transformed.z += cos( uTime * 0.7 + curSeed * 1.7 + curH * 0.3 ) * 0.04 * curBend;
`;

function addCurrent(material) {
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey?.() ?? material.name;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uTime = SHADER_TIME;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aBase;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${CURRENT_GLSL}`);
  };
  material.customProgramCacheKey = () => `${key}-current`;
  material.needsUpdate = true;
}

const replaced = new Map();
const swaying = new WeakSet();

export function applySurfaceDetail(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.material.name;
    const make = REPLACEMENTS[name];
    if (make) {
      if (!replaced.has(name)) {
        const m = make();
        m.name = name;
        replaced.set(name, m);
      }
      o.material = replaced.get(name);
      if (o.material.transparent) o.renderOrder = 2;
    } else if (!patched.has(o.material) && lookup.has(name)) {
      patch(o.material, lookup.get(name));
      patched.add(o.material);
    }
    if (name.startsWith('angler_') && !swaying.has(o.material)) {
      addSway(o.material);
      swaying.add(o.material);
    }
    if (name.startsWith('whale_') && !swaying.has(o.material)) {
      addWhaleSwim(o.material);
      // The rippling sunlight the subs catch underwater, softer and only across its back.
      addWaterline(o.material, { ripple: 0.6, topOnly: true });
      swaying.add(o.material);
    }
    if (CURRENT_MATERIALS.has(name) && !swaying.has(o.material)) {
      addCurrent(o.material);
      swaying.add(o.material);
    }
  });
}
