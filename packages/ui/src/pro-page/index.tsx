import type { CSSProperties } from "react";
import type { Layout } from "@kitoko/themes";
import { drawnLayout, NameBarContent, ProHeader } from "./header";
import { factsLine, pageTabs } from "./model";
import { NameBar } from "./name-bar";
import { Infos, Panel, PhotoGrid, Reviews, ServicesList } from "./panels";
import { accentButton, barLabel, barValue, slotChip } from "./styles";
import { ProTabs } from "./tabs";
import type { ProPageProps } from "./types";

export * from "./model";
export type * from "./types";

// <ProPage>: the pro's public page, also rendered by the dashboard preview and the landing configurator (handover §5).
// Server-renderable and framework-free: props are display-ready, the app's client islands come in as `slots`.
// No tailwind-merge and no kit barrel here: this is the public page's first load.

// Tab bar top margin (phones) and body top margin (desktop) per layout.
const TABS_TOP: Record<Layout, string> = {
  bandeau: "mt-3 @desk:mt-[22px]",
  plein: "@desk:mt-6",
  encadre: "mt-2 @desk:mt-4",
  sans: "mt-3 @desk:mt-6",
};

// Desktop panel minimum height per layout, so a short tab does not pull the footer up; longer ones grow the page.
const PANEL_HEIGHT: Record<Layout, string> = {
  bandeau: "@desk:min-h-[360px]",
  plein: "@desk:min-h-[390px]",
  encadre: "@desk:min-h-[340px]",
  sans: "@desk:min-h-[450px]",
};

/** CSS declarations (custom properties, `color-scheme`) as a React style: custom properties go as given. */
function inlineVars(vars: Record<string, string>): CSSProperties {
  const { "color-scheme": colorScheme, ...rest } = vars;
  return { ...rest, ...(colorScheme ? { colorScheme } : {}) } as CSSProperties;
}

function BookLink({ book, className }: { book: NonNullable<ProPageProps["book"]>; className: string }) {
  return book.href ? (
    <a data-booking href={book.href} className={className}>
      {book.label}
    </a>
  ) : (
    <span className={className}>{book.label}</span>
  );
}

