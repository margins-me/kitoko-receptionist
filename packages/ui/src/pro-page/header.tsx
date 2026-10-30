import type { ReactNode } from "react";
import type { Layout } from "@kitoko/themes";
import { Fragment } from "react";
import { coverPosition, coverSizes, initials, LOGO_SIZES, MOSAIC_MIN, onPhoto, PHOTO_SIZES } from "./model";
import type { FactsLine } from "./model";
import { Mosaic } from "./mosaic";
import { ShareButton } from "./share-button";
import { toolbar, toolbarRule } from "./styles";
import { Swipe } from "./swipe";
import type { PageContact, PageCover, PageImage, ProPageProps } from "./types";

// The four header variants (handover §5). Mobile sizes are the base, desktop ones behind @desk: (the page root is
// the container), so a scaled 390 or 1280 preview renders the right one.

/** Content column: 16 px gutters on phones, 1120 px wide on desktop. */
const WRAP = "mx-auto w-full max-w-[1168px] px-4 @desk:px-6";

type HeaderProps = Pick<ProPageProps, "host" | "domain" | "shareUrl" | "pro" | "photos" | "contacts" | "labels"> & {
  /** The facts line under her name (factsLine of her facts, or of the older chips). */
  facts: FactsLine;
  /** Next to the address, e.g. a demo page's "Démo" badge. */
  badge?: ReactNode;
  /** Rendered inside another page (preview): her name is not the document's h1 and the cover loads lazily. */
  embedded: boolean;
  /** Id of her name, which the name bar watches. */
  nameId: string;
  layout: Layout;
  cover: PageCover | null;
  bag: ReactNode;
};

function CoverImage({ cover, layout, className, embedded }: { cover: PageCover; layout: Layout; className: string; embedded: boolean }) {
  const { image } = cover;
  return (
    <img
      src={image.src}
      srcSet={image.srcSet}
      sizes={coverSizes(layout)}
      width={image.width}
      height={image.height}
      alt={image.alt}
      // The cover is the public page's LCP element; a preview's is not.
      loading={embedded ? "lazy" : "eager"}
      fetchPriority={embedded ? "auto" : "high"}
      decoding="async"
      className={`object-cover ${className}`}
      // Runtime value: her focal point.
      style={{ objectPosition: coverPosition(cover.focalX, cover.focalY) }}
    />
  );
}

function Name({ embedded, id, className, children }: { embedded: boolean; id: string; className: string; children: ReactNode }) {
  return embedded ? (
    <p id={id} className={className}>
      {children}
    </p>
  ) : (
    <h1 id={id} className={className}>
      {children}
    </h1>
  );
}

/**
 * Her name, or her logo in its place (sur-mesure, Pro plan). The logo keeps her name as alt, so the h1 keeps its
 * accessible name. `pill`: on a photo (plein), a white 94 % pill keeps a dark logo visible.
 */
function Title({ pro, pill }: { pro: ProPageProps["pro"]; pill?: boolean }) {
  const logo = pro.logo;
  if (!logo) return pro.name;
  const img = (
    <img
      src={logo.src}
      srcSet={logo.srcSet}
      sizes={LOGO_SIZES}
      width={logo.width}
      height={logo.height}
      alt={pro.name}
      decoding="async"
      className="block h-12 w-auto max-w-full object-contain object-left @desk:h-16"
    />
  );
  return pill ? <span className="inline-block max-w-full rounded-pp-chip bg-surface/94 px-3 py-2">{img}</span> : img;
}

