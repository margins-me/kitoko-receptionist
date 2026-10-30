import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { anonClient, getProPage } from "@kitoko/db";
import { ProPageView } from "@/components/pro-page/pro-page-view";
import { asLocale, localePath } from "@/i18n/locale";

// Live data on every request: the page shows what the receptionist books.
export const dynamic = "force-dynamic";

// Lowercase letters, digits, dots and hyphens: /aicha.braids, /studio-nala.
const HANDLE = /^[a-z0-9]([a-z0-9.-]{1,28}[a-z0-9])$/;

const pageFor = (handle: string) => (HANDLE.test(handle) ? getProPage(anonClient(), handle) : null);

export async function generateMetadata({ params }: PageProps<"/[locale]/[handle]">): Promise<Metadata> {
  const { locale, handle } = await params;
  const page = await pageFor(handle);
  if (!page) return {};
  const t = await getTranslations({ locale: asLocale(locale), namespace: "page" });
  const description = page.pro.bio ?? t("metaDescription", { name: page.pro.name });
  return {
    title: page.pro.name,
    description,
    openGraph: { title: page.pro.name, description, siteName: "Kitoko AI Front Desk" },
  };
}

export default async function ProPage({ params }: PageProps<"/[locale]/[handle]">) {
  const { locale: raw, handle } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const lower = handle.toLowerCase();
  if (lower !== handle && HANDLE.test(lower)) permanentRedirect(localePath(`/${lower}`, locale));
  const page = await pageFor(handle);
  if (!page) notFound();
  return <ProPageView page={page} locale={locale} />;
}
