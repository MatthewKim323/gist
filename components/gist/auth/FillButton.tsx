"use client";
// Home-screen fill button (same markup as "Open the case" in PersistentContent) with the engine's
// SvgButton hover. Swap for components/gist/ui/Button.tsx once that lands on main.
import { useEffect, useRef } from "react";

export default function FillButton({
  label,
  onClick,
  disabled,
  title,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let btn: { destroy?: () => void } | null = null;
    let dead = false;
    import("@/lib/engine/dom/svg-button")
      .then(({ SvgButton }) => {
        if (!dead && el.isConnected) btn = new SvgButton(el) as unknown as { destroy?: () => void };
      })
      .catch(() => null);
    return () => {
      dead = true;
      try {
        btn?.destroy?.();
      } catch {
        /* engine teardown is best-effort */
      }
    };
  }, [label]);
  return (
    <a
      ref={ref}
      href="#"
      role="button"
      aria-disabled={disabled || undefined}
      title={title ?? label}
      data-router-disabled
      className="btn btn--regular btn--fill btn--light js-manager-ignore js-btn"
      data-btn="fill"
      style={disabled ? { opacity: 0.45, pointerEvents: "none" } : undefined}
      onClick={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
    >
      <span className="btn__inner js-btn-inner">
        <span className="btn__content js-btn-content">
          <span className="d-flex flex-row items-end">
            <span className="btn__text">{label}</span>
            <svg className="btn__icon d-inline-block js-btn-icon">
              <use href="#arrow"></use>
            </svg>
          </span>
        </span>
      </span>
    </a>
  );
}
