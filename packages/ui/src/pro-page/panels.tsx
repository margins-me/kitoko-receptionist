import type { ReactNode } from "react";
import type { Layout } from "@kitoko/themes";
import { hiddenRows, PHOTO_SIZES, serviceSections, thumbColumn } from "./model";
import type { TabId } from "./model";
import { MoreRows } from "./more-rows";
import { PhotoViewer } from "./photo-viewer";
import type { PageImage, PageInfo, PageReview, PageService, ProPageLabels } from "./types";

// The tab panels. Each lists all its items, whole: the page scrolls on phones (no capped list, no "Voir tout" sheet).

// Literal classes so Tailwind sees them: a panel shows when the tabs wrapper's data-tab names it.
const SHOW: Record<TabId, string> = {
  prestations: "group-data-[tab=prestations]/tabs:flex",
  photos: "group-data-[tab=photos]/tabs:flex",
  avis: "group-data-[tab=avis]/tabs:flex",
  infos: "group-data-[tab=infos]/tabs:flex",
  boutique: "group-data-[tab=boutique]/tabs:flex",
};

export function Panel({ id, idPrefix, label, className, children }: { id: TabId; idPrefix: string; label: string; className?: string; children: ReactNode }) {
  return (
    <section
      id={`${idPrefix}-${id}`}
      role="tabpanel"
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={-1}
      className={`hidden flex-col focus-visible:-outline-offset-2 ${SHOW[id]} ${className ?? ""}`}
    >
      <h2 className="sr-only">{label}</h2>
      {children}
    </section>
  );
}

