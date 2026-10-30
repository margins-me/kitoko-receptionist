import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { customVars, type Layout } from "@kitoko/themes";
import { ProPage, type ProPageProps } from "../src/pro-page";

const labels: ProPageProps["labels"] = {
  tabs: { prestations: "Prestations", photos: "Photos", avis: "Avis", infos: "Infos", boutique: "Boutique" },
  tabList: "Sections de la page",
  close: "Fermer",
  share: "Partager la page",
  copied: "Lien copié",
  servicesEmpty: "Pas encore de prestation.",
  photos: "Photos de Nala",
  nextSlot: "Prochain créneau",
  nextSlots: "Prochains créneaux",
};

function render(over: Partial<ProPageProps> & { layout?: Layout } = {}): string {
  const { layout = "sans", ...rest } = over;
  const props: ProPageProps = {
    appearance: { layout, style: "epure", theme: "craie", titleFont: "hanken" },
    host: "kitoko.page",
    pro: { name: "Nala Braids", handle: "nala", tagline: null, avatar: null },
    cover: { image: { src: "/cover.jpg", alt: "" }, focalX: 0.5, focalY: 0.5 },
    photos: [],
    contacts: [],
    chips: [],
    services: [],
    reviews: null,
    infos: [],
    book: null,
    card: { deposit: null },
    labels,
    syncUrl: false,
    ...rest,
  };
  return renderToString(createElement(ProPage, props));
}

describe("<ProPage> sur-mesure", () => {
  it("sets her colours inline on the page root, over the preset", () => {
    const vars = customVars("craie", { accent: "#8A1538", bg: "#FDF6EC" });
    const html = render({ customVars: vars });
    expect(html).toMatch(/<main[^>]*data-theme="craie"[^>]*\sstyle="[^"]*--color-page:#FDF6EC;[^"]*--color-accent:#8A1538;[^"]*color-scheme:light/);
    expect(render()).not.toMatch(/<main[^>]*\sstyle=/);
  });

  it.each<Layout>(["sans", "bandeau", "plein", "encadre"])("draws her logo in the h1 with her name as alt (%s)", (layout) => {
    const html = render({ layout, pro: { name: "Nala Braids", handle: "nala", tagline: null, avatar: null, logo: { src: "/logo.png", alt: "", width: 300, height: 100 } } });
    const h1 = /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] ?? "";
    expect(h1).toMatch(/<img[^>]*src="\/logo.png"[^>]*alt="Nala Braids"/);
    expect(h1).not.toContain(">Nala Braids<");
    // Only plein draws the name on the photo: there the logo sits on a white pill.
    expect(h1.includes("bg-surface/94")).toBe(layout === "plein");
  });

  it("keeps her name as text without a logo", () => {
    expect(/<h1[^>]*>(.*?)<\/h1>/.exec(render())?.[1]).toBe("Nala Braids");
  });
});

describe("header without a cover", () => {
  it("draws plein in her accent colour with her initials, no scrim", () => {
    const html = render({ layout: "plein", cover: null });
    expect(html).toContain("bg-accent");
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*text-on-accent\/20[^"]*">NB<\/span>/);
    expect(html).not.toContain("photo-scrim");
    expect(/<h1[^>]*class="([^"]*)"/.exec(html)?.[1]).toContain("text-on-accent");
  });

  it("draws encadré with no photo as sans", () => {
    const html = render({ layout: "encadre", cover: null });
    expect(/<h1[^>]*class="([^"]*)"/.exec(html)?.[1]).toContain("text-[36px]");
    expect(html).not.toContain(labels.photos);
  });
});

describe("header contacts on phones", () => {
  const whatsapp = { key: "whatsapp" as const, href: "https://wa.me/33600000000", label: "WhatsApp" };
  const instagram = { key: "instagram" as const, href: "https://www.instagram.com/nala/", label: "Instagram" };
  const pill = (html: string, href: string) => new RegExp(`<a href="${href.replace(/[.?/]/g, "\\$&")}"[^>]*class="([^"]*)"`).exec(html)?.[1] ?? "";

  it.each<Layout>(["bandeau", "plein"])("a WhatsApp-only pro shows her WhatsApp pill on phones (%s)", (layout) => {
    const html = render({ layout, contacts: [whatsapp] });
    const cls = pill(html, whatsapp.href);
    expect(cls).toContain("inline-flex");
    expect(cls).not.toContain("hidden");
    // Nor is its row hidden on phones (plein used to hide the whole row under the desktop breakpoint).
    const row = /<div class="([^"]*)"><a href="https:\/\/wa\.me/.exec(html)?.[1];
    expect(row).toBeDefined();
    expect(row).not.toMatch(/(^|\s)hidden/);
  });

  it.each<Layout>(["bandeau", "plein"])("with both, phones show Instagram and desktop both (%s)", (layout) => {
    const html = render({ layout, contacts: [whatsapp, instagram] });
    expect(pill(html, instagram.href)).not.toContain("hidden");
    expect(pill(html, whatsapp.href)).toContain("hidden @desk:inline-flex");
  });
});

