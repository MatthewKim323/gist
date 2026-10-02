// Transition `toMatter`: the home scene seam-wipes (wipe-zoom pass) into the case menu backdrop scene,
// which the matter page sits on.
import gsap from "gsap";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

export class ToMatterTransition extends Transition {
  in({ done }: TransitionInArgs) {
    done();
  }

  out({ from, done }: TransitionOutArgs) {
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);
    const home = store.HomeContact;
    const menu = store.CaseMenu;
    home.transitionPass.uniforms.u_fromScene.value = home.savePass.renderTarget.texture;
    home.transitionPass.uniforms.u_toScene.value = menu.savePass.renderTarget.texture;
    menu.hasAnimatedIn = true;
    menu.allowControl = false;
    store.Gl!.globalUniforms.fogColor.value.copy(menu.scene.fog.color);
    store.Gl!.globalUniforms.fogNear.value = menu.scene.fog.near;
    store.Gl!.globalUniforms.fogFar.value = menu.scene.fog.far;
    store.isTouch || store.Gl!.fluidSim.enable();
    menu.addEvents();
    gsap
      .timeline({
        defaults: { duration: 3, ease: "power4.inOut" },
        onStart: () => {
          home.savePass.enabled = true;
          home.transitionPass.enabled = true;
          menu.renderPass.enabled = true;
          menu.savePass.enabled = true;
          menu.addPreSceneEvents();
        },
        onComplete: () => {
          home.savePass.enabled = false;
          home.transitionPass.enabled = false;
          menu.savePass.enabled = false;
          menu.allowControl = true;
          removeView(from);
          done();
        },
      })
      .fromTo(home.transitionPass.uniforms.u_progress, { value: 0 }, { value: 1 }, 0)
      .fromTo(home.tweenParams, { cameraYOffset: 0 }, { cameraYOffset: (store.window.h / 2) * -5e-5 }, "<")
      .fromTo(menu.tweenParams, { cameraYOffset: 2 * store.window.h }, { cameraYOffset: 0 }, "<")
      .call(
        () => {
          store.Audio!.play({ key: "audio.new_water_projects", isInteraction: true });
          store.Audio!.filterTo({
            key: "audio.backing",
            duration: 1800,
            type: "lowpass",
            from: { frequency: 14e3 },
            to: { frequency: 160 },
          });
        },
        [],
        0.6,
      );
  }
}

export default ToMatterTransition;
