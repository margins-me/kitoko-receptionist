import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackStack } from "../src/use-back-to-close";

type HistoryEntry = { state: unknown; href: string };

/** A browser session history: pushState is synchronous, history.go() lands later and fires popstate. */
function fakeWindow(start = "https://kitoko.test/nala") {
  const entries: HistoryEntry[] = [{ state: { __NA: true }, href: start }];
  let index = 0;
  const listeners = new Set<() => void>();
  const queued: number[] = [];
  const current = () => entries[index]!;

  const traverse = (delta: number) => {
    const target = Math.max(0, Math.min(entries.length - 1, index + delta));
    if (target === index) return;
    index = target;
    for (const listener of listeners) listener();
  };

  const win = {
    history: {
      get state() {
        return current().state;
      },
      pushState(state: unknown, _unused: string, url?: string) {
        const href = url ? new URL(url, current().href).href : current().href;
        entries.splice(index + 1, entries.length, { state: structuredClone(state), href });
        index++;
      },
      go(delta: number) {
        queued.push(delta);
      },
    },
    location: {
      get href() {
        return current().href;
      },
    },
    addEventListener(_type: "popstate", listener: () => void) {
      listeners.add(listener);
    },
  };

  return {
    win,
    get index() {
      return index;
    },
    get length() {
      return entries.length;
    },
    get queued() {
      return [...queued];
    },
    chain: () => (current().state as { __kitokoSheets?: string[] } | null)?.__kitokoSheets,
    /** Lands the history.go() calls the code made, like the browser does a task later. */
    settle() {
      while (queued.length) traverse(queued.shift()!);
    },
    /** The browser / OS back button. */
    back: () => traverse(-1),
    forward: () => traverse(1),
    /** A Next <Link>: the router pushes its own state with the new URL. */
    navigate: (url: string) => win.history.pushState({ __NA: true }, "", url),
    /** router.refresh() or a server action: Next rewrites the current entry's state, dropping custom keys. */
    refresh: () => {
      current().state = { __NA: true };
    },
  };
}

/** Lets the stack's batched microtask run. */
const tick = () => Promise.resolve();

