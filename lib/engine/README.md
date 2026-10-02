# Engine core: public API

Imperative WebGL engine (three 0.143 + gsap). Client only. `components/EngineRoot.tsx` dynamic-imports
`lib/engine/boot.ts` once on mount and calls `bootEngine()`. No module touches `window` at import time.

## Boot (`lib/engine/boot.ts`)
`bootEngine()` = source `Wo.init` + `BaseRenderer.onFirstLoad`, in this order:
1. `initStore()`, `registerModules()` (from `modules.ts`), scrollRestoration manual, merge `window.globalData`
   (defaults `assetsUrl: "/theme/"`, `publicUrl: "/"`), `store.GlobalEvents`, `window.store = store`.
2. `ASScroll` (only if `[asscroll-container]` exists), `RAFCollection`, `FPSChecker`, `AssetLoader`, `TextLoader`,
   `Dom2WebglObserver`, **[PageLoader, NakedLoader, ScrollAnimations]**, `TaskScheduler`, `Gl` + `Gl.addPasses()`,
   `Audio`, **[Dom2Webgl]**, CustomEase `projectMenuToProject`, **[HomeContact, ProjectMenu, ProjectFilters, World,
   Navigation, Menu, WorldButton, Cursor]**, then `RAFCollection.add(ASScroll.update, 0)`, ScrollTrigger hookup, `?mobilerecording`.
3. `onBoot` hooks, then **[Router]** (stored as `store.Router`, and `store.Highway` if the router did not set it).
   The router owns the first view (BaseRenderer `onEnter` + `onFirstAssetsLoad`). Without a Router a minimal fallback
   loads the current page's assets and runs `onFirstAssetsLoadCore()`.

Bracketed slots come from the registry (`lib/engine/registry.ts`):
```ts
registerModule("HomeContact", () => new HomeContact()); // key = store key; factory result stored on store[key]
onBoot(() => { /* after all managers exist */ });
```
Registrations live in `lib/engine/modules.ts` inside `registerModules()` (integration point). Factory errors are
caught and logged so one area cannot kill boot.
`onFirstAssetsLoadCore(onEnterCompleted?)`: HomeContact.build, ProjectMenu.preBuild, World.buildIntro, then after
`TextLoader.loaded` + `PageLoader.hiddenPromise`: onEnterCompleted, emit `CheckFPS`, `u_maxDistort` from 5 (1.5 s power2.out).

## Store (`core/store.ts`) `import { store } from "@/lib/engine/core/store"`
Same field names as source `o`: `html, body, window{w,h,fullHeight,dpr}, mouse{x,y,gl,glNormalized,glScreenSpace,
smooth.glNormalized}, mq{xs(max 415),sm(768),md(1024),lg(1366),xlg(1921)}, urlParams, isTouch, isIOS,
projectToProjectTransition, currentProjectMenuId, projectLightMode, audioMuted, debug, events, assetsUrl, publicUrl,
clockDelta, gpuTier` + instances `ASScroll, RAFCollection, FPSChecker, AssetLoader, TextLoader, Dom2WebglObserver,
TaskScheduler, Gl, Audio, GlobalEvents, Dom2Webgl, PageLoader, NakedLoader, ScrollAnimations, HomeContact,
ProjectMenu, ProjectFilters, World, Navigation, Menu, WorldButton, Cursor, Highway`.

## Events (`core/event-bus.ts`) `import E from "@/lib/engine/core/event-bus"`
`E.on(name, cb)`, `E.off(name, cb)`, `E.emit(name, ...args)`, `E.once(name, cb)`; DOM: `E.on("click", elOrSelector, cb, opts)`;
`E.delegate("click", ".sel", cb)` (`e.currentTarget` = matched el; mouseenter/leave via capture); `E.bindAll(this, [...])`.
Global (`store.events`): `GRAF(time)`, `GMouseMove{mousePos,event}`, `GMouseDrag{ox,oy,px,py,x,y,event}`, `GMouseDown`,
`GMouseUp`, `GResize` (debounced 150 ms), `TouchDetected`, `GWheel`.
Custom: `AssetsProgress{percent}`, `AssetLoader:beforeResolve|afterResolve`, `TextLoaderProgress`, `TextLoader:*`,
`dom2webgl(entry)`, `firstObservation(els)`, `cssrenderer:cacheUpdated`, `AudioMute(bool)`, `CheckFPS`, `FPSChecked(tier)`.