export function ProPage(props: ProPageProps) {
  const { appearance, cover, photos, labels, book, slots = {} } = props;
  const idPrefix = props.idPrefix ?? "pro";
  const layout = drawnLayout(appearance.layout, cover, photos.length);
  const screen = (props.height ?? "screen") === "screen";
  // A preview sits inside another page: no second <main> landmark or <h1>, no eager cover.
  const Root = screen ? "main" : "div";
  const rootId = `${idPrefix}-page`;

  const tabs = pageTabs({ photos: photos.length, reviews: props.reviews !== null, shop: slots.shop != null }).map((id) => ({
    id,
    label: labels.tabs[id],
  }));
  const panel = (id: (typeof tabs)[number]["id"]) => ({ id, idPrefix, label: labels.tabs[id] });

  return (
    <Root
      id={rootId}
      data-style={appearance.style}
      data-theme={appearance.theme}
      data-font={appearance.titleFont}
      // A preview's frame scrolls as the document would on a phone (sticky tabs and name bar included); its desktop
      // frame shows the top of the page, unscrolled, as before.
      className={`@container bg-page text-page-fg ${screen ? "min-h-dvh" : "h-full overflow-y-auto overscroll-contain @desk:overflow-visible"} ${props.fontClassName ?? ""}`}
      // Runtime values: her own colours.
      style={props.customVars ? inlineVars(props.customVars) : undefined}
    >
      {/* Phones: the page scrolls, the tabs and the name bar stick at the top, the booking bar at the bottom. No
          overflow clipping here: it would stop the sticky parts. Desktop: the page flows. */}
      <div className={`flex flex-col ${screen ? "min-h-dvh" : "min-h-full"} @desk:block @desk:min-h-0 @desk:pb-16`}>
        {/* Sticky but no height, so the header lays out as before; the bar hangs from it over the page. */}
        <div className="sticky top-0 z-20 h-0 @desk:hidden">
          <NameBar
            target={`${idPrefix}-name`}
            scroller={screen ? undefined : rootId}
            // Transform and opacity only (compositor), the emphasized ease of the kit's entrances; reduced motion:
            // plain show and hide, no slide.
            className="absolute inset-x-0 top-0 flex h-11 items-center gap-2.5 bg-page px-4 opacity-0 motion-safe:-translate-y-2 motion-safe:transition-[opacity,translate] motion-safe:duration-220 motion-safe:ease-emphasized data-shown:translate-y-0 data-shown:opacity-100"
          >
            <NameBarContent pro={props.pro} bag={slots.bag} labels={labels} shareUrl={props.shareUrl} />
          </NameBar>
        </div>
        <ProHeader
          layout={layout}
          host={props.host}
          domain={props.domain}
          shareUrl={props.shareUrl}
          pro={props.pro}
          cover={cover}
          photos={photos}
          contacts={props.contacts}
          facts={factsLine(props.facts, props.chips)}
          labels={labels}
          bag={slots.bag}
          badge={slots.badge}
          embedded={!screen}
          nameId={`${idPrefix}-name`}
        />
        {/* The style's band (Héritage motif, Éditorial double rule) in the accent; no height for the others. */}
        <div aria-hidden className="mt-(--pp-decor-h) h-(--pp-decor-h) shrink-0 bg-accent mask-(--pp-decor) mask-repeat-x" />

        <div className={`flex min-h-0 flex-1 flex-col ${TABS_TOP[layout]} @desk:mx-auto @desk:w-full @desk:max-w-[1168px] @desk:flex-row @desk:px-6 @desk:items-start @desk:gap-16`}>
          <ProTabs
            tabs={tabs}
            label={labels.tabList}
            idPrefix={idPrefix}
            syncUrl={props.syncUrl ?? true}
            initialTab={props.initialTab}
            className="flex min-w-0 flex-1 flex-col"
            // Phones: stuck under the name bar's 44 px from the start, so nothing moves when the bar fades in (it
            // shows once her name, above the tabs, has gone under that line). Opaque, so the panel slides under it.
            tablistClassName="sticky top-11 z-10 flex min-h-12 shrink-0 gap-4 overflow-x-auto border-b-(length:--pp-rule) border-(--pp-rule-color) bg-page px-4 [scrollbar-width:none] @desk:static @desk:min-h-[52px] @desk:gap-7 @desk:px-0"
            tabClassName="my-(--pp-tab-inset) min-w-11 shrink-0 rounded-(--pp-tab-radius) px-(--pp-tab-pad) text-ui font-semibold tracking-(--pp-tab-tracking) whitespace-nowrap text-page-muted [text-transform:var(--pp-tab-case)] focus-visible:-outline-offset-2 aria-selected:bg-(--pp-tab-active-bg) aria-selected:text-(--pp-tab-active-fg) aria-selected:shadow-[inset_0_calc(var(--pp-tab-indicator)*-1)_0_var(--color-accent)] @desk:text-lead"
          >
            {/* Phones: tall enough to fill the screen between the stuck bars (44 + 48 px and a hairline) and the booking
                bar (95 px or more), so switching to a short tab can keep the tabs at the top. */}
            <div
              className={`flex flex-1 flex-col px-4 pt-1 ${screen ? "min-h-[calc(100dvh-184px)]" : ""} @desk:block @desk:min-h-0 @desk:px-0 @desk:pt-5`}
            >
              <div className={`flex flex-col ${PANEL_HEIGHT[layout]}`}>
                <Panel {...panel("prestations")}>
                  <ServicesList services={props.services} note={props.servicesNote} labels={labels} idPrefix={idPrefix} />
                </Panel>
                {photos.length > 0 && (
                  <Panel {...panel("photos")}>
                    <PhotoGrid photos={photos} layout={layout} labels={labels} />
                  </Panel>
                )}
                {props.reviews && (
                  <Panel {...panel("avis")}>
                    <Reviews reviews={props.reviews} />
                  </Panel>
                )}
                <Panel {...panel("infos")}>
                  <Infos infos={props.infos} />
                </Panel>
                {slots.shop != null && (
                  <Panel {...panel("boutique")} className="pt-2">
                    {slots.shop}
                  </Panel>
                )}
              </div>
              {slots.footer && <div className="mt-auto pt-6 pb-2 @desk:hidden">{slots.footer}</div>}
            </div>
          </ProTabs>

          {book && (
            <aside
              aria-labelledby={`${idPrefix}-next-title`}
              className="hidden w-[360px] shrink-0 flex-col gap-4 rounded-pp-card border-(length:--pp-rule) border-(--pp-rule-color) p-6 @desk:sticky @desk:top-6 @desk:flex"
            >
              <h2 id={`${idPrefix}-next-title`} className="text-[20px] leading-tight font-semibold">
                {labels.nextSlots}
              </h2>
              {slots.nextSlots ?? (
                <ul className="grid grid-cols-2 gap-2">
                  {(props.card.placeholderSlots ?? []).map((slot) => (
                    <li key={slot} className={slotChip}>
                      {slot}
                    </li>
                  ))}
                </ul>
              )}
              {props.card.deposit && <p className="text-ui text-page-muted">{props.card.deposit}</p>}
              <BookLink book={book} className={`${accentButton} w-full`} />
            </aside>
          )}
        </div>

        {/* Desktop: the footer spans both columns, under the booking card too. Phones keep it at the end of the panel. */}
        {slots.footer && <div className="hidden @desk:mx-auto @desk:mt-12 @desk:block @desk:max-w-[1168px] @desk:px-6">{slots.footer}</div>}

        {book && (
          // Sticky, not fixed: it stays in the flow, so the last item ends above it, and stays inside a preview's frame.
          <div className="sticky bottom-0 z-10 flex shrink-0 items-center gap-3 border-t-(length:--pp-rule) border-(--pp-rule-color) bg-page px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))] @desk:hidden">
            {slots.bar ?? (
              <>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className={barLabel}>{labels.nextSlot}</span>
                  <strong className={barValue}>{props.placeholderNextSlot}</strong>
                </div>
                <BookLink book={book} className={accentButton} />
              </>
            )}
          </div>
        )}
      </div>
    </Root>
  );
}
