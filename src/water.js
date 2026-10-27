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
// Polar water: the deep, saturated blue of cold, clear arctic sea, glowing cyan just under the ice and sinking through
// cobalt to navy below.
const icy = ['#010a22', '#04286a', '#0b56b0', '#4fbcf0'].map((hex) => new THREE.Color(hex));
const glsl = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

// Screen-height gradient shared by the backdrop and the fog, so fogged props melt into the water behind them.
// The fog's color uniform carries the depth shift (red), darkness (green) and polar cold (blue), since every fogged
// material has it.
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
vec3 icyGradient( float t ) {
  t = clamp( t, 0.0, 1.1 );
  vec3 c = mix( ${glsl(icy[0])}, ${glsl(icy[1])}, smoothstep( 0.0, 0.45, t ) );
  c = mix( c, ${glsl(icy[2])}, smoothstep( 0.4, 0.85, t ) );
  return mix( c, ${glsl(icy[3])}, smoothstep( 0.85, 1.05, t ) );
}
vec3 seaColor( float t, float shift, float dark, float polar ) {
  vec3 open = polar > 0.0 ? mix( waterGradient( t + shift ), icyGradient( t + shift ), polar ) : waterGradient( t + shift );
  return mix( open, abyssGradient( t ), dark );
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
  // A pixel this deep in the haze ends up as pure water colour whatever is drawn there, so it skips its shading. The
  // check runs at the start of every opaque fogged material, where three.js places the clipping chunk.
  chunks.clipping_planes_fragment = /* glsl */ `${chunks.clipping_planes_fragment}
#if defined( USE_FOG ) && defined( OPAQUE ) && !defined( FOG_EXP2 ) && !defined( FOG_CAP )
  if ( smoothstep( fogNear, fogFar, vFogDepth ) > 0.998 ) {
    gl_FragColor = vec4( seaColor( clamp( vFogScreenY / ${TAN_HALF_FOV.toFixed(5)} * 0.5 + 0.5, 0.0, 1.0 ), fogColor.r,
      fogColor.g, fogColor.b ), 1.0 );
    return;
  }
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
  gl_FragColor.rgb = mix( gl_FragColor.rgb, seaColor( fogT, fogColor.r, fogColor.g, fogColor.b ), fogFactor );
#endif
`;
}

// Every lit pixel runs the full lighting maths once per light. A light that is switched off, a pixel outside a
// spotlight's cone or beyond a lamp's reach, and a surface facing away from a light all add exactly zero, so those
// pixels skip the maths and the shadow lookup for that light.
export function installLightSkips() {
  const call = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const facing = /* glsl */ `
		#ifndef TOON
		directLight.visible = directLight.visible && ( dot( geometryNormal, directLight.direction ) > 0.0
			#ifdef USE_CLEARCOAT
			|| dot( geometryClearcoatNormal, directLight.direction ) > 0.0
			#endif
			);
		#endif`;
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const patched = chunk
    .split(call).join(`if ( directLight.visible ) ${call}`)
    .replace('getDirectionalLightInfo( directionalLight, directLight );',
      `getDirectionalLightInfo( directionalLight, directLight );${facing}`)
    .replace('getPointLightInfo( pointLight, geometryPosition, directLight );',
      `getPointLightInfo( pointLight, geometryPosition, directLight );${facing}`)
    .replace('getSpotLightInfo( spotLight, geometryPosition, directLight );',
      `getSpotLightInfo( spotLight, geometryPosition, directLight );${facing}`);
  if (patched.split('if ( directLight.visible )').length !== 5 || patched.split('#ifndef TOON').length !== 4) {
    throw new Error('lights_fragment_begin changed; update installLightSkips');
  }
  THREE.ShaderChunk.lights_fragment_begin = patched;
}
