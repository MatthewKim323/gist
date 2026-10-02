"use client";

// The home screen's button ("Open the case" in components/PersistentContent.tsx), as a React component.
// Same markup and classes as the home one, so app/globals.css styles it, and the engine's SvgButton
// (lib/engine/dom/svg-button.ts) draws the pill and runs the fill/content hover on mount.

import { useEffect, useRef, type MouseEventHandler, type ReactNode } from "react";
import gsap from "gsap";
import { SvgButton } from "@/lib/engine/dom/svg-button";
import "@/app/styles/gist-ui.css";

export interface ButtonProps {
  children: ReactNode;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  /** fill: solid pill that fills on hover (the home button). border: outline pill, for secondary actions. */
  variant?: "fill" | "border";
  /** light = white pill (for dark surfaces, the home look). dark = navy pill. */
  tone?: "light" | "dark";
  size?: "md" | "sm" | "xs";
  /** Arrow icon after the label, as on the home button. */
  arrow?: boolean;
  /** Opens in a new tab and skips the engine router. */
  external?: boolean;
  disabled?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
  "aria-label"?: string;
  "aria-pressed"?: boolean;
  "aria-expanded"?: boolean;
}

function Inner(props: ButtonProps) {
  const {
    children,
    href,
    onClick,
    variant = "fill",
    tone = "light",
    size = "md",
    arrow = false,
    external,
    disabled,
    type = "button",
    title,
    className = "",
  } = props;
  const el = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    // Small buttons stay on the CSS pill: SvgButton's corner radii are tuned for the home size and
    // read as blobs at sm/xs.
    if (size !== "md") {
      node.classList.add("gb--nosvg");
      return;
    }
    let btn: SvgButton | null = null;
    let ro: ResizeObserver | null = null;
    let built = { w: 0, h: 0 };

    const teardown = () => {
      try {
        btn?.contentTimeline?.kill();
        btn?.borderTimeline?.kill();
        btn?.destroy();
        btn?.canvas?.remove();
      } catch {}
      btn = null;
      node.querySelectorAll(".js-btn-content-cloned").forEach((n) => n.remove());
      gsap.set(node.querySelectorAll(".js-btn-content, .js-btn-icon"), { clearProps: "transform" });
      node.classList.remove("gb--svg");
    };

    const build = () => {
      const w = node.clientWidth;
      const h = node.clientHeight;
      // Only build on a real, laid-out size; rebuild if the size changes meaningfully.
      if (w < 8 || h < 8 || node.getClientRects().length === 0) return;
      if (btn && Math.abs(w - built.w) < 2 && Math.abs(h - built.h) < 2) return;
      teardown();
      try {
        btn = new SvgButton(node);
        built = { w, h };
        node.classList.remove("gb--nosvg");
        node.classList.add("gb--svg");
      } catch (e) {
        console.warn("[Button] SvgButton failed, CSS fallback", e);
        teardown();
        node.classList.add("gb--nosvg");
      }
    };

    node.classList.add("gb--nosvg");
    const raf = requestAnimationFrame(build);
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => build());
      ro.observe(node);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      teardown();
      node.classList.remove("gb--nosvg");
    };
  }, [size]);

  const cls = [
    "btn btn--regular",
    `btn--${variant}`,
    `btn--${tone}`,
    "js-btn js-manager-ignore",
    "gb",
    `gb--${size}`,
    disabled ? "gb--disabled" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const inner = (
    <span className="btn__inner js-btn-inner">
      <span className="btn__content js-btn-content">
        <span className="d-flex flex-row items-end">
          <span className="btn__text">{children}</span>
          {arrow ? (
            <svg className="btn__icon d-inline-block js-btn-icon" aria-hidden>
              <use href="#arrow" />
            </svg>
          ) : null}
        </span>
      </span>
    </span>
  );

  const common = {
    className: cls,
    "data-btn": variant,
    "data-togglecontent": "none",
    "data-cursor": "hide",
    title,
    "aria-label": props["aria-label"],
  };

  if (href && !disabled) {
    return (
      <a
        ref={(n) => {
          el.current = n;
        }}
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        data-router-disabled={external ? "" : undefined}
        onClick={onClick}
        {...common}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      ref={(n) => {
        el.current = n;
      }}
      type={type}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={props["aria-pressed"]}
      aria-expanded={props["aria-expanded"]}
      {...common}
    >
      {inner}
    </button>
  );
}

/** Remounts when the label or look changes, since SvgButton clones the content once at build time. */
export default function Button(props: ButtonProps) {
  const key = `${typeof props.children === "string" || typeof props.children === "number" ? props.children : ""}|${props.variant}|${props.tone}|${props.size}|${props.arrow}|${props.disabled}`;
  return <Inner key={key} {...props} />;
}

export { Button };
