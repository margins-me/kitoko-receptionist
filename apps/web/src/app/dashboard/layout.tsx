import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { hanken } from "@/fonts/hanken";
import "../globals.css";

// The pro dashboard (login, Bryntum Scheduler, pro assistant, deposits). Its own root layout: English only, no locale
// prefix (src/proxy.ts skips /dashboard).

export const metadata: Metadata = {
  title: { default: "Dashboard · Kitoko", template: "%s · Kitoko" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#FFFFFF", viewportFit: "cover" };

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={hanken.variable}>
      <body className="bg-stone text-ink">{children}</body>
    </html>
  );
}
