import type { Metadata, Viewport } from "next";
import { hasLocale } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { hanken } from "@/fonts/hanken";
import { routing } from "@/i18n/routing";
import "../globals.css";

export const metadata: Metadata = {
  title: { default: "Kitoko AI Front Desk", template: "%s · Kitoko" },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  viewportFit: "cover",
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// No NextIntlClientProvider: the pages translate on the server; a client island that needs messages adds its own.
export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  return (
    <html lang={locale} className={hanken.variable}>
      <body>{children}</body>
    </html>
  );
}
