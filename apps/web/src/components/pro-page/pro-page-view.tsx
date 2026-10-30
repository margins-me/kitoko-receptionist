import { preload } from "react-dom";
import { fromPrice, formatMoney, isCurrency } from "@kitoko/booking";
import type { Currency } from "@kitoko/booking";
import { bookingFacts } from "@kitoko/booking/facts";
import { pickText } from "@kitoko/booking/locale";
import type { ProPage as ProPageData } from "@kitoko/db";
import { LOCALES } from "@kitoko/i18n";
import { parseAppearance, resolveAppearance } from "@kitoko/themes";
import type { CoverPhoto, Layout } from "@kitoko/themes";
import { Brand } from "@kitoko/ui/brand";
import { ChevronDown, Globe } from "@kitoko/ui/icons";
import { formatDuration, formatTime } from "@kitoko/ui/format";
import { bioInInfos, contactLinks, coverSizes, PHOTO_SIZES, ProPage, serviceGroups } from "@kitoko/ui/pro-page";
import type { PageCover, PageImage, PageInfo, PageService, ProPageProps } from "@kitoko/ui/pro-page";
import { accentButton, barLabel, barValue } from "@kitoko/ui/pro-page/styles";
import { getImageProps } from "next/image";
import { getTranslations } from "next-intl/server";
import { ChatLauncher } from "@/components/chat/launcher";
import { TITLE_FONT_CLASS } from "@/fonts/title-fonts";
import { LANGUAGE_NAMES, localePath } from "@/i18n/locale";
import type { Locale } from "@/i18n/routing";
import { capitalize, openIntervals, weekdayLong, weeklyGroups } from "./hours";
import { ruleGroups } from "./rule-groups";

// The public page: the database and the messages turned into <ProPage>'s display-ready props. Ported from Kitoko
// without the shop, reviews, waitlist, booking flow and demo banner: every "Book" opens the chat (ChatLauncher).
// Photos are app paths (/photos/…), optimised with getImageProps, or absolute URLs shown as they are.

/** Shown in the address pill. */
const HOST = "demo.kitoko.page";

/** Where every booking link points: ChatLauncher opens the chat on a click (see its contract). */
const CHAT = "#chat";

type PageT = Awaited<ReturnType<typeof getTranslations<"page">>>;
type Pro = ProPageData["pro"];

/**
 * Her currency (pros.currency). Read defensively: until @kitoko/db's ProPage declares the column, a page without it
 * is in euros, as every Kitoko page was.
 */
const currencyOf = (pro: Pro): Currency => ("currency" in pro && isCurrency(pro.currency) ? pro.currency : "EUR");

/**
 * A photo. An app path goes through the image optimiser: with `sizes` the srcset carries width descriptors and
 * ProPage sets `sizes` where it shows it; without, 1x/2x for a fixed size (avatar). An absolute URL stays as it is.
 */
function photo(path: string, alt: string, sizes: string | undefined, width = 1600, height = 1600): PageImage {
  if (!path.startsWith("/")) return { src: path, alt };
  const { props } = getImageProps({ src: path, alt, width, height, sizes });
  return { src: props.src, srcSet: props.srcSet, alt, width: Number(props.width), height: Number(props.height) };
}

/** The cover for its layout, preloaded: it is the page's largest paint. */
function pageCover(cover: CoverPhoto | null, layout: Layout): PageCover | null {
  if (!cover || layout === "sans") return null;
  const sizes = coverSizes(layout);
  const image = photo(cover.path, "", sizes, cover.width ?? 2560, cover.height ?? 1280);
  preload(image.src, { as: "image", imageSrcSet: image.srcSet, imageSizes: sizes, fetchPriority: "high" });
  return { image, focalX: cover.focalX, focalY: cover.focalY };
}

/** The week's opening hours, consecutive days with the same hours grouped; closed days left out. */
function openHours(schedule: Pro["schedule"], locale: Locale, t: PageT): string[] {
  return weeklyGroups(schedule).flatMap((g) => {
    if (!g.hours) return [];
    const first = capitalize(weekdayLong(g.first, locale));
    const last = weekdayLong(g.last, locale);
    const days =
      g.first === g.last ? first : g.last === g.first + 1 ? t("infos.dayPair", { first, last }) : t("infos.dayRange", { first, last });
    const times = openIntervals(g.hours)
      .map(([from, to]) => t("infos.timeRange", { from: formatTime(from, locale), to: formatTime(to, locale) }))
      .join(", ");
    return [`${days}, ${times}`];
  });
}

