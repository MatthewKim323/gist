"use client";
// THE Button as a full-page link (the engine router only knows its own views). For server components.
import Button, { type ButtonProps } from "@/components/gist/ui/Button";

export default function NavButton({ href, ...rest }: Omit<ButtonProps, "onClick"> & { href: string }) {
  return (
    <Button
      {...rest}
      href={href}
      onClick={(e) => {
        e.preventDefault();
        window.location.assign(href);
      }}
    />
  );
}
