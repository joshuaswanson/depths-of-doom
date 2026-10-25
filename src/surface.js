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
  coral: ['coral_pink', 'coral_purple', 'coral_orange'],
  weed: ['seaweed', 'seaweed_dark'],
  angler: ['angler_skin', 'angler_belly', 'angler_fin'],
};

const PROFILES = {
  paint: { scale: 2.2, mottle: 0.12, scratch: 0.32, grime: 0.22, rust: 0.0, bump: 0.55, crack: 0.0, rough: 0.12 },
  metal: { scale: 3.0, mottle: 0.1, scratch: 0.45, grime: 0.28, rust: 0.0, bump: 0.45, crack: 0.0, rough: 0.2 },
  enemy: { scale: 2.0, mottle: 0.14, scratch: 0.4, grime: 0.3, rust: 0.55, bump: 0.6, crack: 0.0, rough: 0.2 },
  stone: { scale: 1.4, mottle: 0.32, scratch: 0.0, grime: 0.35, rust: 0.0, bump: 1.4, crack: 0.75, rough: 0.0 },
  moss: { scale: 6.0, mottle: 0.35, scratch: 0.0, grime: 0.2, rust: 0.0, bump: 1.2, crack: 0.0, rough: 0.0 },
  wood: { scale: 2.0, mottle: 0.2, scratch: 0.15, grime: 0.25, rust: 0.0, bump: 0.9, crack: 0.0, rough: 0.0 },
  rock: { scale: 1.6, mottle: 0.35, scratch: 0.0, grime: 0.3, rust: 0.0, bump: 1.5, crack: 0.45, rough: 0.0 },
  enemy_old: { scale: 1.6, mottle: 0.25, scratch: 0.25, grime: 0.4, rust: 0.9, bump: 1.1, crack: 0.0, rough: 0.15 },
  rust: { scale: 2.5, mottle: 0.25, scratch: 0.2, grime: 0.3, rust: 0.8, bump: 1.0, crack: 0.0, rough: 0.1 },
  coral: { scale: 9.0, mottle: 0.25, scratch: 0.0, grime: 0.25, rust: 0.0, bump: 1.4, crack: 0.0, rough: 0.0 },
  weed: { scale: 4.0, mottle: 0.22, scratch: 0.0, grime: 0.2, rust: 0.0, bump: 0.6, crack: 0.0, rough: 0.0 },
  angler: { scale: 5.0, mottle: 0.3, scratch: 0.0, grime: 0.25, rust: 0.0, bump: 1.3, crack: 0.0, rough: 0.0 },
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
  for ( int i = 0; i < 4; i++ ) {
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

function detailChunk(p, kind) {
  return /* glsl */ `
  vec3 dp = vDetailPos * ${f(p.scale)};
  float dMottle = dFbm( dp );
  float dLow = dFbm( dp * 0.35 + 4.0 );
  float dScratchMask = smoothstep( 0.5, 0.68, dFbm( dp * 0.7 + 11.0 ) );
  float dScratch = ( 1.0 - smoothstep( 0.0, 0.035, abs( dNoise( dp * vec3( 9.0, 1.3, 9.0 ) ) - 0.5 ) ) ) * dScratchMask;
  dScratch += ( 1.0 - smoothstep( 0.0, 0.03, abs( dNoise( dp.zyx * vec3( 1.1, 8.0, 12.0 ) + 3.0 ) - 0.5 ) ) ) * dScratchMask * 0.6;
  float dCrackN = abs( dFbm( dp * 1.3 + 7.0 ) - 0.5 );
  float dCrack = 1.0 - smoothstep( 0.0, 0.035, dCrackN );
  float dRust = smoothstep( 0.55, 0.75, dFbm( dp * 0.9 + 21.0 ) ) * ${f(p.rust)};
  ${kind === 'wood' ? 'float dGrain = 0.5 + 0.5 * sin( dp.x * 26.0 + dFbm( dp * vec3( 0.5, 3.0, 3.0 ) ) * 9.0 );' : 'float dGrain = 0.0;'}
  ${kind === 'weed' ? 'float dVein = 1.0 - smoothstep( 0.0, 0.12, abs( fract( dp.y * 1.5 + dFbm( dp ) ) - 0.5 ) );' : 'float dVein = 0.0;'}
  ${kind === 'coral' ? 'float dPore = smoothstep( 0.62, 0.72, dNoise( dp * 1.8 ) );' : 'float dPore = 0.0;'}
  `;
}

function patch(material, profileName) {
  const p = PROFILES[profileName];
  material.customProgramCacheKey = () => `detail-${profileName}`;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDetailPos = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vDetailPos;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
        ${detailChunk(p, profileName)}
        vec3 dWorldN = inverseTransformDirection( normalize( vNormal ), viewMatrix );
        float dDown = smoothstep( 0.1, -0.9, dWorldN.y );
        diffuseColor.rgb *= 1.0 + ( dMottle - 0.5 ) * 2.0 * ${f(p.mottle)};
        diffuseColor.rgb *= 1.0 - ${f(p.grime)} * ( smoothstep( 0.45, 0.8, dLow ) * 0.6 + dDown * 0.7 );
        diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.25, 0.75, 0.5 ) + vec3( 0.06, 0.02, 0.0 ), dRust );
        diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.78, 0.8, 0.82 ) * ( 0.6 + 0.4 * dMottle ), dScratch * ${f(p.scratch)} );
        diffuseColor.rgb *= 1.0 - dCrack * ${f(p.crack)} * 0.7;
        diffuseColor.rgb *= 1.0 - dGrain * 0.28 - dPore * 0.35;
        diffuseColor.rgb *= 1.0 + dVein * 0.18;
        ${profileName === 'stone' || profileName === 'rock'
          ? 'diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.18, 0.36, 0.12 ), smoothstep( 0.55, 0.9, dWorldN.y ) * smoothstep( 0.45, 0.62, dLow ) * 0.85 );'
          : ''}
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        roughnessFactor = clamp( roughnessFactor + ( dMottle - 0.5 ) * ${f(p.rough * 2)} + dScratch * ${f(p.scratch * 0.3)} + dRust * 0.4, 0.04, 1.0 );
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */ `#include <emissivemap_fragment>
        ${profileName === 'angler'
          ? 'totalEmissiveRadiance += vec3( 0.25, 0.45, 0.6 ) * pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 2.5 ) * 0.35;'
          : ''}
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */ `#include <normal_fragment_maps>
        float dHeight = dMottle * 0.35 - dScratch * 0.5 - dCrack * 0.9 * ${f(p.crack)} + dGrain * 0.5 - dPore * 0.8
          + dNoise( dp * 4.0 ) * 0.25 + dRust * dNoise( dp * 6.0 ) * 0.6;
        vec2 dHdxy = vec2( dFdx( dHeight ), dFdy( dHeight ) ) * ${f(p.bump * 0.12)};
        normal = dPerturb( - vViewPosition, normal, dHdxy, faceDirection );
      `);
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

const REPLACEMENTS = {
  viewport_glass: () => glass('#bff3ff', 0.18),
  enemy_glass: () => glass('#7a2a2a', 0.35),
};

const lookup = new Map();
for (const [profile, names] of Object.entries(PROFILE_BY_MATERIAL)) for (const n of names) lookup.set(n, profile);

const patched = new WeakSet();

const replaced = new Map();

export function applySurfaceDetail(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const make = REPLACEMENTS[o.material.name];
    if (make) {
      if (!replaced.has(o.material.name)) replaced.set(o.material.name, make());
      o.material = replaced.get(o.material.name);
      o.renderOrder = 2;
      return;
    }
    if (patched.has(o.material)) return;
    const profile = lookup.get(o.material.name);
    if (!profile) return;
    patch(o.material, profile);
    patched.add(o.material);
  });
}