/** A service's first photo for its 56 px square (1x/2x). */
const serviceImage = (photos: string[]): PageImage | null => (photos[0] ? photo(photos[0], "", undefined, 56, 56) : null);

function services(page: ProPageData, locale: Locale, currency: Currency, t: PageT): PageService[] {
  // Categories in the pro's order, uncategorised services last; headings only when there is a choice.
  const groups = serviceGroups(page.categories, page.services, t("services.uncategorised"));
  return groups.flatMap((group) =>
    group.services.map((s) => {
      const from = fromPrice(s);
      const varies = s.optionGroups.some((g) => new Set(g.options.map((o) => o.priceCents)).size > 1);
      const price = formatMoney(from.priceCents, locale, currency);
      return {
        id: s.id,
        name: pickText(s.name, locale),
        price: varies ? t("services.from", { price }) : price,
        duration:
          from.minMinutes === from.maxMinutes
            ? formatDuration(from.minMinutes, locale)
            : t("services.durationRange", { min: formatDuration(from.minMinutes, locale), max: formatDuration(from.maxMinutes, locale) }),
        description: s.description,
        group: groups.length > 1 ? group.title : undefined,
        // The chat opens on this service (ChatLauncher reads ?service=).
        href: `?service=${encodeURIComponent(s.id)}${CHAT}`,
        image: serviceImage(s.photos),
      };
    }),
  );
}

/** The desktop card's line: the deposit taken with PayPal when booking, and when the address comes. */
function depositLine(pro: Pro, locale: Locale, currency: Currency, t: PageT): string {
  const deposit = pro.rules.deposit;
  const taken =
    deposit.mode === "fixed" ? t("card.depositFixed", { amount: formatMoney(deposit.cents, locale, currency) })
    : deposit.mode === "percent" ? t("card.depositPercent", { percent: deposit.percent })
    : deposit.mode === "full" ? t("card.depositFull")
    : null;
  return taken ? `${taken} ${t("card.addressAfterPayment")}` : t("infos.addressNote");
}

function infos(pro: Pro, locale: Locale, currency: Currency, t: PageT, contacts: ProPageProps["contacts"]): PageInfo[] {
  const { policy, onTheDay } = ruleGroups(pro.rules, locale, currency);
  const hours = openHours(pro.schedule, locale, t);
  return [
    ...(bioInInfos(pro.bio) ? [{ id: "about", label: t("infos.about"), value: pro.bio }] : []),
    // City only: the exact address comes after booking.
    { id: "address", label: t("infos.address"), value: [pro.areaLabel && `${pro.areaLabel}.`, t("infos.addressNote")].filter(Boolean).join(" ") },
    {
      id: "hours",
      label: t("infos.hours"),
      value: hours.length > 0 ? hours.map((line) => <span key={line} className="block">{line}</span>) : t("infos.closed"),
    },
    ...(policy.length > 0 ? [{ id: "policy", label: t("infos.policy"), value: policy.join(" ") }] : []),
    ...(onTheDay.length > 0 ? [{ id: "late", label: t("infos.onTheDay"), value: onTheDay.join(" ") }] : []),
    ...(contacts.length > 0
      ? [
          {
            id: "contact",
            label: t("infos.contact"),
            value: (
              <span className="flex flex-wrap gap-2 pt-1.5">
                {contacts.map((c) => (
                  <a
                    key={c.key}
                    href={c.href}
                    rel="noopener"
                    className="inline-flex min-h-11 items-center rounded-full border border-page-line px-4 text-ui font-semibold text-page-fg no-underline"
                  >
                    {c.label}
                  </a>
                ))}
              </span>
            ),
          },
        ]
      : []),
  ];
}

