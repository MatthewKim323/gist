// Registration table for non-core engine modules (orchestrator-owned integration point).
// bootEngine() constructs them in source order (see MODULE_ORDER in registry.ts).
import { registerModule } from "./registry";
import { PageLoader } from "./dom/page-loader";
import { NakedLoader } from "./dom/naked-loader";
import { ScrollAnimations } from "./dom2webgl/scroll-animations";
import { Dom2Webgl } from "./dom2webgl/dom2webgl";
import { HomeContact } from "./scenes/home-contact/home-contact";
import { CaseMenu } from "./scenes/case-menu/case-menu";
import { Navigation } from "./dom/navigation";
import { Menu } from "./dom/menu";
import { Cursor } from "./dom/cursor";
import Router from "./router/router";

export function registerModules() {
  registerModule("PageLoader", () => new PageLoader());
  registerModule("NakedLoader", () => new NakedLoader());
  registerModule("ScrollAnimations", () => new ScrollAnimations());
  registerModule("Dom2Webgl", () => new Dom2Webgl());
  registerModule("HomeContact", () => new HomeContact());
  registerModule("CaseMenu", () => new CaseMenu());
  registerModule("Navigation", () => new Navigation());
  registerModule("Menu", () => new Menu());
  registerModule("Cursor", () => new Cursor());
  registerModule("Router", () => new Router());
}
