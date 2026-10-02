// Transition `toMatter`: the home scene seam-wipes away (same wipe-zoom pass as the menu transition) with
// an empty `u_toScene`, so the canvas clears to transparent and the matter dashboard underneath shows through.
import gsap from "gsap";
import { DataTexture, RGBAFormat } from "three";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

// 1x1 of the dashboard paper color, so the wipe lands on the page background instead of an empty canvas.
let paper: DataTexture | null = null;
export function paperTexture() {
  if (!paper) {
    paper = new DataTexture(new Uint8Array([244, 241, 234, 255]), 1, 1, RGBAFormat);
    paper.needsUpdate = true;
  }
  return paper;
}

export class ToMatterTransition extends Transition {
  in({ to, done }: TransitionInArgs) {
    gsap.fromTo(
      to,
      { autoAlpha: 0, y: 40 },
      { autoAlpha: 1, y: 0, duration: 1.2, ease: "power4.out", clearProps: "transform", onComplete: done },
    );
  }

  out({ from, done }: TransitionOutArgs) {
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);
    const home = store.HomeContact;
    home.transitionPass.uniforms.u_fromScene.value = home.savePass.renderTarget.texture;
    home.transitionPass.uniforms.u_toScene.value = paperTexture();
    gsap.to(store.Gl!.cssRenderer.domElement, { autoAlpha: 0, duration: 0.6, ease: "power2.out" });
    store.Audio!.play({ key: "audio.new_water_projects", isInteraction: true });
    gsap
      .timeline({
        defaults: { duration: 2.4, ease: "power4.inOut" },
        onStart: () => {
          home.savePass.enabled = true;
          home.transitionPass.enabled = true;
        },
        onComplete: () => {
          removeView(from);
          done();
        },
      })
      .fromTo(home.transitionPass.uniforms.u_progress, { value: 0 }, { value: 1 }, 0)
      .fromTo(home.tweenParams, { cameraYOffset: 0 }, { cameraYOffset: (store.window.h / 2) * -5e-5 }, "<");
  }
}

export default ToMatterTransition;
