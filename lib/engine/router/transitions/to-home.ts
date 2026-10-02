// Transition `toHome` (source `Oo`, theme.js 15976-16176).
import gsap from "gsap";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

export class ToHomeTransition extends Transition {
  in({ done }: TransitionInArgs) {
    done();
  }

  out({ from, done }: TransitionOutArgs) {
    const view = from.dataset.routerView;
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);

    if (view === "homeContact") {
      gsap.to(store.HomeContact.tweenParams, { cameraPathProgress: 1, duration: 3, ease: "power4.inOut" });
      store.Audio!.play({ key: "audio.contact_swoosh" });
      store.HomeContact.showHome().then(() => {
        removeView(from);
        done();
      });
    }

    if (view === "matter") {
      // exact reverse of toMatter
      const home = store.HomeContact;
      const menu = store.CaseMenu;
      const toContact = store.Highway.location.pathname.includes("contact");
      home.transitionPass.uniforms.u_fromScene.value = home.savePass.renderTarget.texture;
      home.transitionPass.uniforms.u_toScene.value = menu.savePass.renderTarget.texture;
      menu.allowControl = false;
      home.enable();
      home.isHome = !toContact;
      home.tweenParams.cameraPathProgress = toContact ? 0 : 1;
      toContact ? home.showContact(true) : home.showHome(true);
      gsap
        .timeline({
          defaults: { duration: 3, ease: "power4.inOut" },
          onStart: () => {
            home.savePass.enabled = true;
            home.transitionPass.enabled = true;
            menu.savePass.enabled = true;
          },
          onComplete: () => {
            home.savePass.enabled = false;
            home.transitionPass.enabled = false;
            menu.savePass.enabled = false;
            menu.renderPass.enabled = false;
            menu.removePreSceneEvents();
            menu.transitionPass.enabled = false;
            store.Gl!.fluidSim.disable();
            store.ASScroll.containerElement.style.removeProperty("z-index");
            removeView(from);
            done();
          },
        })
        .fromTo(home.transitionPass.uniforms.u_progress, { value: 1 }, { value: 0 }, 0)
        .fromTo(home.tweenParams, { cameraYOffset: (store.window.h / 2) * -5e-5 }, { cameraYOffset: 0 }, "<")
        .fromTo(menu.tweenParams, { cameraYOffset: 0 }, { cameraYOffset: 2 * store.window.h }, "<");
    }
  }
}

export default ToHomeTransition;
