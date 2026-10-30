"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { StatusMark } from "./micro/status-mark";

const ToastContext = createContext<((message: string) => void) | null>(null);

/** One toast at a time, announced politely, gone after 3 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null);
  const show = useCallback((message: string) => setToast({ id: Date.now(), message }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext value={show}>
      {children}
      <div role="status" className="pointer-events-none fixed inset-x-4 bottom-26 z-60 flex justify-center desk:bottom-6">
        {toast && (
          <span
            key={toast.id}
            className="inline-flex animate-pop-in items-center gap-2 rounded-full bg-inverse py-2.5 pr-4 pl-3 text-sm font-medium text-on-inverse shadow-toast desk:py-3 desk:pr-4.5 desk:pl-3.5 desk:text-ui"
          >
            <StatusMark status="done" size={18} />
            {toast.message}
          </span>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a <ToastProvider> above it.");
  return show;
}
