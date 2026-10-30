"use client";

import { useRef } from "react";

/**
 * Sheets and dialogs here are opened from state, not from a Radix Trigger, so Radix has nowhere to
 * send focus back on close and it lands on <body>. Remember what had focus when `open` turned true
 * and return there; pass the result as `onCloseAutoFocus`.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  // false, not `open`: lazily loaded sheets first render already open, and that counts as opening.
  const wasOpen = useRef(false);
  // Read during render, before the dialog mounts and moves focus inside itself.
  if (open && !wasOpen.current && typeof document !== "undefined") {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;
  return (event: Event) => {
    const target = opener.current;
    if (target?.isConnected) {
      event.preventDefault();
      target.focus();
    }
  };
}