describe("service photos", () => {
  const service = { price: "80 €", duration: "2 h", href: "/nala/reserver" };
  const knotless = { src: "/knotless.jpg", srcSet: "/knotless.jpg 1x, /knotless@2x.jpg 2x", alt: "" };

  it("leads the row with her photo, and an empty space (no box, no letter) on rows without one so the names line up", () => {
    const html = render({
      services: [
        { ...service, id: "a", name: "Knotless", image: knotless },
        { ...service, id: "b", name: "Repose" },
      ],
    });
    expect(html).toMatch(/<a data-booking[^>]*><img src="\/knotless.jpg"[^>]*alt=""/);
    const blank = /<a data-booking[^>]*><span aria-hidden="true" class="([^"]*)"><\/span><span[^>]*><strong[^>]*>Repose</.exec(html)?.[1];
    expect(blank).toBe("size-12 shrink-0 @desk:size-14");
  });

  it("draws no photo column in a list where no service has a photo", () => {
    const html = render({ services: [{ ...service, id: "b", name: "Repose" }] });
    expect(html).toMatch(/<a data-booking[^>]*><span class="flex min-w-0/);
  });

  it("decides the photo column per category", () => {
    const html = render({
      services: [
        { ...service, id: "a", name: "Knotless", group: "Tresses", image: knotless },
        { ...service, id: "b", name: "Repose", group: "Tresses" },
        { ...service, id: "c", name: "Départ", group: "Locks" },
      ],
    });
    expect(html).toMatch(/<a data-booking[^>]*><span aria-hidden="true"[^>]*><\/span><span[^>]*><strong[^>]*>Repose</);
    expect(html).toMatch(/<a data-booking[^>]*><span class="flex min-w-0[^>]*><strong[^>]*>Départ</);
  });

  it("puts the price on the right in tabular figures, the duration under the name", () => {
    const html = render({ services: [{ ...service, id: "b", name: "Repose", price: "dès 85 €", duration: "4 h à 8 h 30" }] });
    expect(html).toMatch(/<strong[^>]*>Repose<\/strong><span class="text-sm text-page-muted[^"]*">4 h à 8 h 30<\/span><\/span><span class="[^"]*text-right[^"]*tabular-nums[^"]*">dès 85 €<\/span>/);
  });
});