## RAF (`core/raf.ts`) `store.RAFCollection.add(cb, index)` / `.remove(cb)`; ascending index on each GRAF
0 ASScroll.update · 2 FluidSim.onRaf · 3 Dom2Webgl/PageLoader/Project · 4 ProjectModel/Awards/GridSlider ·
10 ProjectMenu.onPreSceneRaf · 11 ProjectMenu.onRaf · 70 World.introRaf · 80 World.onRaf · **99 Gl.onRaf (composer.render)** ·
100 FPSChecker.check, HomeContact.onRaf.

## Gl (`core/gl.ts`) `store.Gl`
`renderer` (alpha, no AA, `#gl`), `camera` (pixel camera z 1500, far 2200), `scene` (+ `fog.origVals`), `composer`,
`composerPasses.add(pass, idx)` / `.remove(pass)`, `clock`, `cssRenderer` + `cssScene` (CSS3D layer, z 60, starts hidden),
`globalUniforms{u_time,u_delta,u_resolution,fogNear,fogFar,fogColor}`, `assets.textures{matcap, matcapBlack,
projectModelMatcap, projectModelMatcapDark, noiseSmall, gradientNoise}`, `webglFonts`, `generateTexture(src, opts, isKtx)`,
`screenFxPass` (idx 101; uniforms `u_noiseOnly, u_maxDistort 0.4, u_bendAmount -0.15, u_vignetteStrength`),
`fluidSim` (128², force 20; call `enable()`), `fluidPass` (not added; project adds at 21), `onResize`, `onFPSChecked`.
Pass indices: 0 Home render · 1 Home save · 10 Menu render · 11 Menu save · 15 Menu→Project · 20 Project render ·
21 fluidPass · 30 Home transition · 50-57 World · 101 screen FX.

## Other core modules (`core/*`)
- `AssetLoader`: `load({element, progress})`, `add(promise)`, `loadGltf(url)`, `loadTexture(url, opts)`,
  `loadKtxTexture(url, opts)`, `loadJson(url)`, `addImage(img)`, `loaded`, `ktxLoader`, `gltfLoader`. Draco `/theme/draco/`, basis `/theme/basis/`.
- `assetUrl(path)` → `/theme/<path>`.
- `FBO` (GPGPU ping-pong; first one sets `renderer.autoClear=false`), `FluidSim` (`velocitySim.texture`, `tweenMousePos`, `enable/disable`).
- `CSS3DObject`, `CSS3DSprite`, `CSS3DRenderer`; `OrderedPassList`; `ThreePlugin` (gsap `three`, registered by Gl);
  `GlPropsPlugin` / `registerGlProps()` (gsap `glProps`, for ScrollAnimations).
- `BrownianMotion`, `FullScreenQuad`, `ResourceTracker` / `disposeDeep`, `ObserverRegistry` (wraps IntersectionObserver:
  push `{el, enter, leave, params}` to `els`, call `observe(el)`), `FPSChecker`, `TaskScheduler` (`enqueueTask`, `queueFinished`),
  `Audio` (`play({key:"audio.<name>", fade, volume, speed, isInteraction, callback})`, `stop`, `fadeTo`, `fadeToStop`,
  `filterTo`, `lerpSpeed`, `muteAll`, `isPlaying`, `duration`), `ComponentManager`, `$`, `$$`.
- Shaders used by core: `shaders/common-fullscreen-uv.vert`, `fluid-*.frag`, `post-fluid-overlay.*`,
  `post-screenfx-chromatic-barrel-vignette-grain.frag` (`*.glsl.ts`, verbatim).
