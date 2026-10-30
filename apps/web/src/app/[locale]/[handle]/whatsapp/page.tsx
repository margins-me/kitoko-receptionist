import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { anonClient, getProPage } from "@kitoko/db";
import { WhatsAppSim } from "@/components/chat/whatsapp-sim";
import { asLocale, localePath } from "@/i18n/locale";

// The pro's receptionist on its WhatsApp channel, in a simulator (no Meta number needed to try it).
export const dynamic = "force-dynamic";

const HANDLE = /^[a-z0-9]([a-z0-9.-]{1,28}[a-z0-9])$/;

export async function generateMetadata({ params }: PageProps<"/[locale]/[handle]/whatsapp">): Promise<Metadata> {
  const { handle } = await params;
  const page = HANDLE.test(handle) ? await getProPage(anonClient(), handle) : null;
  return page ? { title: `${page.pro.name} on WhatsApp`, robots: { index: false } } : {};
}

export default async function WhatsAppPage({ params }: PageProps<"/[locale]/[handle]/whatsapp">) {
  const { locale: raw, handle } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const page = HANDLE.test(handle) ? await getProPage(anonClient(), handle) : null;
  if (!page) notFound();
  return (
    <main className="min-h-dvh bg-[#D1D7DB]">
      <WhatsAppSim handle={handle} locale={locale} proName={page.pro.name} backHref={localePath(`/${handle}`, locale)} />
    </main>
  );
}
