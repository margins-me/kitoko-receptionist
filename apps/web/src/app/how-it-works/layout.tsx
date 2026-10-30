import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { hanken } from "@/fonts/hanken";
import "../globals.css";

// Its own root layout: English only, no locale prefix (src/proxy.ts skips /how-it-works).

export const metadata: Metadata = { title: "How it works · Kitoko" };

export const viewport: Viewport = { themeColor: "#FFFFFF", viewportFit: "cover" };

export default function HowItWorksLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="bg-stone text-ink">{children}</body>
    </html>
  );
}