function Avatar({ name, image, className }: { name: string; image: PageImage | null; className: string }) {
  if (image)
    return (
      <img
        src={image.src}
        srcSet={image.srcSet}
        alt=""
        width={image.width ?? 120}
        height={image.height ?? 120}
        decoding="async"
        className={`shrink-0 rounded-pp-avatar object-cover ${className}`}
      />
    );
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-pp-avatar bg-accent font-semibold text-on-accent ${className}`}>
      {initials(name)}
    </span>
  );
}

/** `compact`: in the name bar, on the page whatever the layout. */
function Actions({ layout, bag, labels, name, shareUrl, compact }: { layout: Layout; bag: ReactNode; labels: ProPageProps["labels"]; name: string; shareUrl?: string; compact?: boolean }) {
  return (
    <div className={compact ? toolbar(false, true) : toolbar(onPhoto(layout))}>
      {bag && (
        <>
          {bag}
          <span aria-hidden className={toolbarRule} />
        </>
      )}
      <ShareButton label={labels.share} copied={labels.copied} title={name} url={shareUrl} />
    </div>
  );
}

/** Bandeau and plein: the address pill and the buttons, on the photo. */
function PhotoBar(p: HeaderProps) {
  return (
    <div className="absolute inset-x-0 top-3 z-1 flex items-center justify-between gap-3 px-4 @desk:top-5 @desk:px-20">
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate rounded-pp-chip bg-surface/94 px-3 py-[7px] text-[13px] leading-tight font-semibold text-ink">
          {p.domain ?? `${p.host}/${p.pro.handle}`}
        </span>
        {p.badge}
      </span>
      <Actions layout={p.layout} bag={p.bag} labels={p.labels} name={p.pro.name} shareUrl={p.shareUrl} />
    </div>
  );
}

/** Encadré and sans: the page's address and the buttons, on the page. */
function LinkBar(p: HeaderProps) {
  return (
    <div className={`${WRAP} flex min-h-[60px] items-center justify-between gap-3 @desk:min-h-[76px]`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate text-ui font-semibold">
          {p.domain ?? (
            <>
              {p.host}/<span className="text-page-muted">{p.pro.handle}</span>
            </>
          )}
        </span>
        {p.badge}
      </span>
      <Actions layout={p.layout} bag={p.bag} labels={p.labels} name={p.pro.name} shareUrl={p.shareUrl} />
    </div>
  );
}

/** The one contact shown on phones, where the header has room for a single pill: Instagram, else the other. */
function phoneContact(contacts: PageContact[]): PageContact["key"] | undefined {
  return contacts.find((c) => c.key === "instagram")?.key ?? contacts[0]?.key;
}

/** All contacts on desktop; on phones only `phoneContact`, so a WhatsApp-only pro still shows hers. */
function Contacts({ contacts, className }: { contacts: PageContact[]; className: string }) {
  const onPhone = phoneContact(contacts);
  return contacts.map((c) => (
    <a
      key={c.key}
      href={c.href}
      rel="noopener"
      className={`${c.key === onPhone ? "inline-flex" : "hidden @desk:inline-flex"} items-center justify-center rounded-pp-button px-4 text-ui font-semibold no-underline ${className}`}
    >
      {c.label}
    </a>
  ));
}

function Tagline({ text, className }: { text: string | null; className: string }) {
  return text ? <p className={`line-clamp-2 ${className}`}>{text}</p> : null;
}

/** Bandeau and plein without a cover: her initials, large, in the accent colour the header is drawn in. */
function Monogram({ name, className }: { name: string; className: string }) {
  return <span aria-hidden className={`pointer-events-none absolute leading-none select-none title-type text-on-accent/20 ${className}`}>{initials(name)}</span>;
}

/**
 * Parts of a facts line, " · " between them. The dot holds to the part before it (no-break space), so a wrapped
 * line never starts with one; the dots are not read out.
 */
function Joined({ parts }: { parts: { key: string; node: ReactNode }[] }) {
  return parts.map((part, i) => (
    <Fragment key={part.key}>
      {part.node}
      {i < parts.length - 1 && (
        <>
          <span aria-hidden>{"\u00a0·"}</span>{" "}
        </>
      )}
    </Fragment>
  ));
}

function Star() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="mr-1 inline-block size-3.5 -translate-y-px align-middle">
      <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
    </svg>
  );
}

/**
 * Under her name, in every layout, on the page's own colours: "★ 4,9 (128 avis) · Paris 18e", then what is true
 * about booking with her ("Réservation 24h/24 · Confirmation immédiate"). The star line is read as its label
 * ("4,9 sur 5, 128 avis"). Nothing when there is nothing to say.
 */
function Facts({ facts, className }: { facts: FactsLine; className: string }) {
  const { rating, items, booking } = facts;
  if (!rating && items.length === 0 && booking.length === 0) return null;
  const first = [
    ...(rating
      ? [
          {
            key: "rating",
            node: (
              <>
                <span aria-hidden>
                  <span className="font-semibold text-page-fg">
                    <Star />
                    {rating.value}
                  </span>{" "}
                  {rating.count}
                </span>
                <span className="sr-only">{rating.label}</span>
              </>
            ),
          },
        ]
      : []),
    ...items.map((item, i) => ({ key: `item-${i}`, node: item })),
  ];
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {first.length > 0 && (
        <p className="text-ui text-page-muted">
          <Joined parts={first} />
        </p>
      )}
      {booking.length > 0 && (
        <p className="flex items-start gap-1.5 text-sm text-page-muted">
          <svg
            aria-hidden
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 size-4 shrink-0 text-accent"
          >
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>
            <Joined parts={booking.map((item, i) => ({ key: `booking-${i}`, node: item }))} />
          </span>
        </p>
      )}
    </div>
  );
}

function Bandeau(p: HeaderProps) {
  return (
    <header className="shrink-0">
      {/* The chip colour shows while the cover loads. */}
      <div className={`relative h-[156px] overflow-hidden @desk:h-[250px] ${p.cover ? "bg-page-chip" : "bg-accent"}`}>
        {p.cover ? (
          <CoverImage embedded={p.embedded} cover={p.cover} layout="bandeau" className="absolute inset-0 size-full" />
        ) : (
          // Without a profile photo the avatar already shows her initials: no second set on the band.
          p.pro.avatar && <Monogram name={p.pro.name} className="right-4 -bottom-[0.2em] text-[120px] @desk:right-20 @desk:text-[200px]" />
        )}
        <PhotoBar {...p} />
      </div>
      <div className={WRAP}>
        {/* Above the cover: relative, z-index 1. */}
        <div className="relative z-1 flex items-end justify-between gap-3">
          <Avatar
            name={p.pro.name}
            image={p.pro.avatar}
            className="-mt-10 size-20 border-4 border-page text-[28px] @desk:-mt-[60px] @desk:size-[120px] @desk:border-[5px] @desk:text-[42px]"
          />
          {p.contacts.length > 0 && (
            <div className="flex gap-2">
              <Contacts contacts={p.contacts} className="min-h-11 border-(length:--pp-rule) border-(--pp-rule-color) text-page-fg @desk:min-h-12 @desk:px-5" />
            </div>
          )}
        </div>
        <Name embedded={p.embedded} id={p.nameId} className="mt-2 text-[30px] leading-[1.05] text-accent title-type @desk:mt-4 @desk:text-[48px]">
          <Title pro={p.pro} />
        </Name>
        <Facts facts={p.facts} className="mt-2" />
        <Tagline text={p.pro.tagline} className="mt-1.5 text-ui text-page-muted @desk:text-lead" />
      </div>
    </header>
  );
}

/**
 * Plein: her name on the photo; the facts line right under it, on the page, where its colours keep their contrast
 * whatever the photo, and the phone header keeps its fixed 320 px. Without a cover: her accent colour and her
 * initials, no scrim; the contacts take the white pill (a 16 % tint can fail 4.5:1).
 */
function Plein(p: HeaderProps) {
  return (
    <header className="shrink-0">
      <div className={`relative h-[320px] overflow-hidden @desk:h-[400px] ${p.cover ? "bg-page-chip" : "bg-accent"}`}>
        {p.cover ? (
          <>
            <CoverImage embedded={p.embedded} cover={p.cover} layout="plein" className="absolute inset-0 size-full" />
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-[200px] bg-linear-to-b from-transparent to-photo-scrim/82 @desk:h-[240px] @desk:to-photo-scrim/80" />
          </>
        ) : (
          <Monogram name={p.pro.name} className="top-16 right-4 text-[160px] @desk:right-20 @desk:text-[260px]" />
        )}
        <PhotoBar {...p} />
        <div className="absolute inset-x-0 bottom-0">
          <div className={`${WRAP} pb-5 @desk:pb-10`}>
            <Name
              embedded={p.embedded}
              id={p.nameId}
              className={`text-[40px] leading-[0.98] title-type @desk:text-[72px] @desk:leading-[0.96] ${p.cover ? "text-on-photo" : "text-on-accent"}`}
            >
              <Title pro={p.pro} pill />
            </Name>
            <Tagline text={p.pro.tagline} className={`mt-2 text-ui @desk:text-lead ${p.cover ? "text-on-photo/90" : "text-on-accent"}`} />
            {p.contacts.length > 0 && (
              // Phones: one pill (the header is a fixed 320 px, so the page still fits one screen); desktop: all.
              <div className="mt-3 flex gap-2 @desk:mt-4">
                <Contacts contacts={p.contacts} className={`min-h-11 @desk:min-h-12 @desk:px-5 ${p.cover ? "bg-on-photo/16 text-on-photo" : "bg-surface/94 text-ink"}`} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={WRAP}>
        <Facts facts={p.facts} className="pt-3 pb-2 @desk:pt-5 @desk:pb-0" />
      </div>
    </header>
  );
}

function Encadre(p: HeaderProps) {
  // Cover first, then the gallery: up to 4 swiped on phones, the first two as a 2/3 + 1/3 strip on desktop, or the
  // mosaic there once the gallery has MOSAIC_MIN photos.
  const strip = [...(p.cover ? [p.cover] : []), ...p.photos.map((image) => ({ image, focalX: 0.5, focalY: 0.5 }))].slice(0, 4);
  const mosaic = p.photos.length >= MOSAIC_MIN;
  return (
    <header className="shrink-0">
      <LinkBar {...p} />
      <div className={WRAP}>
        {mosaic && <Mosaic cover={p.cover} photos={p.photos} label={p.labels.photos} allPhotos={p.labels.allPhotos} closeLabel={p.labels.close} />}
        <Swipe
          count={strip.length}
          label={p.labels.photos}
          className={`relative overflow-hidden rounded-[calc(var(--radius-pp-card)*7/8)] @desk:overflow-visible @desk:rounded-none ${mosaic ? "@desk:hidden" : ""}`}
          listClassName={`flex h-[190px] snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] @desk:grid @desk:h-[240px] @desk:gap-2.5 @desk:overflow-visible ${strip.length > 1 ? "@desk:grid-cols-[2fr_1fr]" : ""}`}
        >
          {strip.map((slide, i) => (
            <li
              key={slide.image.src}
              className={`relative w-full shrink-0 snap-center bg-page-chip @desk:w-auto @desk:overflow-hidden @desk:rounded-pp-card ${i >= 2 ? "@desk:hidden" : ""}`}
            >
              {i === 0 && p.cover ? (
                <CoverImage embedded={p.embedded} cover={slide} layout="encadre" className="size-full" />
              ) : (
                <img
                  src={slide.image.src}
                  srcSet={slide.image.srcSet}
                  sizes={PHOTO_SIZES.strip}
                  width={slide.image.width}
                  height={slide.image.height}
                  alt={slide.image.alt}
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                  className="size-full object-cover"
                />
              )}
            </li>
          ))}
        </Swipe>
        <div className="relative z-1 mt-3 flex items-center gap-3 @desk:mt-5 @desk:gap-4">
          <Avatar name={p.pro.name} image={p.pro.avatar} className="size-14 text-xl @desk:size-16 @desk:text-2xl" />
          <Name embedded={p.embedded} id={p.nameId} className="min-w-0 text-[28px] leading-[1.05] text-accent title-type @desk:text-[40px]">
            <Title pro={p.pro} />
          </Name>
        </div>
        <Facts facts={p.facts} className="mt-3" />
      </div>
    </header>
  );
}

function Sans(p: HeaderProps) {
  return (
    <header className="shrink-0">
      <LinkBar {...p} />
      <div className={`${WRAP} pt-1 @desk:pt-4`}>
        <Avatar name={p.pro.name} image={p.pro.avatar} className="size-[72px] text-[26px] @desk:size-24 @desk:text-[34px]" />
        <Name embedded={p.embedded} id={p.nameId} className="mt-3 text-[36px] leading-[1.02] text-accent title-type @desk:mt-4 @desk:text-[56px]">
          <Title pro={p.pro} />
        </Name>
        <Facts facts={p.facts} className="mt-2" />
        <Tagline text={p.pro.tagline} className="mt-2 text-ui text-page-muted @desk:text-lead" />
      </div>
    </header>
  );
}

/**
 * The name bar's content (phones, scrolled past the header): her avatar and name, or her logo alone (it carries her
 * name), then the header's toolbar. Same logo srcset and sizes as the header, so the browser reuses its download.
 */
export function NameBarContent({ pro, bag, labels, shareUrl }: Pick<HeaderProps, "pro" | "bag" | "labels" | "shareUrl">) {
  return (
    <>
      {pro.logo ? (
        <img
          src={pro.logo.src}
          srcSet={pro.logo.srcSet}
          sizes={LOGO_SIZES}
          width={pro.logo.width}
          height={pro.logo.height}
          alt={pro.name}
          decoding="async"
          className="mr-auto block h-7 w-auto max-w-[60%] min-w-0 object-contain object-left"
        />
      ) : (
        <>
          <Avatar name={pro.name} image={pro.avatar} className="size-7 text-[11px]" />
          <span className="min-w-0 flex-1 truncate text-lead leading-tight text-page-fg title-type">{pro.name}</span>
        </>
      )}
      <Actions layout="sans" bag={bag} labels={labels} name={pro.name} shareUrl={shareUrl} compact />
    </>
  );
}

export function ProHeader(p: HeaderProps) {
  if (p.layout === "bandeau") return <Bandeau {...p} />;
  if (p.layout === "plein") return <Plein {...p} />;
  if (p.layout === "encadre" && (p.cover || p.photos.length > 0)) return <Encadre {...p} />;
  return <Sans {...p} />;
}

/** The layout actually drawn: encadré without any photo falls back to "sans" (as resolveAppearance does). */
export function drawnLayout(layout: Layout, cover: PageCover | null, photos: number): Layout {
  return layout === "encadre" && !cover && photos === 0 ? "sans" : layout;
}
