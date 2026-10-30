import { clsx } from "clsx";
import type { ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["input", "chip", "card", "ticket", "sheet"],
      shadow: ["sheet", "panel", "modal", "ticket", "toast"],
      tracking: ["title", "display"],
      text: ["caption", "ui", "lead", "panel-title", "page-title", "title"],
      ease: ["out-quint", "emphasized"],
    },
    // pb-safe (styles.css) is a padding-bottom, so a caller's pb-* replaces it (e.g. <BottomBar className="pb-3">).
    classGroups: { pb: [{ pb: ["safe"] }] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
