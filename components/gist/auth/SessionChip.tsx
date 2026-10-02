"use client";
// Kept for existing mounts (dashboard Header, /cases, /provider): the profile chip with its menu
// (Profile, Switch account, Sign out). See components/gist/profile/ProfileChip.tsx.
import ProfileChip, { type ChipInfo } from "@/components/gist/profile/ProfileChip";

export default function SessionChip({ initial, className }: { initial?: ChipInfo | null; className?: string }) {
  return <ProfileChip initial={initial} className={className} />;
}
