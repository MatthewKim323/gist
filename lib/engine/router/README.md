# Router + transitions

Port of the source Router (`Uo`, Highway 2.2.0 Core subclass), BaseRenderer (`wo`), the homeContact
renderer (`Eo`) and the 8 transitions. Highway fetched HTML; here Next renders each route and the
router keeps Highway's lifecycle around it.

## Files

| file | source |
|---|---|
| `router.ts` | `Uo` + Highway `Core` + `Helpers` (`store.Highway`) |
| `routes.ts` | contextual table (ARCH §4), `normalizePath`, body class per route |
| `renderers/base.ts` | Highway `Renderer` + `BaseRenderer` (`wo`) |
| `renderers/default.ts`, `renderers/home-contact.ts` | `wo` as `default`, `Eo` |
| `renderers/projects.ts`, `project.ts`, `world.ts`, `not-found.ts` | scene builders (`Po`, `Mo`, `Co`, `jo`), default-exported, extend `BaseRenderer` |
| `transitions/base.ts` | Highway `Transition` + `removeView()` |
| `transitions/*.ts` | `Ao` default, `Lo` toWorld, `Oo` toHome, `Ro` toContact, `ko` toProjectMenu, `Io` toProject, `Do` projectToProject (+ `Fo` as `disposeDeep`), `zo` homeToProject |

## Boot contract (lib/engine/boot.ts)

1. `bootEngine()` runs the construction half of `BaseRenderer.onFirstLoad` itself (ASScroll with the
   source options, RAFCollection ... Cursor, `RAFCollection.add(ASScroll.update, 0)`,
   `ASScroll.on("update", ScrollTrigger.update)`, ScrollTrigger refresh -> `ASScroll.resize`).
2. It then constructs the router last: `registerModule("Router", () => new Router())` in `modules.ts`.
   The constructor sets `store.Highway = this`, reads the first `main[data-router-view]`, and one
   microtask later (as Highway) instantiates that view's renderer and calls `setup()`:
   `firstLoad = true` -> `onFirstLoad()`, which skips construction when `store.RAFCollection` exists,
   then runs `onEnter()` and subscribes `AssetLoader:beforeResolve` -> `onFirstAssetsLoad` (scene
   builds, rebrand SvgButton, global MuteButton, then `onEnterCompleted`, `CheckFPS`, screen FX
   distort 5 -> 0.4).
3. Standalone (no boot): `new Router({ constructManagers })` and `onFirstLoad` does the whole thing.
4. Import the router only from client code loaded after mount (`import("@/lib/engine/boot")` in
   EngineRoot): `@ashthornton/asscroll` touches `self` at import time and breaks SSR.

Because boot owns the first view once a Router is registered, the scene `dev-enter.ts` hooks must not
also run (they check `store.Router` inside `onBoot`, which fires before the Router exists).

## Navigation

- Links: document-level click delegation, same selector as source
  (`a[href]:not([target]):not([href|="#"]):not([data-router-disabled])`), cmd/ctrl-click bypasses,
  `data-transition="name"` forces a transition.
- `store.Highway.redirect(url, name?)`: what scenes call (`"toProject"` from a card,
  `"projectToProject"` from the footer overscroll). Returns false while a navigation runs.
- Flow: contextual lookup (from = current path, to = target, trailing slash normalised) ->
  `NAVIGATE_OUT` -> `From.hide()` (onLeave, `out`, onLeaveCompleted) while the old view is still in
  the DOM -> `router.push(url, { scroll: false })` (Next's app router, `window.next.router` or one
  handed in with `setNextRouter(useRouter())`) -> wait for the new `main[data-router-view]` ->
  `NAVIGATE_IN` (body class) -> `To.show()` (onEnter, `in`, onEnterCompleted) -> `NAVIGATE_END`.
- Back/forward: Next registers its popstate listener before the engine boots and React flushes
  popstate renders synchronously, so listener order cannot hold it back. The router patches
  `PopStateEvent.prototype.state` so trusted events read `null` (Next's handler returns early), runs
  the out transition with the old view still mounted, then dispatches a synthetic `PopStateEvent`
  carrying the real state so Next restores the tree (verified headless: DOM holds after `back()`,
  swaps on replay). A back/forward
  pressed during a transition is applied after it ends (the source re-pushed the in-flight url,
  which would corrupt Next's history state).
- Old view removal: transitions call `removeView(el)` where the source did
  `el.parentNode.removeChild(el)`. It hides the node (`display:none`, `data-router-removed`) at that
  exact moment; React removes the node itself when the next route commits.

## What pages must provide

- `<main data-router-view="homeContact|projects|project|world|notFound">` as the only child of the
  layout's persistent `[asscroll-container][data-router-wrapper]`.
- Body classes come from `routes.ts#bodyClassFor` (same table as the layout's pre-paint script). A view
  can override with `data-body-class` (the project page should add `dark` when the project is in
  light mode; `Mo.onEnter` reads `body.dark` into `store.projectLightMode`).
- Inline `<script>` in a view (window.projects / window.worldData / window.currentProjectMenuId) is
  eval'd by `BaseRenderer.loadScripts` after client navigations, as the source did (React never
  executes scripts it inserts). On first load the SSR HTML runs them.
- The project renderer must expose `projectBuilt` (a Promise) for `toProject` / `projectToProject`.

## Not ported

`ktxPreview` renderer (debug), the analytics call in `onNavigateEnd`, the `?debug` Tweakpane GUI.
