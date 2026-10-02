import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** className joiner the bklit chart sources expect at @/lib/utils. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