function Chevron({ className }: { className: string }) {
  return (
    <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/**
 * The service's photo, square at the start of the row: 48 px fits the row's two lines, so rows keep one height. In a
 * list where another row has a photo, a row without one keeps the same empty space (no box, no letter), so the
 * names stay in line.
 */
function ServiceThumb({ service }: { service: PageService }) {
  const box = "size-12 shrink-0 @desk:size-14";
  if (!service.image) return <span aria-hidden className={box} />;
  return (
    <img
      src={service.image.src}
      srcSet={service.image.srcSet}
      width={56}
      height={56}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${box} rounded-[min(12px,var(--radius-pp-photo))] bg-page-chip object-cover`}
    />
  );
}

/**
 * Name, then the duration (and on desktop the description) as secondary text; the price on the right in tabular
 * figures, so prices line up down the list.
 */
function ServiceRow({ service, thumbs }: { service: PageService; thumbs: boolean }) {
  const content = (
    <>
      {thumbs && <ServiceThumb service={service} />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className="text-lead leading-snug font-semibold">{service.name}</strong>
        {(service.duration || service.description) && (
          <span className="text-sm text-page-muted @desk:line-clamp-1">
            {service.duration}
            {service.description && (
              <span className="hidden @desk:inline">
                {service.duration && " · "}
                {service.description}
              </span>
            )}
          </span>
        )}
      </span>
      {service.price && <span className="shrink-0 text-right text-ui font-semibold whitespace-nowrap tabular-nums">{service.price}</span>}
      <Chevron className="-ml-1 size-5 shrink-0 text-page-muted @desk:hidden" />
    </>
  );
  // Hairline row or card, per style; data-style can number it ("01") with the services counter.
  const row =
    "flex min-h-11 items-center justify-between gap-3 rounded-(--pp-row-radius) border-(length:--pp-row-border) border-(--pp-rule-color) bg-(--pp-row-bg) px-(--pp-row-pad) py-3 text-page-fg no-underline [counter-increment:pp-service] before:min-w-7 before:shrink-0 before:text-page-muted before:title-type before:content-[counter(pp-service,decimal-leading-zero)] before:[display:var(--pp-row-number)]";
  return service.href ? (
    <a data-booking href={service.href} className={row}>
      {content}
    </a>
  ) : (
    <div className={row}>{content}</div>
  );
}

/**
 * The services, by category when she has several (a heading each; the app sets `group` only then). A long category
 * shows its first rows and a button for the rest. Each list decides its photo column on its own.
 */
export function ServicesList({ services, note, labels, idPrefix }: { services: PageService[]; note?: string | null; labels: ProPageLabels; idPrefix: string }) {
  if (services.length === 0) return <p className="py-3 text-ui text-page-muted">{labels.servicesEmpty}</p>;
  // Numbered styles count from 01 in each list.
  const list = "flex flex-col gap-(--pp-row-gap) [counter-reset:pp-service]";
  return (
    <div className="flex flex-col">
      {serviceSections(services).map((section, s) => {
        const thumbs = thumbColumn(section.services);
        const { moreServices, fewerServices } = labels;
        const hidden = moreServices && fewerServices ? hiddenRows(section.services.length, Boolean(section.title)) : 0;
        const shown = section.services.length - hidden;
        const rows = section.services.map((service, i) => (
          <li key={service.id} className={i >= shown ? "hidden group-data-open/rows:block" : undefined}>
            <ServiceRow service={service} thumbs={thumbs} />
          </li>
        ));
        return (
          <div key={`${s}-${section.title ?? ""}`} className="flex flex-col pt-7 first:pt-0 @desk:pt-9">
            {section.title && <h3 className="pb-2 text-lead leading-snug font-semibold text-page-fg">{section.title}</h3>}
            {hidden > 0 && moreServices && fewerServices ? (
              <MoreRows id={`${idPrefix}-services-${s}`} more={moreServices.replace("#", String(hidden))} fewer={fewerServices} className={list}>
                {rows}
              </MoreRows>
            ) : (
              <ul className={list}>{rows}</ul>
            )}
          </div>
        );
      })}
      {note && <p className="pt-3 text-sm text-page-muted">{note}</p>}
    </div>
  );
}

export function PhotoGrid({ photos, layout, labels }: { photos: PageImage[]; layout: Layout; labels: ProPageLabels }) {
  return (
    <PhotoViewer photos={photos} closeLabel={labels.close}>
      <ul
        className={`grid grid-cols-2 gap-2 pt-2 @desk:auto-rows-[260px] @desk:grid-cols-4 @desk:gap-2.5 ${layout === "encadre" ? "auto-rows-[128px]" : "auto-rows-[150px]"}`}
      >
        {photos.map((photo, i) => (
          <li key={photo.src} className="overflow-hidden rounded-pp-photo bg-page-chip @desk:rounded-pp-photo-desk">
            <button type="button" data-photo={i} className="block size-full cursor-zoom-in">
              <img
                src={photo.src}
                srcSet={photo.srcSet}
                sizes={PHOTO_SIZES.grid}
                width={photo.width}
                height={photo.height}
                alt={photo.alt}
                loading="lazy"
                decoding="async"
                className="size-full object-cover"
              />
            </button>
          </li>
        ))}
      </ul>
    </PhotoViewer>
  );
}

function Stars({ rating, label }: { rating: number; label: string }) {
  return (
    <span role="img" aria-label={label} className="flex gap-0.5 text-page-fg">
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} aria-hidden width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" fill={i <= Math.round(rating) ? "currentColor" : "none"}>
          <path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />
        </svg>
      ))}
    </span>
  );
}

export function Reviews({ reviews }: { reviews: { average: string; summary: string; items: PageReview[] } }) {
  return (
    <>
      <p className="flex items-baseline gap-2 pt-2">
        {/* Title font on the rating number only. */}
        <strong className="text-[36px] leading-none text-accent title-type @desk:text-[48px]">{reviews.average}</strong>
        <span className="text-ui text-page-muted">{reviews.summary}</span>
      </p>
      <ul className="mt-2 flex flex-col @desk:mt-4 @desk:grid @desk:grid-cols-2 @desk:gap-4">
        {reviews.items.map((r) => (
          <li
            key={r.id}
            className="flex flex-col gap-1 border-b-(length:--pp-rule) border-(--pp-rule-color) py-3 @desk:rounded-[calc(var(--radius-pp-card)*3/4)] @desk:border-(length:--pp-rule) @desk:p-5"
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">{r.author}</span>
              <time dateTime={r.dateTime} className="text-sm text-page-muted">
                {r.when}
              </time>
              <Stars rating={r.rating} label={r.ratingLabel} />
            </p>
            {r.body && <p className="text-ui whitespace-pre-line">{r.body}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

export function Infos({ infos }: { infos: PageInfo[] }) {
  return (
    <dl className="flex flex-col @desk:grid @desk:grid-cols-2 @desk:gap-x-10">
      {infos.map((row) => (
        <div key={row.id} className="flex flex-col gap-0.5 border-b-(length:--pp-rule) border-(--pp-rule-color) py-3">
          <dt className="text-ui font-semibold">{row.label}</dt>
          <dd className="text-sm text-page-muted">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