/** The page in each language: English without a prefix, the others under /fr, /it… */
function LanguageMenu({ handle, locale, label }: { handle: string; locale: Locale; label: string }) {
  return (
    // ponytail: <details> opens upward with no JS; picking a language loads the page anyway.
    <details className="group relative ml-auto shrink-0">
      <summary aria-label={label} className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 hover:text-page-fg [&::-webkit-details-marker]:hidden">
        <Globe aria-hidden className="size-3.5" />
        {LANGUAGE_NAMES[locale]}
        <ChevronDown aria-hidden className="size-3.5 transition-transform group-open:rotate-180" />
      </summary>
      <ul className="absolute right-0 bottom-full z-10 mb-1 flex flex-col rounded-2xl border border-page-line bg-page px-4 py-1 shadow-lg">
        {LOCALES.map((l) => (
          <li key={l}>
            <a
              href={localePath(`/${handle}`, l)}
              hrefLang={l}
              lang={l}
              aria-current={l === locale ? "page" : undefined}
              className="flex min-h-11 items-center text-page-muted no-underline hover:text-page-fg aria-[current=page]:font-semibold aria-[current=page]:text-page-fg"
            >
              {LANGUAGE_NAMES[l]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

export async function ProPageView({ page, locale }: { page: ProPageData; locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "page" });
  const tCommon = await getTranslations({ locale, namespace: "common" });
  const { pro } = page;
  // @kitoko/db returns the raw appearance columns; parseAppearance validates them into Kitoko's PageAppearance.
  const appearance = parseAppearance(pro.appearance);
  const resolved = resolveAppearance(appearance);
  const currency = currencyOf(pro);
  // The demo pros' numbers are fictional: WhatsApp opens the simulator, which runs her receptionist's WhatsApp channel.
  const contacts = contactLinks(pro).map((c) => ({
    ...c,
    ...(c.key === "whatsapp" ? { href: localePath(`/${pro.handle}/whatsapp`, locale) } : {}),
    label: t(`infos.${c.key}`),
  }));
  const hasServices = page.services.length > 0;

  return (
    <Brand theme={resolved.theme}>
      <ProPage
        appearance={resolved}
        fontClassName={TITLE_FONT_CLASS[resolved.titleFont]}
        host={HOST}
        pro={{
          name: pro.name,
          handle: pro.handle,
          tagline: pro.bio,
          avatar: pro.avatarPath ? photo(pro.avatarPath, "", undefined, 120, 120) : null,
        }}
        cover={pageCover(appearance.cover, resolved.layout)}
        photos={appearance.gallery.map((path, i) => photo(path, t("photos.alt", { name: pro.name, n: i + 1 }), PHOTO_SIZES.grid))}
        contacts={contacts}
        // Area and what booking with her guarantees; her open days stay in Infos > Hours. Every deposit goes through
        // PayPal, so her payments are always on.
        facts={{
          area: pro.areaLabel,
          booking: bookingFacts(page.services, pro.rules, true).map((fact) => t(`facts.${fact}`)),
        }}
        services={services(page, locale, currency, t)}
        servicesNote={page.services.some((s) => s.optionGroups.length > 0) ? t("services.pricingNote") : null}
        reviews={null}
        infos={infos(pro, locale, currency, t, contacts)}
        book={hasServices ? { label: t("bar.chat"), href: CHAT } : null}
        card={{ deposit: depositLine(pro, locale, currency, t) }}
        labels={{
          tabs: {
            prestations: t("tabs.services"),
            photos: t("tabs.photos"),
            avis: t("tabs.reviews"),
            infos: t("tabs.infos"),
            boutique: t("tabs.shop"),
          },
          tabList: t("sections"),
          close: tCommon("close"),
          share: t("share"),
          copied: t("linkCopied"),
          servicesEmpty: t("services.empty", { name: pro.name }),
          photos: t("photos.strip", { name: pro.name }),
          nextSlot: t("bar.label"),
          nextSlots: t("card.title"),
          moreServices: t.raw("services.more") as string,
          fewerServices: t("services.less"),
          allPhotos: t.raw("photos.all") as string,
        }}
        slots={{
          bar: hasServices ? (
            <>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={barLabel}>{t("bar.label")}</span>
                <strong className={barValue}>{t("bar.value")}</strong>
              </div>
              <ChatLauncher
                handle={pro.handle}
                locale={locale}
                label={t("bar.chat")}
                className={accentButton}
                proName={pro.name}
                avatar={pro.avatarPath ? photo(pro.avatarPath, "", undefined, 80, 80) : null}
                services={page.services.map((s) => ({ id: s.id, name: pickText(s.name, locale) }))}
              />
            </>
          ) : undefined,
          nextSlots: hasServices ? (
            <>
              <p className="text-ui text-page-muted">{t("card.intro")}</p>
              <a href={localePath(`/${pro.handle}/whatsapp`, locale)} className="mt-2 inline-flex min-h-11 items-center text-ui font-semibold text-page-fg underline underline-offset-4">
                {t("card.whatsapp")} →
              </a>
            </>
          ) : undefined,
          footer: (
            <footer className="flex items-center justify-between gap-4 border-t border-page-line text-caption text-page-muted">
              <a href={localePath("/", locale)} className="inline-flex min-h-11 items-center text-page-muted no-underline hover:text-page-fg">
                Kitoko · AI front desk
              </a>
              <LanguageMenu handle={pro.handle} locale={locale} label={t("language")} />
            </footer>
          ),
        }}
      />
    </Brand>
  );
}
