import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SheetPicture } from "../src/sheet";
import {
  AgendaWeekView,
  BlockRow,
  BookingRow,
  CancellationCard,
  CollectFields,
  DayList,
  GapRow,
  OfferLine,
  ProTabBar,
  TodayHeader,
} from "../src/pro-app";
import type { AgendaWeekViewProps, TimelineEntry } from "../src/pro-app";

// The landing renders these as server components, with sample words and no callbacks: they must render to a string.

describe("Aujourd'hui", () => {
  it("renders the header, a cancellation card and a day's rows", () => {
    const html = renderToString(
      h(
        "div",
        null,
        h(TodayHeader, { date: "Mardi 20 octobre", title: "Bonjour Nala", as: "p" }),
        h(
          CancellationCard,
          { title: "Awa a annulé jeudi 22 à 14 h", body: "Tu gardes l’acompte de 30 €." },
          h(OfferLine, { kind: "cta", text: "Proposer aux 3 personnes en attente" }),
        ),
        h(
          DayList,
          { id: "demo-today", title: "Aujourd'hui" },
          h(BookingRow, { time: "9 h – 13 h", name: "Fatou", service: "Knotless", tags: ["Reste 115 €"] }),
          h(GapRow, { title: "Libre de 14 h à 16 h", fits: "Nattes collées", action: "Ajouter un rendez-vous" }),
          h(BlockRow, { time: "16 h – 17 h", title: "Pause" }),
        ),
      ),
    );
    expect(html).toContain('<p class="text-title leading-[1.1] font-medium tracking-display">Bonjour Nala</p>');
    expect(html).toMatch(/<div role="status" class="[^"]*bg-warning/);
    expect(html).toContain("Proposer aux 3 personnes en attente");
    expect(html).toContain('<section aria-labelledby="demo-today"');
    expect(html).toContain('id="demo-today"');
    expect(html).toContain("Reste 115 €");
    expect(html).toContain('aria-label="Libre de 14 h à 16 h. Ajouter un rendez-vous"');
    expect(html).toContain("Pause");
  });

  it("replaces the list with why a closed day is empty", () => {
    const html = renderToString(h(DayList, { id: "d", title: "Demain", closed: "Fermé" }));
    expect(html).toContain('<p class="text-sm text-muted">Fermé</p>');
    expect(html).not.toContain("<ul");
  });
});

describe("<AgendaWeekView>", () => {
  const entry = (over: Partial<TimelineEntry>): TimelineEntry => ({
    key: "b1",
    start: 600,
    length: 120,
    look: "booking",
    time: "10 h – 12 h",
    title: "Fatou",
    sub: "Knotless",
    tag: null,
    label: "10 h – 12 h, Fatou, Knotless",
    ...over,
  });
  const props: AgendaWeekViewProps = {
    title: "Semaine du 19 octobre",
    prev: { href: "#", label: "Semaine précédente" },
    next: { href: "#", label: "Semaine suivante" },
    actions: [{ label: "Bloquer" }, { label: "Nouveau rendez-vous", primary: true }],
    kpis: [{ id: "bookings", value: "12", label: "rendez-vous" }],
    days: [
      {
        key: "2026-10-20",
        weekday: "Mar",
        day: "20",
        label: "Mardi 20 octobre",
        today: true,
        status: "Ouvert",
        open: true,
        entries: [entry({}), entry({ key: "g1", start: 840, length: 45, look: "gap", title: "Libre", sub: "45 min", label: "Libre" })],
      },
    ],
    range: { from: 540, to: 1140 },
    locale: "fr",
    labels: { kpis: "Chiffres de la semaine", today: "aujourd’hui", noWorkingDays: "Aucun jour travaillé" },
  };

  it("renders the KPIs and the days' timelines", () => {
    const html = renderToString(h(AgendaWeekView, props));
    expect(html).toContain('<ul aria-label="Chiffres de la semaine"');
    expect(html).toContain('<section aria-label="Mardi 20 octobre" class="relative rounded-input bg-canvas"');
    expect(html).toContain('aria-label="10 h – 12 h, Fatou, Knotless"');
    expect(html).toContain('aria-pressed="false"');
    // Hour labels in French, with a non-breaking space: 9 h … 19 h.
    expect(html).toContain(">9\u00a0h</span>");
    expect(html).toContain(">19\u00a0h</span>");
    // 10 h at 48 px an hour from 9 h; the 45-minute gap fits one line.
    expect(html).toMatch(/style="top:48px;height:93px;left:0%;right:0%"/);
  });

  it("says so when no day is worked", () => {
    expect(renderToString(h(AgendaWeekView, { ...props, days: [] }))).toContain("Aucun jour travaillé");
  });
});

describe("<ProTabBar>", () => {
  it("draws the active tab's bar in place without an indicator", () => {
    const html = renderToString(
      h(ProTabBar, {
        start: [
          { id: "today", href: "#", label: "Aujourd'hui" },
          { id: "agenda", href: "#", label: "Agenda" },
        ],
        end: [
          { id: "shop", href: "#", label: "Boutique" },
          { id: "page", href: "#", label: "Ma page" },
        ],
        active: "today",
        labels: { nav: "Navigation", add: "Ajouter" },
      }),
    );
    expect(html).toMatch(/<nav aria-label="Navigation"/);
    expect(html).toMatch(/<a href="#" aria-current="page"[^>]*><span aria-hidden="true" data-bar="true" class="[^"]*bg-ink /);
    expect(html).toContain('aria-label="Ajouter"');
    expect(html.match(/<svg/g)).toHaveLength(5);
  });
});

describe("<CollectFields> in a <SheetPicture>", () => {
  const fields = {
    methods: [
      { value: "cash" as const, label: "Espèces", hint: "En main propre" },
      { value: "payment_link" as const, label: "Lien de paiement", hint: "Par WhatsApp" },
    ],
    tips: [
      { value: 0, label: "Aucun" },
      { value: 500, label: "5 €" },
    ],
    tip: 500,
    offerTip: false,
    labels: { method: "Paiement", tip: "Pourboire", offerTip: "Proposer un pourboire", linkExplain: "Le lien part.", recordExplain: "C’est noté." },
  };

  it("draws the sheet still, with the methods and tips", () => {
    const html = renderToString(
      h(SheetPicture, { title: "Encaisser 115 €", closeLabel: "Fermer", className: "absolute inset-x-0 bottom-0" }, h(CollectFields, { ...fields, method: "cash" })),
    );
    expect(html).toMatch(/<div class="[^"]*rounded-t-sheet[^"]*absolute inset-x-0 bottom-0"/);
    expect(html).toContain('<h2 class="text-panel-title font-semibold">Encaisser 115 €</h2>');
    expect(html).toContain('aria-label="Fermer"');
    expect(html).toMatch(/checked="" value="500"/);
    expect(html).toContain("C’est noté.");
  });

  it("asks whether the payment link offers a tip", () => {
    const html = renderToString(h(CollectFields, { ...fields, method: "payment_link" }));
    expect(html).toContain("Proposer un pourboire");
    expect(html).not.toContain("Pourboire</legend>");
    expect(html).toContain("Le lien part.");
  });
});
