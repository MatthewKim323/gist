// Initials avatar for a profile. Color comes from profiles.avatar_color.
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : "")).toUpperCase();
}

export default function Avatar({ name, color, size }: { name: string; color?: string | null; size?: "sm" | "lg" }) {
  return (
    <span className={`gp-avatar${size ? ` gp-avatar--${size}` : ""}`} style={{ ["--gp-av" as string]: color ?? undefined }} aria-hidden>
      {initialsOf(name)}
    </span>
  );
}
