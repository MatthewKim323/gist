// SplitText stand-in for the source's vendored SplitText v3.0.5 clone (theme.js 7622-8027).
// gsap/SplitText wraps each char/word in <div style="position:relative;display:inline-block">, same as the clone.
// aria "none" keeps the DOM identical to the clone (no aria-label/aria-hidden injection).
import gsap from "gsap";
import { SplitText } from "gsap/SplitText";

let registered = false;

export function splitText(target: gsap.DOMTarget, vars: SplitText.Vars): SplitText {
  if (!registered) {
    gsap.registerPlugin(SplitText);
    registered = true;
  }
  return new SplitText(target, { aria: "none", ...vars });
}
