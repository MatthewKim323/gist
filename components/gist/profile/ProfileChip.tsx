"use client";
// Profile chip: avatar initials + name + role, with a menu (Profile, Switch account, Sign out).
// Mount anywhere; renders nothing when signed out. `initial` paints first, then the live profile loads.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Avatar from "./Avatar";
import { signOut, switchAccount } from "./signout";
import "@/app/styles/gist-profile.css";

export interface ChipInfo {
  role: "firm" | "provider";
  name: string;
  title?: string | null;
  color?: string | null;
  org?: string | null;
}

interface SessionRes {
  session: { role: "firm" | "provider"; name: string } | null;
  profile: { display_name: string; title: string | null; avatar_color: string | null; firm_name: string | null } | null;
}

export default function ProfileChip({ initial, className }: { initial?: ChipInfo | null; className?: string }) {
  const [s, setS] = useState<ChipInfo | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  // The menu renders in document.body at fixed coordinates so cramped top bars (overflow, stacking) can't clip it.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (initial === null) return; // server says signed out
    let live = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: SessionRes) => {
        if (!live) return;
        if (!j.session) return setS(null);
        setS({
          role: j.session.role,
          name: j.profile?.display_name ?? j.session.name,
          title: j.profile?.title ?? null,
          color: j.profile?.avatar_color ?? null,
          org: j.profile?.firm_name ?? null,
        });
      })
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [initial]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const r = root.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const away = (e: MouseEvent) =>
      !root.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  if (!s) return null;
  const roleLabel = s.title || (s.role === "firm" ? "Firm" : "Provider");

  return (
    <div ref={root} className={`gp-chip${className ? ` ${className}` : ""}`}>
      <button type="button" className="gp-chip__btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Avatar name={s.name} color={s.color} size="sm" />
        <span className="gp-chip__who">
          <span className="gp-chip__name">{s.name}</span>
          <span className="gp-chip__role">{roleLabel}</span>
        </span>
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div ref={menu} className="gp-menu gp-menu--portal" role="menu" style={{ top: pos.top, right: pos.right }}>
          <div className="gp-menu__head">
            Signed in as {s.role === "firm" ? "firm staff" : "a treating provider"}
            {s.org ? `, ${s.org}` : ""}
          </div>
          <a className="gp-menu__item" role="menuitem" href="/profile" data-router-disabled>
            Profile
          </a>
          <a className="gp-menu__item" role="menuitem" href={s.role === "firm" ? "/cases" : "/provider"} data-router-disabled>
            Your cases
          </a>
          <div className="gp-menu__sep" />
          <button type="button" className="gp-menu__item" role="menuitem" onClick={switchAccount}>
            Switch account
          </button>
          <button type="button" className="gp-menu__item" role="menuitem" onClick={() => signOut("/")}>
            Sign out
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
