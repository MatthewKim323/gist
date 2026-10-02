// PageLoader: the mykm loader (ported from dev/newportfolio's loader). A near-black panel, "mykm©"
// flies in letter by letter, the line fades in under it, and once everything is loaded (and the mark
// has finished) the panel collapses into a point to reveal the site. No enter gate: sound comes on as
// the panel clears (the old gate's Enter click did that), and browsers let it out on the first gesture.
//
// Same surface the engine relies on: show() / hide() for loader-covered transitions, `hidden`, and
// `hiddenPromise` (resolves the first time the loader clears).
import gsap from "gsap";
import { E } from "../core/event-bus";
import { store } from "../core/store";

const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
const $$ = (sel: string) => Array.prototype.slice.call(document.querySelectorAll(sel)) as HTMLElement[];

// source curves: [0.16, 1, 0.3, 1] for the letters, [0.65, 0, 0.2, 1] for the scale settles,
// [0.75, 0, 0, 1] for the collapse
const EASE_OUT = "expo.out";
const EASE_SETTLE = "power3.inOut";
const EASE_COLLAPSE = "power4.inOut";
const LETTER_OFFSETS = [0, 0.2, 0.42, 0.6];

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const tick = () => (--n <= 0 ? resolve() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  });

export class PageLoader {
  dom: {
    loader: HTMLElement;
    panel: HTMLElement;
    mark: HTMLElement;
    letters: HTMLElement[];
    sup: HTMLElement;
    line: HTMLElement;
    lineText: HTMLElement;
  };
  hidden = false;
  introTl: gsap.core.Timeline;
  hiddenPromise: Promise<void>;
  hiddenResolve!: () => void;

  constructor() {
    this.dom = {
      loader: $(".js-loader"),
      panel: $(".js-loader-panel"),
      mark: $(".js-loader-mark"),
      letters: $$(".js-loader-letter"),
      sup: $(".js-loader-sup"),
      line: $(".js-loader-line"),
      lineText: $(".js-loader-line-text"),
    };
    this.hiddenPromise = new Promise((e) => {
      this.hiddenResolve = e;
    });
    this.introTl = this.intro();
    E.on("AssetLoader:afterResolve", this.onAssetsLoaded);
  }

  intro() {
    const { mark, letters, sup, line, lineText } = this.dom;
    gsap.set(letters, {
      opacity: 0.001,
      x: 200,
      rotateX: 40,
      skewX: 10,
      skewY: 5,
      transformPerspective: 1200,
    });
    return gsap
      .timeline()
      .fromTo(mark, { scale: 1.8 }, { scale: 1, duration: 1.68, ease: EASE_SETTLE }, 0.78)
      .add(
        // "gist" flies in letter by letter; the period gets its own beat below
        letters.slice(0, LETTER_OFFSETS.length).map((l, i) =>
          gsap.to(l, {
            opacity: 1,
            x: 0,
            rotateX: 0,
            skewX: 0,
            skewY: 0,
            duration: 0.92,
            ease: EASE_OUT,
            delay: 0.58 + LETTER_OFFSETS[i],
          }),
        ),
        0,
      )
      // the period drops in last and lands with a small bounce, like a full stop being typed
      .fromTo(
        letters.slice(LETTER_OFFSETS.length),
        { opacity: 0, x: 0, y: -90, rotateX: 0, skewX: 0, skewY: 0, scale: 0.4 },
        { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: "back.out(2.6)" },
        0.58 + LETTER_OFFSETS[LETTER_OFFSETS.length - 1] + 0.42,
      )
      .fromTo(sup, { opacity: 0, x: 28, scale: 0.74 }, { opacity: 1, x: 0, scale: 1, duration: 0.56, ease: EASE_OUT }, 1.3)
      .fromTo(line, { scale: 1.8 }, { scale: 1, duration: 0.9, ease: EASE_SETTLE }, 1.2)
      .fromTo(lineText, { opacity: 0 }, { opacity: 1, duration: 0.9, ease: EASE_SETTLE }, 1.2);
  }

  // Assets are in (models, textures, audio, video first frames, fonts). Before letting anyone in, also
  // wait for the WebGL text (TextLoader) and for a few rendered frames, so shader compiles and texture
  // uploads for the freshly built scenes happen behind the panel instead of as a stutter after it.
  onAssetsLoaded = () => {
    const text = (store.TextLoader?.loaded as Promise<void> | false) || Promise.resolve();
    Promise.all([text, document.fonts?.ready])
      .then(() => frames(4))
      .then(() => {
        // never cut the mark off mid-flight: wait for the intro to land, then a beat
        const remaining = Math.max(0, this.introTl.duration() - this.introTl.time());
        gsap.delayedCall(remaining + 0.35, () => this.hide());
      });
  };

  // Loader-covered transitions: bring the panel back (mark at rest), resolve once it covers the screen.
  show() {
    const { loader, panel, letters, sup, line, lineText, mark } = this.dom;
    return new Promise<void>((e) => {
      gsap.killTweensOf([panel, loader]);
      gsap.set([mark, line], { scale: 1 });
      gsap.set(letters, { opacity: 1, x: 0, rotateX: 0, skewX: 0, skewY: 0 });
      gsap.set([sup, lineText], { opacity: 1, x: 0, scale: 1 });
      gsap
        .timeline({ onComplete: () => e() })
        .set(loader, { autoAlpha: 1 }, 0)
        .fromTo(panel, { scale: 0.001, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.72, ease: EASE_COLLAPSE }, 0);
    });
  }

  // Collapse the panel into a point (the source exit), then clear the layer.
  hide(delay = 0) {
    E.off("AssetLoader:afterResolve", this.onAssetsLoaded);
    const first = !this.hidden;
    this.hidden = true;
    const { loader, panel } = this.dom;
    gsap.killTweensOf(panel);
    return new Promise<void>((resolve) => {
      gsap
        .timeline({ delay, onComplete: () => gsap.set(loader, { autoAlpha: 0 }) })
        .to(panel, { scaleX: 0.001, scaleY: 0.001, duration: 0.72, ease: EASE_COLLAPSE }, 0)
        .to(panel, { opacity: 0, duration: 0.48, ease: EASE_COLLAPSE }, 0.2)
        .call(
          () => {
            if (first) {
              // Audio boots muted and the backing / world loops are already running under it
              if (!store.audioMuted) store.Audio?.muteAll(false);
              this.hiddenResolve();
            }
            resolve();
          },
          undefined,
          0.3,
        );
    });
  }
}

export default PageLoader;
