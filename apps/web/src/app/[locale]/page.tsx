import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowRight, ArrowUpRight, CalendarDays, Plug, Workflow } from "@kitoko/ui/icons";
import { asLocale, LANGUAGE_NAMES, localePath } from "@/i18n/locale";
import type { Locale } from "@/i18n/routing";
import { BrandMark } from "@/components/brand/brand-mark";
import { UnderTheHoodSheet } from "@/components/brand/under-the-hood-sheet";

// The judge-facing landing: what it is, the four demo pros, and the way under the hood. Hardcoded cards (the seed's
// pros, supabase/seed.sql); every link but the pro pages is English-only and unprefixed.

type DemoPro = { key: "aicha" | "anta" | "nala" | "kemi"; name: string; href: string; photo: string; locale: Locale; currency: "EUR" | "GBP" };

const DEMO_PROS: DemoPro[] = [
  { key: "aicha", name: "Aïcha Braids", href: "/aicha.braids", photo: "/photos/box-braids-chignon.jpg", locale: "en", currency: "EUR" },
  { key: "anta", name: "Anta Tresses", href: "/anta.tresses", photo: "/photos/cils-tresses-gros-plan.jpg", locale: "en", currency: "EUR" },
  { key: "nala", name: "Studio Nala", href: "/fr/studio-nala", photo: "/photos/cheveux-naturels-afro.jpg", locale: "fr", currency: "EUR" },
  { key: "kemi", name: "Kemi Nails", href: "/kemi.nails", photo: "/photos/ongles-ecaille-main.jpg", locale: "en", currency: "GBP" },
];

const chip = "inline-flex h-6 items-center rounded-full bg-stone px-2.5 text-caption font-medium text-body";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: "landing" });
  return { title: { absolute: t("metaTitle") }, description: t("metaDescription") };
}

export default async function Landing({ params }: PageProps<"/[locale]">) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "landing" });
  const tc = await getTranslations({ locale, namespace: "common" });
  const more = [
    { key: "dashboard", href: "/dashboard", icon: CalendarDays, detail: null },
    { key: "howItWorks", href: "/how-it-works", icon: Workflow, detail: null },
    { key: "mcp", href: "/api/mcp", icon: Plug, detail: "/api/mcp" },
  ] as const;

  const moreLinks = (stacked: boolean) => (
    <ul className={stacked ? "grid gap-3" : "grid gap-3 sm:grid-cols-3 sm:gap-4"}>
      {more.map(({ key, href, icon: Icon, detail }) => (
        <li key={key}>
          <a
            href={href}
            className="group flex h-full flex-col gap-3 rounded-card border border-stone-line p-4 text-ink no-underline transition-colors hover:border-ink hover:bg-surface"
          >
            <span className="flex items-center justify-between">
              <span className="inline-flex size-10 items-center justify-center rounded-full bg-ink text-on-inverse">
                <Icon aria-hidden className="size-5" />
              </span>
              <ArrowUpRight aria-hidden className="size-5 text-muted group-hover:text-ink" />
            </span>
            <span>
              <span className="block text-lead font-bold">{t(`more.${key}.title`)}</span>
              <span className="mt-1 block text-ui text-muted">{t(`more.${key}.body`)}</span>
            </span>
            {detail && (
              <code className="self-start rounded-lg bg-surface px-2 py-1 font-mono text-caption text-ink group-hover:bg-stone">{detail}</code>
            )}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="min-h-dvh bg-stone text-ink">
      <div className="mx-auto flex min-h-dvh max-w-page flex-col px-4 pt-2 pb-[max(24px,env(safe-area-inset-bottom))] sm:px-6 sm:pt-4">
        <header className="sticky top-0 z-20 -mx-4 flex min-h-11 items-center justify-between gap-3 bg-stone/85 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6">
          <BrandMark href={localePath("/", locale)} size="lg" />
          <span className="flex items-center gap-2">
            <UnderTheHoodSheet label={t("more.button")} title={t("more.title")} closeLabel={tc("close")}>
              {moreLinks(true)}
            </UnderTheHoodSheet>
            <a
              href="/dashboard"
              className="inline-flex min-h-11 items-center rounded-full border border-stone-line bg-surface px-4 text-ui font-semibold text-ink no-underline hover:border-ink"
          >
              {t("proLogin")}
            </a>
          </span>
        </header>

        <main className="flex flex-1 flex-col">
          <section aria-labelledby="hero-title" className="fade-up pt-12 pb-10 sm:pt-20 sm:pb-14">
            <p className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-caption font-medium text-body">
              <span aria-hidden className="size-2 rounded-full bg-honey" />
              {t("badge")}
            </p>
            <h1 id="hero-title" className="mt-5 max-w-[16em] text-[34px] leading-[1.04] font-bold tracking-hero text-balance sm:text-[56px]">
              {t("title")}
            </h1>
            <p className="mt-5 max-w-[30em] text-[18px] leading-snug text-body sm:text-[22px]">{t("pitch")}</p>
          </section>

          <section aria-labelledby="demo-title">
            <h2 id="demo-title" style={{ "--d": "120ms" } as CSSProperties} className="fade-up text-[22px] leading-tight font-bold tracking-tight">
              {t("demo.title")}
            </h2>
            <p className="mt-1.5 max-w-[34em] text-ui text-muted">{t("demo.intro")}</p>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {DEMO_PROS.map((pro, i) => (
                <li key={pro.key} className="fade-up" style={{ "--d": `${200 + i * 80}ms` } as CSSProperties}>
                  <a
                    href={pro.href}
                    className="group grid grid-cols-[96px_1fr] overflow-hidden rounded-card bg-surface text-ink no-underline transition-shadow hover:shadow-raise focus-visible:shadow-raise sm:grid-cols-1"
                  >
                    <span className="relative block aspect-[4/5] overflow-hidden bg-soft">
                      <Image
                        src={pro.photo}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 280px, (min-width: 640px) 360px, 96px"
                        priority={i === 0}
                        className="object-cover transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
                      />
                    </span>
                    <span className="flex min-w-0 flex-col justify-between gap-3 p-4">
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate text-lead font-bold">{pro.name}</span>
                          <span className="mt-0.5 block text-ui text-muted">{t(`pros.${pro.key}`)}</span>
                        </span>
                        <ArrowRight aria-hidden className="mt-1 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        <span className={chip} lang={pro.locale}>
                          {LANGUAGE_NAMES[pro.locale]}
                        </span>
                        <span className={chip}>{pro.currency}</span>
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="more-title" className="fade-up mt-12" style={{ "--d": "520ms" } as CSSProperties}>
            <h2 id="more-title" className="text-[22px] leading-tight font-bold tracking-tight">
              {t("more.title")}
            </h2>
            <div className="mt-5">{moreLinks(false)}</div>
          </section>
        </main>

        <footer className="mt-14 flex flex-col gap-1 border-t border-stone-line pt-5 text-caption text-muted sm:flex-row sm:items-center sm:justify-between">
          <p>{t("footer")}</p>
          <p className="shrink-0">PayPal AI Hackathon</p>
        </footer>
      </div>
    </div>
  );
}