describe("services by category", () => {
  const service = (id: string, group?: string) => ({ id, name: `Coiffure ${id}`, price: "80 €", duration: "2 h", group });
  const more = { ...labels, moreServices: "Voir les # autres prestations", fewerServices: "Voir moins" };
  const many = (n: number, group?: string) => Array.from({ length: n }, (_, i) => service(`${group ?? "s"}${i}`, group));

  it("renders every service, with a heading per category", () => {
    const services = [service("a", "Tresses"), service("b", "Tresses"), service("c", "Tresses"), service("d", "Locks"), service("e", "Locks"), service("f", "Locks")];
    const html = render({ services, labels: more });
    for (const s of services) expect(html).toContain(`>${s.name}<`);
    expect(html).toMatch(/<h3[^>]*>Tresses<\/h3>/);
    expect(html).toMatch(/<h3[^>]*>Locks<\/h3>/);
    expect(html).not.toContain("aria-expanded");
  });

  it("shows 5 rows of a long category and a button for the rest, all rows in the HTML", () => {
    const html = render({ services: [...many(8, "Tresses"), ...many(2, "Locks")], labels: more });
    expect(html.match(/class="hidden group-data-open\/rows:block"/g)).toHaveLength(3);
    expect(html).toMatch(/<ul id="pro-services-0"[^>]*class="group\/rows /);
    expect(html).toMatch(/<button type="button" aria-expanded="false" aria-controls="pro-services-0"[^>]*>Voir les 3 autres prestations</);
    for (let i = 0; i < 8; i++) expect(html).toContain(`>Coiffure Tresses${i}<`);
  });

  it("keeps a category of 6 whole, a single list whole, and every row without the labels", () => {
    expect(render({ services: [...many(6, "Tresses"), ...many(1, "Locks")], labels: more })).not.toContain("aria-expanded");
    expect(render({ services: many(12), labels: more })).not.toContain("aria-expanded");
    expect(render({ services: [...many(8, "Tresses"), ...many(1, "Locks")] })).not.toContain("aria-expanded");
  });
});

describe("facts under her name", () => {
  const facts = {
    rating: { value: "4,9", count: "(128 avis)", label: "4,9 sur 5, 128 avis" },
    area: "Paris 18e",
    booking: ["Réservation 24h/24", "Confirmation immédiate"],
  };
  const photos = Array.from({ length: 2 }, (_, i) => ({ src: `/g${i}.jpg`, alt: `Photo ${i}` }));
  // What is seen: the screen-reader label left out, tags dropped.
  const text = (html: string) =>
    html
      .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\u00a0/g, " ");

  it.each<Layout>(["sans", "bandeau", "plein", "encadre"])("draws the rating, area and booking facts (%s)", (layout) => {
    const html = render({ layout, facts, photos });
    expect(html).toContain('<span class="sr-only">4,9 sur 5, 128 avis</span>');
    expect(text(html)).toContain("4,9 (128 avis) · Paris 18e");
    expect(text(html)).toContain("Réservation 24h/24 · Confirmation immédiate");
  });

  it("draws nothing for what she does not have, and no chips with facts", () => {
    const html = render({ facts: { rating: null, area: null, booking: [] }, chips: ["Lundi au samedi"] });
    expect(html).not.toContain("sur 5");
    expect(html).not.toContain("Lundi au samedi");
  });

  it("falls back to the older chips on that line", () => {
    const html = render({ layout: "bandeau", chips: ["4,9 sur 5", "Paris 18e"] });
    expect(text(html)).toContain("4,9 sur 5 · Paris 18e");
  });
});

describe("encadré photos", () => {
  const gallery = (n: number) => Array.from({ length: n }, (_, i) => ({ src: `/g${i}.jpg`, alt: `Photo ${i + 1}` }));
  const withAll = { ...labels, allPhotos: "Voir les # photos" };

  it("counts the swiped photos on phones", () => {
    const html = render({ layout: "encadre", photos: gallery(2) });
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*tabular-nums @desk:hidden">1<!-- -->\/<!-- -->3<\/span>/);
  });

  it("draws the desktop mosaic from 5 gallery photos: cover large, 4 small, the last counting all", () => {
    const html = render({ layout: "encadre", photos: gallery(5), labels: withAll });
    const mosaic = /<div class="hidden @desk:block"><ul aria-label="Photos de Nala"[^>]*>(.*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect(mosaic.match(/<li/g)).toHaveLength(5);
    expect(mosaic).toMatch(/<li class="col-span-2 row-span-2"><button type="button" data-photo="0" aria-label="Photos de Nala"[^>]*><img src="\/cover.jpg"/);
    expect(mosaic).toMatch(/<button type="button" data-photo="0" aria-label="Voir les 6 photos"[^>]*><img src="\/g3.jpg"/);
    // The phone strip hides on desktop instead.
    expect(html).toMatch(/<div class="relative overflow-hidden[^"]*@desk:hidden">/);
  });

  it("keeps the strip under 5 gallery photos", () => {
    expect(render({ layout: "encadre", photos: gallery(4), labels: withAll })).not.toContain("hidden @desk:block");
  });
});

describe("name bar", () => {
  it("is server-rendered hidden and inert, watching her name", () => {
    const html = render();
    const bar = /<div inert=""[^>]*class="([^"]*)"/.exec(html);
    expect(bar?.[1]).toContain("opacity-0");
    expect(html).not.toContain("data-shown=\"\"");
    expect(html).toMatch(/<h1 id="pro-name"/);
  });

  it("scrolls a preview inside its frame (height parent): no main, no h1", () => {
    const html = render({ height: "parent", idPrefix: "apercu" });
    expect(html).toMatch(/^<div id="apercu-page"[^>]*class="[^"]*h-full overflow-y-auto/);
    expect(html).not.toMatch(/<(main|h1)[\s>]/);
    expect(html).toMatch(/<p id="apercu-name"/);
  });
});
