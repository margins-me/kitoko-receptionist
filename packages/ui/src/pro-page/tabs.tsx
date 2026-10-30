"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { tabFromUrl, urlWithTab } from "./model";
import type { TabId } from "./model";

/**
 * Writes the tab into the address bar without a history entry. Next's own keys are left out of the state so its
 * router hears of the new URL (and keeps useSearchParams in step); the page's own keys (booking depth, open sheets)
 * ride along.
 */
function keepInUrl(id: TabId, tabs: readonly TabId[]) {
  const url = urlWithTab(window.location, id, tabs);
  if (url === window.location.pathname + window.location.search + window.location.hash) return;
  const own: Record<string, unknown> = { ...(window.history.state ?? {}) };
  delete own.__NA;
  delete own.__PRIVATE_NEXTJS_INTERNALS_TREE;
  window.history.replaceState(own, "", url);
}

/** The nearest ancestor that scrolls (a preview's frame), else null for the document. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p;
  return null;
}

export type ProTabsProps = {
  tabs: { id: TabId; label: string }[];
  /** Accessible name of the tab list, e.g. "Sections de la page". */
  label: string;
  /** Prefix of the tab and panel ids, unique per page (several previews can share a document). */
  idPrefix: string;
  /** Read ?onglet= (or an old #hash) on mount and write it back on change. Off in previews. */
  syncUrl: boolean;
  /** The tab shown first; default the first one. */
  initialTab?: TabId;
  className: string;
  tablistClassName: string;
  tabClassName: string;
  /** Everything under the tab list: the panels (server-rendered, shown by CSS from data-tab) and the footer. */
  children: ReactNode;
};

/**
 * The page's tabs (C01/D01): real role="tab" buttons over server-rendered panels. Panels all stay in the markup;
 * CSS shows the one the wrapper's data-tab names. Kept tiny on purpose: it ships before any interaction.
 */
export function ProTabs({ tabs, label, idPrefix, syncUrl, initialTab, className, tablistClassName, tabClassName, children }: ProTabsProps) {
  const ids = tabs.map((t) => t.id);
  const [chosen, setActive] = useState<TabId>(initialTab ?? ids[0] ?? "prestations");
  // A tab can disappear (a preview losing its photos or reviews): fall back to the first one.
  const active = ids.includes(chosen) ? chosen : (ids[0] ?? "prestations");
  const key = ids.join(",");
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Set when a tab is picked while the list is stuck (phones, scrolled into the panel).
  const realign = useRef(false);

  // Picked while stuck: bring the new panel's start up under the tabs, rather than leaving her mid-panel (or, on a
  // shorter panel, wherever the browser clamps). After the commit, so it measures the panel now shown.
  useEffect(() => {
    if (!realign.current) return;
    realign.current = false;
    const root = rootRef.current;
    const list = listRef.current;
    if (!root || !list) return;
    // The list sits at the top of its wrapper unless sticky moved it down: the gap is how far to scroll back.
    const by = root.getBoundingClientRect().top - list.getBoundingClientRect().top;
    if (by >= -1) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    (scrollerOf(root) ?? window).scrollBy({ top: by, behavior });
  }, [active]);

  // A shared link such as kitoko.page/nala?onglet=avis opens that tab (the cached page renders the first one).
  useEffect(() => {
    if (!syncUrl) return;
    const list = key.split(",") as TabId[];
    const wanted = tabFromUrl(window.location.search, window.location.hash, list);
    if (wanted) setActive(wanted);
  }, [key, syncUrl]);

  const select = (id: TabId, focus = false) => {
    const root = rootRef.current;
    const list = listRef.current;
    if (id !== active && root && list) realign.current = list.getBoundingClientRect().top - root.getBoundingClientRect().top > 1;
    setActive(id);
    if (syncUrl) keepInUrl(id, ids);
    if (focus) document.getElementById(`${idPrefix}-tab-${id}`)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const i = ids.indexOf(active);
    const to =
      e.key === "ArrowRight" ? (i + 1) % ids.length
      : e.key === "ArrowLeft" ? (i - 1 + ids.length) % ids.length
      : e.key === "Home" ? 0
      : e.key === "End" ? ids.length - 1
      : -1;
    const id = ids[to];
    if (!id) return;
    e.preventDefault();
    select(id, true);
  };

  return (
    <div ref={rootRef} data-tab={active} className={`group/tabs ${className}`}>
      <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={tablistClassName}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${idPrefix}-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.id)}
              className={tabClassName}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
