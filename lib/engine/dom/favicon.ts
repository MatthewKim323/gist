// Favicon swap (source `Ho`, theme.js 17183-17202): tab hidden -> "eyes" favicon, visible -> default.
// Only links with pixel sizes ("32x32", "16x16") are swapped, as in the source markup.
import { assetUrl } from "../core/asset-url";

function iconLinks(): HTMLLinkElement[] {
  return Array.prototype.slice
    .call(document.querySelectorAll("link[rel*='icon']"))
    .filter((e: HTMLLinkElement) => /^\d+x\d+$/.test(String(e.sizes)));
}

export class Favicon {
  static toEyes() {
    iconLinks().forEach((e) => {
      e.href = assetUrl("images/eyes-" + e.sizes + ".png") + "?=" + Math.random();
    });
  }

  static toDefault() {
    iconLinks().forEach((e) => {
      e.href = "/favicon/favicon-" + e.sizes + ".png?=" + Math.random();
    });
  }

  /** source Wo.handleFavicon */
  static handleFavicon() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) Favicon.toEyes();
      else Favicon.toDefault();
    });
  }
}

export default Favicon;
