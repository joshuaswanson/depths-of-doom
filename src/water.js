import * as THREE from 'three';

export const CAMERA_FOV = 38;
export const CAMERA_Z = 20;
export const TAN_HALF_FOV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
export const SURFACE_Y = 26;
export const SHELF_Y = -7.6;
export const ABYSS_Y = -210;
// The overhead sunlight's shadow box: half its width, and the depth range it covers along the light.
export const SHADOW_SPAN = 30;
export const SHADOW_NEAR = 1;
export const SHADOW_FAR = 140;

export function depthShift(cameraY) {
  const d = THREE.MathUtils.clamp((cameraY - SHELF_Y) / (SURFACE_Y - SHELF_Y), -1, 1);
  return d * 0.3 - 0.05;
}

// 0 in the sunlit shallows, 1 in the black depths of the trenches.
export function darkness(y) {
  return THREE.MathUtils.smoothstep(-y, 12, 130);
}

const stops = ['#05304f', '#0a5c94', '#1a9bdb', '#6fe6ff'].map((hex) => new THREE.Color(hex));
const deep = ['#000102', '#02050b', '#060410'].map((hex) => new THREE.Color(hex));
const glsl = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

// Screen-height gradient shared by the backdrop and the fog, so fogged props melt into the water behind them.
// The fog's color uniform carries the depth shift (red) and darkness (green), since every fogged material has it.
export const WATER_GRADIENT_GLSL = /* glsl */ `
vec3 waterGradient( float t ) {
  t = clamp( t, 0.0, 1.1 );
  vec3 c = mix( ${glsl(stops[0])}, ${glsl(stops[1])}, smoothstep( 0.0, 0.45, t ) );
  c = mix( c, ${glsl(stops[2])}, smoothstep( 0.4, 0.85, t ) );
  return mix( c, ${glsl(stops[3])}, smoothstep( 0.85, 1.05, t ) );
}
vec3 abyssGradient( float t ) {
  vec3 c = mix( ${glsl(deep[0])}, ${glsl(deep[1])}, smoothstep( 0.0, 0.8, t ) );
  return mix( c, ${glsl(deep[2])}, smoothstep( 0.55, 1.0, t ) * 0.6 );
}
vec3 seaColor( float t, float shift, float dark ) {
  return mix( waterGradient( t + shift ), abyssGradient( t ), dark );
}
`;

export function installWaterFog() {
  const chunks = THREE.ShaderChunk;
  chunks.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogScreenY;
#endif
`;
  chunks.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogScreenY = mvPosition.y / max( - mvPosition.z, 0.001 );
#endif
`;
  chunks.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogScreenY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${WATER_GRADIENT_GLSL}
#endif
`;
  chunks.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  float fogT = clamp( vFogScreenY / ${TAN_HALF_FOV.toFixed(5)} * 0.5 + 0.5, 0.0, 1.0 );
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  #ifdef FOG_CAP
    fogFactor = min( fogFactor, FOG_CAP );
  #endif
  #ifdef FOG_MIN
    fogFactor = max( fogFactor, FOG_MIN );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, seaColor( fogT, fogColor.r, fogColor.g ), fogFactor );
#endif
`;
}
