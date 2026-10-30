import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fixtureState, isFixture } from "@/components/pay/fixtures";
import { PayView } from "@/components/pay/pay-view";
import type { ReturnNotice } from "@/components/pay/pay-view";
import type { PayState } from "@/components/pay/types";
import { asLocale } from "@/i18n/locale";
import { getPayState, openPayPage } from "./actions";

// Deposit page (docs/architecture.md, "HTTP routes"). ?fixture=held|held-fake|confirmed|expired|cancelled renders a
// static booking for local design checks; production ignores it.

type Props = PageProps<"/[locale]/pay/[id]">;

const fixtureOf = async (searchParams: Props["searchParams"]) => {
  if (process.env.NODE_ENV === "production") return null;
  const value = (await searchParams).fixture;
  return isFixture(value) ? value : null;
};

async function load(id: string, searchParams: Props["searchParams"], now: number, opened = false): Promise<{ state: PayState | null; fixture: boolean }> {
  const fixture = await fixtureOf(searchParams);
  if (fixture) return { state: fixtureState(fixture, now, process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || null), fixture: true };
  // The page itself (not its metadata, polling or the chat card) counts as opening it: the hold gets its one refresh.
  if (opened) await openPayPage(id);
  return { state: await getPayState(id), fixture: false };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const { state } = await load(id, searchParams, Date.now());
  if (!state) return {};
  const t = await getTranslations({ locale: asLocale(locale), namespace: "pay" });
  return { title: t("metaTitle", { pro: state.booking.proName }), robots: { index: false, follow: false } };
}

export default async function PayPage({ params, searchParams }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  await connection();
  const now = Date.now();
  const { state, fixture } = await load(id, searchParams, now, true);
  if (!state) notFound();
  return <PayView initial={state} locale={locale} serverNow={now} fixture={fixture} returnNotice={returnNoticeOf(await searchParams)} />;
}

/** The return route's ?error= (declined, ...) and ?pending=1, and PayPal's cancel URL ?cancelled=1. */
function returnNoticeOf(q: Record<string, string | string[] | undefined>): ReturnNotice {
  const error = typeof q.error === "string" ? q.error : null;
  if (error) return error === "declined" ? "declined" : "error";
  if (q.pending === "1") return "pending";
  if (q.cancelled === "1") return "cancelled";
  return null;
}
