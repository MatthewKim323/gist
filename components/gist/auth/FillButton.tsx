"use client";
// Sign-in actions use the shared home-screen button (components/gist/ui/Button.tsx). Keyed by label
// because SvgButton clones the label into its own nodes once at mount.
import Button from "@/components/gist/ui/Button";

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
  return (
    <Button key={label} arrow disabled={disabled} title={title ?? label} onClick={() => !disabled && onClick()}>
      {label}
    </Button>
  );
}