/** A sheet whose parent mirrors onOpenChange(false) into its own state, as a controlled sheet does. */
function sheet(stack: ReturnType<typeof createBackStack>) {
  let release: (() => void) | null = null;
  const s = {
    open: true,
    closedByBack: 0,
    show() {
      s.open = true;
      release = stack.open(() => {
        s.closedByBack++;
        s.hide(); // the parent sets open=false; the effect cleanup releases
      });
    },
    hide() {
      s.open = false;
      release?.();
      release = null;
    },
  };
  s.show();
  return s;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useBackToClose history logic", () => {
  it("pushes one same-URL entry on open, keeping the router's state", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    sheet(stack);
    await tick();
    expect(h.length).toBe(2);
    expect(h.index).toBe(1);
    expect(h.win.location.href).toBe("https://kitoko.test/nala");
    expect(h.win.history.state).toMatchObject({ __NA: true });
    expect(h.chain()).toHaveLength(1);
  });

  it("goes back once when closed from the UI", async () => {
    const h = fakeWindow();
    const s = sheet(createBackStack(h.win));
    await tick();
    s.hide();
    await tick();
    expect(h.queued).toEqual([-1]);
    h.settle();
    expect(h.index).toBe(0);
    expect(s.closedByBack).toBe(0);
  });

  it("closes on back, and does not go back again", async () => {
    const h = fakeWindow();
    const s = sheet(createBackStack(h.win));
    await tick();
    h.back();
    expect(s.closedByBack).toBe(1);
    expect(s.open).toBe(false);
    await tick();
    expect(h.queued).toEqual([]);
    expect(h.index).toBe(0);
  });

  it("does not go back after a navigation left the entry", async () => {
    const h = fakeWindow();
    const s = sheet(createBackStack(h.win));
    await tick();
    h.navigate("/nala/prestations");
    s.hide(); // the sheet unmounts with the page, or the layout closes it
    await tick();
    expect(h.queued).toEqual([]);
    expect(h.index).toBe(2);
    expect(h.win.location.href).toBe("https://kitoko.test/nala/prestations");
  });

  it("tells the caller a navigation left the sheet, so a cached page shown again closes it", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const release = stack.open(() => {});
    await tick();
    h.win.history.pushState({ __NA: true }, "", "/nala/r/abc"); // router.replace() lands the same way here
    expect(release()).toBe(true);
    await tick();
    expect(h.queued).toEqual([]);

    const stay = stack.open(() => {});
    await tick();
    expect(stay()).toBe(false);
    const early = stack.open(() => {});
    expect(early()).toBe(false); // never pushed
  });

  it("still goes back when Next rewrote the entry's state (refresh, server action)", async () => {
    const h = fakeWindow();
    const s = sheet(createBackStack(h.win));
    await tick();
    h.refresh();
    s.hide();
    await tick();
    expect(h.queued).toEqual([-1]);
    h.settle();
    expect(h.index).toBe(0);
  });

  it("gives nested sheets one entry each", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const outer = sheet(stack);
    await tick();
    const inner = sheet(stack);
    await tick();
    expect(h.length).toBe(3);
    expect(h.chain()).toHaveLength(2);

    h.back();
    expect(inner.closedByBack).toBe(1);
    expect(outer.open).toBe(true);

    h.back();
    expect(outer.closedByBack).toBe(1);
    await tick();
    expect(h.queued).toEqual([]);
    expect(h.index).toBe(0);
  });

  it("closing the inner sheet from the UI keeps the outer one open", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const outer = sheet(stack);
    await tick();
    const inner = sheet(stack);
    await tick();

    inner.hide();
    await tick();
    h.settle();
    expect(h.index).toBe(1);
    expect(outer.open).toBe(true);
    expect(outer.closedByBack).toBe(0);

    outer.hide();
    await tick();
    h.settle();
    expect(h.index).toBe(0);
  });

  it("closing the inner sheet still works after Next rewrote the outer entry", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const outer = sheet(stack);
    await tick();
    h.refresh();
    const inner = sheet(stack);
    await tick();

    inner.hide();
    await tick();
    h.settle();
    expect(outer.open).toBe(true);

    outer.hide();
    await tick();
    expect(h.queued).toEqual([-1]);
    h.settle();
    expect(h.index).toBe(0);
  });

  it("pops both entries at once when both sheets close together", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const outer = sheet(stack);
    await tick();
    const inner = sheet(stack);
    await tick();
    inner.hide();
    outer.hide();
    await tick();
    expect(h.queued).toEqual([-2]);
    h.settle();
    expect(h.index).toBe(0);
  });

  it("swapping one sheet for another pops before pushing", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const menu = sheet(stack);
    await tick();
    const first = h.chain()![0];
    menu.hide();
    const next = sheet(stack);
    await tick();
    expect(h.length).toBe(2); // the push waits for the back to land
    h.settle();
    expect(h.length).toBe(2);
    expect(h.index).toBe(1);
    expect(h.chain()).toHaveLength(1);
    expect(h.chain()![0]).not.toBe(first);

    h.back();
    expect(next.closedByBack).toBe(1);
    expect(h.index).toBe(0);
  });

  it("pushes once across a StrictMode unmount and remount", async () => {
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const release = stack.open(() => {});
    release();
    stack.open(() => {});
    await tick();
    expect(h.length).toBe(2);
    expect(h.queued).toEqual([]);
  });

  it("marks its entry for Next after a plain #hash link left a state-less entry", async () => {
    const h = fakeWindow();
    h.win.history.pushState(null, "", "#avis"); // the browser's own entry for an <a href="#avis">
    const s = sheet(createBackStack(h.win));
    await tick();
    expect(h.win.history.state).toMatchObject({ __NA: true });
    expect(h.win.location.href).toBe("https://kitoko.test/nala#avis");

    h.back();
    expect(s.closedByBack).toBe(1);
    expect(h.win.history.state).toBeNull();
    h.forward(); // Next restores its current tree on an __NA entry instead of reloading
    expect(h.win.history.state).toMatchObject({ __NA: true });
    await tick();
    expect(h.queued).toEqual([]);
  });

  it("ignores forward onto a stale sheet entry", async () => {
    const h = fakeWindow();
    const s = sheet(createBackStack(h.win));
    await tick();
    h.back();
    h.forward();
    expect(s.closedByBack).toBe(1);
    await tick();
    expect(h.queued).toEqual([]);
  });

  it("recovers if its own back never lands", async () => {
    vi.useFakeTimers();
    const h = fakeWindow();
    const stack = createBackStack(h.win);
    const s = sheet(stack);
    await tick();
    s.hide();
    await tick();
    expect(h.queued).toEqual([-1]); // never settled, e.g. cancelled by a navigation
    sheet(stack);
    await tick();
    expect(h.length).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(h.length).toBe(3);
  });
});
