"use client";

import { useEffect, useEffectEvent, useRef } from "react";

/**
 * history.state key of a sheet entry: tokens of the open sheets at and below that entry, outermost first.
 * Next's App Router patches pushState and copies its own __NA / tree keys; we spread the current state so
 * those (and any app keys) ride along, and push no URL so the router sees no navigation.
 */
const KEY = "__kitokoSheets";
/** Next's App Router marks its history entries with this key; entries without it make its popstate reload. */
const NEXT_KEY = "__NA";
/** Give up waiting for the popstate of our own history.go() after this long (a navigation can cancel it). */
const LAND_TIMEOUT_MS = 1000;

export type BackToCloseWindow = {
  readonly history: {
    readonly state: unknown;
    pushState(data: unknown, unused: string): void;
    go(delta: number): void;
  };
  readonly location: { readonly href: string };
  addEventListener(type: "popstate", listener: () => void): void;
};

type Entry = {
  close: () => void;
  /** Set once its history entry is pushed. */
  token?: string;
  /** location.href when pushed. */
  href?: string;
  /** Closed by the UI; its history entry still has to be popped. */
  closing: boolean;
  /** A traversal we could not place happened since the push; only read when our state was wiped. */
  lost: boolean;
};

/**
 * One history entry per open sheet, shared by every sheet on the page so nested sheets stack. Pushes and
 * pops are batched in a microtask: a sheet that closes as another opens pops first, then pushes, and a
 * StrictMode unmount/remount pushes once. `open()` returns the release to call when the sheet closes.
 */
export function createBackStack(win: BackToCloseWindow) {
  const prefix = Math.random().toString(36).slice(2, 10);
  let count = 0;
  /** Open sheets, outermost first. */
  const entries: Entry[] = [];
  let queued = false;
  let listening = false;
  /** Timer of our own history.go() while its popstate has not arrived. */
  let landing: ReturnType<typeof setTimeout> | null = null;

  const chain = (): string[] | null => {
    const state: unknown = win.history.state;
    const value = state && typeof state === "object" ? (state as Record<string, unknown>)[KEY] : undefined;
    return Array.isArray(value) ? (value as string[]) : null;
  };

  const remove = (gone: Entry[]) => {
    for (const entry of gone) entries.splice(entries.indexOf(entry), 1);
  };

  const request = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  };

  /** How many entries to go back to drop the closing sheets' entries that are on top of history. */
  function stepsBack(closing: Entry[]): number {
    const isClosing = (token: string | undefined) => closing.some((entry) => entry.token === token);
    const tokens = chain();
    if (tokens) {
      let steps = 0;
      while (steps < tokens.length && isClosing(tokens[tokens.length - 1 - steps])) steps++;
      return steps;
    }
    // No state: a link navigated away (new URL), or Next rewrote the current entry on router.refresh() or a
    // server action. In the latter case the top sheet's entry is still current: same URL, no traversal since.
    const pushed = entries.filter((entry) => entry.token);
    const top = pushed.at(-1);
    if (!top || top.lost || top.href !== win.location.href) return 0;
    let steps = 0;
    while (steps < pushed.length && pushed[pushed.length - 1 - steps]?.closing) steps++;
    return steps;
  }

  function push(entry: Entry) {
    const below = entries.slice(0, entries.indexOf(entry)).map((e) => e.token);
    const token = `${prefix}-${++count}`;
    const state: unknown = win.history.state;
    const base = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
    // A plain #hash link leaves an entry with no state. Next's popstate reloads the page on a state without
    // __NA, so forward onto our entry would reload; with __NA and no tree, Next restores its current tree.
    win.history.pushState({ ...base, ...(base[NEXT_KEY] ? {} : { [NEXT_KEY]: true }), [KEY]: [...below, token] }, "");
    entry.token = token;
    entry.href = win.location.href;
  }

  function sync() {
    queued = false;
    if (landing !== null) return; // resumes once our traversal lands
    const closing = entries.filter((entry) => entry.closing);
    if (closing.length) {
      const steps = stepsBack(closing);
      remove(closing);
      if (steps > 0) {
        landing = setTimeout(landed, LAND_TIMEOUT_MS);
        win.history.go(-steps);
        return; // push newly opened sheets after landing, so they sit where the closed ones were
      }
    }
    for (const entry of entries) if (!entry.token) push(entry);
  }

  function landed() {
    if (landing === null) return;
    clearTimeout(landing);
    landing = null;
    sync();
  }

  function onPopState() {
    if (landing !== null) return landed();
    const pushed = entries.filter((entry) => entry.token);
    if (!pushed.length) return;
    const tokens = chain();
    let popped: Entry[];
    if (tokens) {
      popped = pushed.filter((entry) => !tokens.includes(entry.token!));
      for (const entry of pushed) if (entry.token === tokens.at(-1)) entry.lost = false;
    } else {
      // The page below the sheets, or a sheet entry Next rewrote: read it as one step back off the top sheet.
      const top = pushed[pushed.length - 1]!;
      popped = top.href === win.location.href ? [top] : [];
      for (const entry of pushed) entry.lost = true;
    }
    remove(popped);
    for (const entry of popped.reverse()) if (!entry.closing) entry.close();
    request();
  }

  function open(close: () => void): () => boolean {
    if (!listening) {
      win.addEventListener("popstate", onPopState);
      listening = true;
    }
    const entry: Entry = { close, closing: false, lost: false };
    entries.push(entry);
    request();
    /** Returns true when a navigation had left the sheet's entry (another URL is current). */
    return () => {
      const left = entry.href !== undefined && entry.href !== win.location.href;
      if (!entries.includes(entry)) return left; // already popped by back
      if (entry.token) {
        entry.closing = true;
        request();
      } else {
        remove([entry]); // closed before it was pushed (StrictMode remount, or opened and closed at once)
      }
      return left;
    };
  }

  return { open };
}

let shared: ReturnType<typeof createBackStack> | undefined;

/**
 * Browser/OS back closes the sheet instead of leaving the page (or the installed PWA). While `open`, keeps one
 * same-URL history entry: back pops it and calls `onOpenChange(false)`; closing any other way pops it with
 * history.back(), unless a navigation already left it. Each nested sheet owns its own entry. Pass
 * `enabled = false` when the caller already keeps the open state in history.
 *
 * A sheet still open when a link took the page away (its page kept in the router's back/forward cache) closes
 * when back shows the page again, instead of reopening on a new entry that would drop the forward history.
 */
export function useBackToClose(open: boolean, onOpenChange: (open: boolean) => void, enabled = true) {
  const close = useEffectEvent(() => onOpenChange(false));
  const active = open && enabled;
  const left = useRef(false);
  useEffect(() => {
    if (!active) {
      left.current = false;
      return;
    }
    if (left.current) {
      left.current = false;
      close();
      return;
    }
    shared ??= createBackStack(window);
    const release = shared.open(() => close());
    return () => {
      left.current = release();
    };
  }, [active]);
}
