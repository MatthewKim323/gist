// ported verbatim from the source engine
export const projectsCardCoverFogFrag = /* glsl */ `#define GLSLIFY 1
vec2 backgroundCoverUv( vec2 screenSize, vec2 imageSize, vec2 uv ) {
    float screenRatio = screenSize.x / screenSize.y;
    float imageRatio = imageSize.x / imageSize.y;
    vec2 newSize = screenRatio < imageRatio 
        ? vec2(imageSize.x * (screenSize.y / imageSize.y), screenSize.y)
        : vec2(screenSize.x, imageSize.y * (screenSize.x / imageSize.x));
    vec2 newOffset = (screenRatio < imageRatio 
        ? vec2((newSize.x - screenSize.x) / 2.0, 0.0) 
        : vec2(0.0, (newSize.y - screenSize.y) / 2.0)) / newSize;
    return uv * screenSize / newSize + newOffset;
}

varying vec2 vUv;
varying vec3 vWorldPos;
varying float zPos;
varying vec3 vFluid;

uniform sampler2D uTexture;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
uniform vec2 u_imageSize;
uniform vec2 u_meshSize;
uniform float u_innerScale;
uniform float u_opacity;
uniform sampler2D uBanner;
uniform vec2 uBannerSize;
uniform float uHasBanner;
uniform float uBannerShine;

vec2 scaleOrigin = vec2(0.5, 0.5);

const vec3 W = vec3(0.2125, 0.7154, 0.0721);
float luminance(in vec3 color) {
    return dot(color, W);
}

void main() {
	vec2 uv = backgroundCoverUv(u_meshSize, u_imageSize, vUv);
	uv = vec2(vec2(uv - scaleOrigin) / u_innerScale + scaleOrigin);

	vec4 imageColor = texture2D(uTexture, uv);
	// winner ribbon: diagonal band across the top-left corner, in card pixel space. Composited before the
	// zPos/fluid/fog passes so it bends and ripples with the card. The band runs corner-perpendicular
	// (d = distance from the corner along the diagonal); the canvas maps along its length (t) and across it.
	if (uHasBanner > 0.5) {
		vec2 p = vec2(vUv.x, 1.0 - vUv.y) * u_meshSize;
		float W = u_meshSize.x;
		float d0 = W * 0.075;
		float bw = W * 0.06;
		float d = (p.x + p.y) * 0.70710678;
		float t = (p.x - p.y) * 0.70710678;
		float aa = W * 0.0015;
		// soft shadow on the inner side of the ribbon
		float sh = smoothstep(d0 + bw + W * 0.02, d0 + bw, d) * step(d0 + bw, d);
		imageColor.rgb *= 1.0 - sh * 0.35;
		float inside = smoothstep(d0 - aa, d0 + aa, d) * (1.0 - smoothstep(d0 + bw - aa, d0 + bw + aa, d));
		if (inside > 0.0) {
			float len = bw * uBannerSize.x / uBannerSize.y;
			vec2 ruv = vec2(t / len + 0.5, 1.0 - (d - d0) / bw);
			vec4 ribbon = texture2D(uBanner, ruv);
			float reach = d0 + bw;
			float band = 1.0 - smoothstep(0.0, bw * 0.9, abs(t - (uBannerShine * 2.0 - 1.0) * reach * 1.2));
			ribbon.rgb += band * 0.3 * step(0.001, uBannerShine) * (1.0 - step(0.999, uBannerShine));
			imageColor.rgb = mix(imageColor.rgb, ribbon.rgb, inside * ribbon.a);
		}
	}
	imageColor.rgb += smoothstep(0., 10., zPos * 0.3) * 0.3;

	#ifdef FLUID
		float lum = luminance(abs(vFluid));
		imageColor.rgb += lum * 0.15;
	#endif

	// night hall: pull the cards' highlights down so white-heavy previews don't glare against the dark
	imageColor.rgb *= 0.86;

	gl_FragColor = imageColor;

	float depth = gl_FragCoord.z / gl_FragCoord.w;

	gl_FragColor.a *= smoothstep(2000., 1500., depth);

	float fogFactor = smoothstep( fogNear, fogFar, depth );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );

	gl_FragColor.a *= u_opacity;
}`;
