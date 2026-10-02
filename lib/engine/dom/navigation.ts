/* eslint-disable @typescript-eslint/no-explicit-any */
// Navigation / HeaderNav (source `Gi`, theme.js 8028-8138): top-right nav items, char roll hover, hide on scroll.
import gsap from "gsap";
import { store } from "../core/store";
import { E } from "../core/event-bus";
import { splitText } from "./split-text";

export class Navigation {
  dom: {
    nav: HTMLElement;
    inner: HTMLElement;
    items: NodeListOf<HTMLElement>;
    iconInner: NodeListOf<Element>;
    text: NodeListOf<HTMLElement>;
    hoverText: NodeListOf<HTMLElement>;
  };
  navItems: Element[];
  navItemTl: any[] = [];
  hidden = false;
  concealed = false;
  isClosed?: boolean;
  navInnerWidth: number;
  navItemsTl!: gsap.core.Timeline;
  splitNavItemText: any;
  splitNavItemHoverText: any;
  tl: any;

  constructor() {
    E.bindAll(this);
    const e = document.querySelector(".js-navigation") as HTMLElement;
    this.dom = {
      nav: e,
      inner: e.querySelector(".js-nav-inner") as HTMLElement,
      items: e.querySelectorAll(".js-nav-item"),
      iconInner: e.querySelectorAll(".js-menu-icon-circle"),
      text: e.querySelectorAll(".js-nav-item-text"),
      hoverText: e.querySelectorAll(".js-nav-item-hover-text"),
    };
    this.navItems = [...document.querySelectorAll(".js-nav-item")];
    this.navInnerWidth = this.dom.inner.offsetWidth;
    this.build();
  }

  build() {
    this.splitText();
    this.navItemsTimeline();
    this.addEvents();
    // links start parked below their line; revealItems rolls in whichever ones the route shows
    gsap.set(this.dom.nav.querySelectorAll(".js-nav-item-chars"), { yPercent: 120 });
  }

  // Header links shown on the current route (CSS decides per route; hidden ones have no layout box).
  visibleItems() {
    return [...this.dom.items].filter((e) => e.offsetWidth > 0);
  }

  // Page entered: roll the visible links' chars up into place, same char roll as the hover.
  revealItems() {
    this.concealed = false;
    const items = this.visibleItems();
    if (!items.length) return;
    const chars = items.flatMap((e) => [...e.querySelectorAll(".js-nav-item-chars")]);
    const hover = items.flatMap((e) => [...e.querySelectorAll(".js-nav-item-hover-chars")]);
    gsap.killTweensOf([...chars, ...hover]);
    gsap.set(hover, { yPercent: 150 });
    gsap.fromTo(chars, { yPercent: 120 }, { yPercent: 0, duration: 1.2, ease: "expo.out", stagger: { each: 0.025 } });
  }

  // Page leaving: roll them up and out (the hovered link's italic copy too, since the click happens
  // mid-hover), then park every link below its line for the next reveal. Hover is ignored until then.
  concealItems() {
    this.concealed = true;
    const all = this.dom.nav.querySelectorAll(".js-nav-item-chars");
    const allHover = this.dom.nav.querySelectorAll(".js-nav-item-hover-chars");
    const items = this.visibleItems();
    const chars = items.flatMap((e) => [
      ...e.querySelectorAll(".js-nav-item-chars"),
      ...e.querySelectorAll(".js-nav-item-hover-chars"),
    ]);
    gsap.killTweensOf([...all, ...allHover]);
    gsap.to(chars, {
      yPercent: -120,
      duration: 0.6,
      ease: "expo.in",
      stagger: { each: 0.015 },
      onComplete: () => {
        gsap.set(all, { yPercent: 120 });
        gsap.set(allHover, { yPercent: 150 });
      },
    });
    if (!chars.length) {
      gsap.set(all, { yPercent: 120 });
      gsap.set(allHover, { yPercent: 150 });
    }
  }

  addEvents() {
    E.on("mouseenter", this.dom.items, this.mouseEvents);
    E.on("mouseleave", this.dom.items, this.mouseEvents);
  }

  splitText() {
    this.splitNavItemText = splitText(this.dom.text, { type: "chars", charsClass: "js-nav-item-chars" });
    this.splitNavItemHoverText = splitText(this.dom.hoverText, {
      type: "chars",
      charsClass: "js-nav-item-hover-chars",
    });
    gsap.set(".js-nav-item-hover-chars", {
      yPercent: 150,
      onComplete: () => {
        document.querySelectorAll<HTMLElement>(".nav-item__text--hover").forEach((e) => (e.style.opacity = "1"));
      },
    });
  }

  handleScroll(e: number) {
    if (store.mq.sm.matches) e > 0 ? this.hideNavItems() : this.showNavItems();
  }

  navItemsTimeline() {
    this.navItemsTl = gsap.timeline({ paused: true, defaults: { ease: "expo.inOut" } });
    this.navItemsTl
      .to(this.dom.items, { x: this.navInnerWidth, ease: "expo.in", stagger: -0.04, duration: 0.8 })
      .to(this.dom.iconInner[0], { x: 9, ease: "expo.inOut", duration: 0.6 }, "<0.2")
      .to(this.dom.iconInner[1], { x: -9, ease: "expo.inOut", duration: 0.6 }, "<")
      .set(this.dom.inner, { autoAlpha: 0 });
  }

  hideNavItems() {
    if (this.hidden) return;
    this.hidden = true;
    this.navItemsTl.play();
  }

  showNavItems() {
    if (!this.hidden) return;
    this.hidden = false;
    this.navItemsTl.reverse();
  }

  onResize() {
    if (store.mq.sm.matches) this.isClosed ? this.hideNavItems() : this.showNavItems();
  }

  mouseEvents(e: MouseEvent) {
    if (this.concealed) return;
    const t = e.target as HTMLElement;
    this.tl = this.navItemTl[this.navItems.indexOf(t)];
    if (e.type === "mouseenter")
      gsap
        .timeline({ defaults: { ease: "circ.inOut" } })
        .to(t.querySelectorAll(".js-nav-item-chars"), { yPercent: -120, stagger: { each: 0.014 } })
        .to(t.querySelectorAll(".js-nav-item-hover-chars"), { yPercent: 0, stagger: { each: 0.014 } }, "<0.014");
    else if (e.type === "mouseleave")
      gsap
        .timeline({ defaults: { ease: "circ.inOut" } })
        .to(t.querySelectorAll(".js-nav-item-chars"), { yPercent: 0, stagger: { each: 0.014 } })
        .to(t.querySelectorAll(".js-nav-item-hover-chars"), { yPercent: 150, stagger: { each: 0.014 } }, "<0.014");
  }

  destroy() {
    this.showNavItems();
  }
}

export default Navigation;
