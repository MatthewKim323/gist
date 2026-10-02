// ported verbatim from the source engine
export const homeGrassBladeFrag = /* glsl */ `precision highp float;
#define GLSLIFY 1

uniform vec3 cameraPosition;

varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vPosition;
varying vec4 vWorldPosition;

uniform sampler2D u_blade;
uniform sampler2D u_noise;
uniform float u_time;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform float uNight;

void main() {
	vec4 c = texture2D(u_blade, vUv);
	if(c.r < .35) {
		discard;
	}

	float noise = (texture2D(u_noise, vWorldPosition.xz * 1. + u_time * 0.01).r - 0.2) * 2.;
	noise = clamp(noise, 0., 1.);
	vec3 color = mix(u_color1, u_color2, noise);

	gl_FragColor = vec4(color * clamp(vUv.y + 0.4, 1., 1.2) * clamp(1. - abs(vUv.x * 2. - 1.), 0.7, 1.) + 0.1 * (1. - uNight * 0.85), 1.);
	// night: moonlight catches the blade tips (silver-blue), a little more where the noise lifts the blade
	float tip = smoothstep(0.45, 1.0, vUv.y);
	gl_FragColor.rgb += vec3(0.10, 0.15, 0.21) * tip * tip * (0.55 + 0.45 * noise) * uNight;

	// vec3 adjustedLight = vec3(15., 2., -5.) + cameraPosition;
	// vec3 lightDirection = normalize(vPosition - adjustedLight);
	// gl_FragColor.rgb += dot(-lightDirection, vNormal) * vec3(1.);

	float depth = gl_FragCoord.z / gl_FragCoord.w;
	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
}`;
