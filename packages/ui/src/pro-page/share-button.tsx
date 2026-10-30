"use client";

import { useEffect, useState } from "react";
import { toolbarButton } from "./styles";

export type ShareButtonProps = {
  /** "Partager la page". */
  label: string;
  /** "Lien copié", shown when the share sheet is not available and the link went to the clipboard. */
  copied: string;
  /** The shared title: her name. */
  title: string;
  /** The shared link; default the page's address. */
  url?: string;
};

/** Shares the page's address (without its query): the share sheet, else the clipboard with a short toast. */
export function ShareButton({ label, copied, title, url: shared }: ShareButtonProps) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 2500);
    return () => clearTimeout(timer);
  }, [done]);

  const share = async () => {
    const url = shared ?? window.location.origin + window.location.pathname;
    try {
      if (navigator.share) return await navigator.share({ title, url });
      await navigator.clipboard.writeText(url);
      setDone(true);
    } catch {
      // Share sheet dismissed or clipboard blocked: nothing to report.
    }
  };

  return (
    <>
      <button type="button" aria-label={label} onClick={share} className={toolbarButton}>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
        </svg>
      </button>
      <span role="status" className="pointer-events-none fixed inset-x-4 bottom-[112px] z-50 flex justify-center desk:bottom-6">
        {done && <span className="animate-pop-in rounded-full bg-inverse px-4 py-2.5 text-sm font-medium text-on-inverse shadow-toast">{copied}</span>}
      </span>
    </>
  );
}
