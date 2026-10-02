// Transition `toContact` (source `Ro`, theme.js 16177-16389). Mirror of toHome (cameraPathProgress 0).
import gsap from "gsap";
import { store } from "../../core/store";
import { Transition, removeView, type TransitionInArgs, type TransitionOutArgs } from "./base";

export class ToContactTransition extends Transition {
  in({ done }: TransitionInArgs) {
    done();
  }

  out({ from, done }: TransitionOutArgs) {
    const view = from.dataset.routerView;
    store.Highway.cached = store.Highway.cache.has(store.Highway.location.href);

    if (view === "homeContact") {
      gsap.to(store.HomeContact.tweenParams, { cameraPathProgress: 0, duration: 3, ease: "power4.inOut" });
      store.Audio!.play({ key: "audio.contact_swoosh" });
      store.HomeContact.showContact().then(() => {
        removeView(from);
        done();
      });
    }

  }
}

export default ToContactTransition;
