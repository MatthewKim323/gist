// Night for the home scene (the site is night-only). Everything keys off one shared uniform, uNight
// (0 = the original sunlit source scene, 1 = moonlit), which HomeContact.applyNight sets to 1.
//
// The room, chair, pillows, rocks and table are MeshBasicMaterials with the sunlight baked into their
// textures, so night can't come from real lights. Instead a moonlight grade re-lights the baked result:
// what the sun lit becomes cool silver moonlight, what sat in shadow sinks into deep blue ambient, which
// keeps the baked shadow shapes as moon shadows. The sky gets a procedural night (stars, moon, halo)
// crossfaded over the painted one; grass, water, dust and the headline read uNight in their own shaders.
import { Color, Vector3, type Material } from 'three';

export const nightUniforms = {
  uNight: { value: 0 },
  // world-space direction to the moon: from the home camera it sits in the tall window, upper right of
  // the name (measured by unprojecting that pixel). The water's moon path uses the same direction.
  uMoonDir: { value: new Vector3(-0.245, 0.262, -0.935).normalize() },
};

/** Night values for the colours the scene sets from JS (source day values in comments). */
export const NIGHT_COLORS = {
  grass1: new Color(0x1a2e25), // 0xffd1e7
  grass2: new Color(0x0e1c16), // 0xd4a0c0
  ground: new Color(0x0a1511), // 0xdbaacc
  fog: new Color(0x0d1422), // 0xe0d0cf
  dust: new Color(0xf0ffb8), // 0xf4e3ef
} as const;

// Moonlight grade for baked sunlit colour. `c` is the lit texel in output space.
export const NIGHT_GRADE_GLSL = /* glsl */ `
vec3 nightGrade(vec3 c, float n) {
  if (n <= 0.0) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // baked sun vs baked shade, relative to the pastel scene (walls sit around 0.6-0.95)
  float lit = smoothstep(0.58, 0.93, l);
  vec3 albedo = c / max(l, 0.001);
  vec3 ambient = vec3(0.028, 0.040, 0.078) + c * vec3(0.07, 0.09, 0.15);
  vec3 moon = mix(vec3(0.44, 0.52, 0.68), albedo * vec3(0.46, 0.53, 0.66), 0.25) * l;
  vec3 g = mix(ambient, moon, pow(lit, 1.35));
  return mix(c, g, n);
}
`;

// Procedural night sky: navy gradient, a faint horizon glow, twinkling stars (they ride the sky
// sphere's slow rotation) and a moon with a soft halo, fixed in world space.
export const NIGHT_SKY_GLSL = /* glsl */ `
float nHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float nNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(nHash(i), nHash(i + vec3(1, 0, 0)), f.x), mix(nHash(i + vec3(0, 1, 0)), nHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(nHash(i + vec3(0, 0, 1)), nHash(i + vec3(1, 0, 1)), f.x), mix(nHash(i + vec3(0, 1, 1)), nHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
vec3 nightSky(vec3 dir, vec3 starDir, vec3 moonDir, float time) {
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.030, 0.042, 0.080), vec3(0.012, 0.018, 0.040), smoothstep(0.5, 0.95, h));
  col += vec3(0.060, 0.080, 0.130) * pow(1.0 - abs(dir.y), 5.0);

  // stars
  for (int k = 0; k < 2; k++) {
    float scale = k == 0 ? 90.0 : 190.0;
    vec3 sp = starDir * scale + float(k) * 17.0;
    vec3 cell = floor(sp);
    float r = nHash(cell);
    float d = length(fract(sp) - 0.5);
    float star = step(k == 0 ? 0.972 : 0.94, r) * smoothstep(k == 0 ? 0.26 : 0.18, 0.0, d);
    float twinkle = 0.55 + 0.45 * sin(time * (1.5 + r * 3.0) + r * 60.0);
    col += vec3(0.80, 0.86, 1.0) * star * twinkle * (k == 0 ? 1.0 : 0.45) * (0.4 + 0.6 * fract(r * 13.0)) * smoothstep(0.42, 0.55, h);
  }

  // moon: disk with mottled maria, bright limb, soft two-stage halo
  float md = clamp(dot(dir, moonDir), -1.0, 1.0);
  float ang = acos(md);
  float R = 0.034;
  float disk = smoothstep(R, R * 0.93, ang);
  vec3 local = (dir - moonDir) / R;
  float maria = nNoise(local * 2.6 + 3.1) * 0.6 + nNoise(local * 6.0) * 0.4;
  float shade = 0.80 + 0.2 * smoothstep(0.35, 0.75, maria);
  shade *= mix(1.0, 0.85, smoothstep(0.4, 1.0, ang / R));
  col += vec3(0.45, 0.52, 0.72) * exp(-ang * 22.0) * 0.45;
  col += vec3(0.20, 0.25, 0.42) * exp(-ang * 5.0) * 0.22;
  col = mix(col, vec3(0.94, 0.96, 1.0) * shade, disk);
  return col;
}
`;

type Shader = { uniforms: Record<string, { value: unknown }>; vertexShader: string; fragmentShader: string };

/** Injects the moonlight grade at the end of a built-in material (MeshBasic / MeshMatcap). */
export function gradeMaterial(material: Material) {
  material.onBeforeCompile = (shader: Shader) => {
    shader.uniforms.uNight = nightUniforms.uNight;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float uNight;\n${NIGHT_GRADE_GLSL}\nvoid main() {`)
      .replace(
        '#include <dithering_fragment>',
        'gl_FragColor.rgb = nightGrade(gl_FragColor.rgb, uNight);\n#include <dithering_fragment>',
      );
  };
  material.customProgramCacheKey = () => 'night-grade';
  material.needsUpdate = true;
}

/** Crossfades the painted sky sphere into the procedural night sky. */
export function nightSkyMaterial(material: Material, time: { value: number }) {
  material.onBeforeCompile = (shader: Shader) => {
    shader.uniforms.uNight = nightUniforms.uNight;
    shader.uniforms.uMoonDir = nightUniforms.uMoonDir;
    shader.uniforms.uNightTime = time;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vNightWorld;\nvarying vec3 vNightStar;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvNightWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvNightStar = normalize(position);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        `uniform float uNight;\nuniform vec3 uMoonDir;\nuniform float uNightTime;\nvarying vec3 vNightWorld;\nvarying vec3 vNightStar;\n${NIGHT_SKY_GLSL}\nvoid main() {`,
      )
      .replace(
        '#include <dithering_fragment>',
        `if (uNight > 0.0) {
          vec3 nDir = normalize(vNightWorld - cameraPosition);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, nightSky(nDir, vNightStar, uMoonDir, uNightTime), uNight);
        }
        #include <dithering_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'night-sky';
  material.needsUpdate = true;
}
