// Renderer `matter`: the case dashboard is plain DOM. The GL canvas is hidden while it is up (the wipe
// already cleared it to transparent) and brought back when leaving, so toHome can wipe the scene back in.
import gsap from "gsap";
import { store } from "../../core/store";
import { BaseRenderer } from "./base";

function glWrap() {
  return document.getElementById("gl")?.parentElement ?? null;
}

export class MatterRenderer extends BaseRenderer {
  onEnter() {
    super.onEnter();
    const wrap = glWrap();
    if (wrap) gsap.set(wrap, { autoAlpha: 0 });
    // first load straight onto /matter: nothing to wipe, just let the loader go
    if (store.Highway.firstLoad) (store.AssetLoader!.loaded as Promise<void>).then(() => store.PageLoader.hide());
  }

  onLeave() {
    super.onLeave();
    const wrap = glWrap();
    if (wrap) gsap.set(wrap, { autoAlpha: 1 });
  }
}

export default MatterRenderer;
