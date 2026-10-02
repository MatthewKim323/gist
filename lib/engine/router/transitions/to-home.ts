// Transition `toHome` (source `Oo`, theme.js 15976-16176).
import gsap from "gsap";
import { store } from "../../core/store";
import { paperTexture } from "./to-matter";
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
      const home = store.HomeContact;
      home.transitionPass.uniforms.u_fromScene.value = home.savePass.renderTarget.texture;
      home.transitionPass.uniforms.u_toScene.value = paperTexture();
      const toContact = store.Highway.location.pathname.includes("contact");
      home.enable();
      home.isHome = !toContact;
      home.tweenParams.cameraPathProgress = toContact ? 0 : 1;
      toContact ? home.showContact(true) : home.showHome(true);
      gsap
        .timeline({
          defaults: { duration: 2.4, ease: "power4.inOut" },
          onStart: () => {
            home.savePass.enabled = true;
            home.transitionPass.enabled = true;
          },
          onComplete: () => {
            home.savePass.enabled = false;
            home.transitionPass.enabled = false;
            removeView(from);
            done();
          },
        })
        .to(from, { autoAlpha: 0, y: -40, duration: 0.8, ease: "power2.in" }, 0)
        .fromTo(home.transitionPass.uniforms.u_progress, { value: 1 }, { value: 0 }, 0.2)
        .fromTo(home.tweenParams, { cameraYOffset: (store.window.h / 2) * -5e-5 }, { cameraYOffset: 0 }, "<");
    }

  }
}

export default ToHomeTransition;
