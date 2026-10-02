"use client";

// Drop-in "Brief me" for the dashboard shell. Must render inside the dashboard's CiteProvider so the
// agent's open_source tool can open the source drawer; outside it, open_source answers "not available".
import { useCites } from "@/components/gist/dashboard/cite";
import VoiceButton, { type VoiceButtonProps } from "./VoiceButton";

export default function VoiceBriefButton({ matterId, ...rest }: { matterId: number } & Partial<Omit<VoiceButtonProps, "mode" | "matterId">>) {
  const { open, fixture } = useCites();
  if (fixture) return null;
  return <VoiceButton mode="firm" matterId={matterId} label="Brief me" onOpenSource={open} {...rest} />;
}

export { VoiceBriefButton };
