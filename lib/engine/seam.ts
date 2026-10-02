// seamWipe: the in-page hand-off on /matter (pipeline timeline -> dashboard). The case menu backdrop sweeps
// shut to a flat color with its own wipe pass, `swap` runs while the screen is covered (change the DOM
// there), then the sweep reverses and the backdrop comes back under the new content.
// Safe to call before the engine boots or without WebGL: it just runs `swap`.
import gsap from "gsap";
import { Color } from "three";
import { store } from "./core/store";

export type SeamWipeOptions = {
  /** Color the sweep closes to. Defaults to the backdrop's fog color so the seam reads as one surface. */
  color?: string;
  /** Sweep back open after the swap (default). false holds on the flat color. */
  reveal?: boolean;
  /** Seconds per half (default 1.6). */
  duration?: number;
};

let running: Promise<void> | null = null;

function matterView() {
  return document.querySelector<HTMLElement>('main[data-router-view="matter"]');
}

export function seamWipe(swap: () => void | Promise<void>, opts: SeamWipeOptions = {}): Promise<void> {
  if (running) return running.then(() => seamWipe(swap, opts));
  const menu = store.CaseMenu;
  const pass = menu?.transitionPass;
  if (!pass || !menu.renderPass?.enabled) return Promise.resolve(swap()).then(() => undefined);

  const { reveal = true, duration = 1.6 } = opts;
  const u = pass.uniforms;
  const view = matterView();
  u.u_bgColor.value.copy(opts.color ? new Color(opts.color) : menu.scene.fog.color);
  u.u_opacity.value = 1;
  menu.allowControl = false;

  running = (async () => {
    pass.enabled = true;
    await gsap
      .timeline({ defaults: { ease: "power4.inOut" } })
      .to(view, { autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 0)
      .fromTo(u.u_progress, { value: 0 }, { value: 1, duration }, 0)
      .then();
    await swap();
    // let React commit the swapped content before it fades in
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const tl = gsap.timeline({ defaults: { ease: "power4.inOut" } });
    if (reveal) tl.to(u.u_progress, { value: 0, duration }, 0);
    await tl.to(matterView(), { autoAlpha: 1, duration: 0.8, ease: "power2.out" }, reveal ? duration * 0.45 : 0).then();
    if (reveal) pass.enabled = false;
    menu.allowControl = true;
  })().finally(() => {
    running = null;
  });
  return running;
}
