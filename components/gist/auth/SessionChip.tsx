"use client";
// "signed in as <name> · switch". Mount anywhere (dashboard header, provider portal). Renders nothing
// when no one is signed in. Switching clears the cookie and goes back to /signin.
import { useEffect, useState } from "react";
import "./auth.css";

interface Info {
  role: "firm" | "provider";
  name: string;
}

export default function SessionChip({ initial, className }: { initial?: Info | null; className?: string }) {
  const [s, setS] = useState<Info | null>(initial ?? null);
  useEffect(() => {
    if (initial !== undefined) return;
    let live = true;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { session: Info | null }) => live && setS(j.session))
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [initial]);
  if (!s) return null;
  const sw = async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => null);
    window.location.assign("/signin");
  };
  return (
    <div className={`ga-chip${className ? ` ${className}` : ""}`}>
      <span className="ga-chip__dot" data-role={s.role} aria-hidden />
      <span>
        signed in as <strong>{s.name}</strong>
      </span>
      <span aria-hidden>·</span>
      <button type="button" className="ga-chip__btn" onClick={sw}>
        switch
      </button>
    </div>
  );
}
