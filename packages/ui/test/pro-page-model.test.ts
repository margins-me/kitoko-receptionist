import { describe, expect, it } from "vitest";
import {
  absolutePhoto,
  contactLinks,
  coverPosition,
  coverSizes,
  factsLine,
  hiddenRows,
  initials,
  pageTabs,
  serviceGroups,
  serviceSections,
  tabFromUrl,
  thumbColumn,
  urlWithTab,
} from "../src/pro-page/model";

describe("pro page tabs", () => {
  it("always shows services and infos", () => {
    expect(pageTabs({ photos: 0, reviews: false, shop: false })).toEqual(["prestations", "infos"]);
  });

  it("adds photos, reviews and the shop when there are some, in the handover's order", () => {
    expect(pageTabs({ photos: 4, reviews: true, shop: true })).toEqual(["prestations", "photos", "avis", "infos", "boutique"]);
    expect(pageTabs({ photos: 0, reviews: true, shop: true })).toEqual(["prestations", "avis", "infos", "boutique"]);
  });
});

describe("pro page tab in the URL", () => {
  const tabs = pageTabs({ photos: 3, reviews: true, shop: false });

  it("reads ?onglet=, then an old #hash", () => {
    expect(tabFromUrl("?onglet=avis", "", tabs)).toBe("avis");
    expect(tabFromUrl("?etape=options&onglet=photos", "#infos", tabs)).toBe("photos");
    expect(tabFromUrl("", "#infos", tabs)).toBe("infos");
    expect(tabFromUrl("", "#%61vis", tabs)).toBe("avis");
  });

  it("ignores tabs the page does not have and junk", () => {
    expect(tabFromUrl("?onglet=boutique", "", tabs)).toBeNull();
    expect(tabFromUrl("?onglet=AVIS", "", tabs)).toBeNull();
    expect(tabFromUrl("", "#%E0%A4%A", tabs)).toBeNull();
    expect(tabFromUrl("", "", tabs)).toBeNull();
  });

  it("writes ?onglet= keeping the booking query, none for the first tab", () => {
    const at = (search: string, hash = "") => ({ pathname: "/en/nala", search, hash });
    expect(urlWithTab(at(""), "avis", tabs)).toBe("/en/nala?onglet=avis");
    expect(urlWithTab(at("?etape=options&prestation=x"), "photos", tabs)).toBe("/en/nala?etape=options&prestation=x&onglet=photos");
    expect(urlWithTab(at("?onglet=avis"), "infos", tabs)).toBe("/en/nala?onglet=infos");
    expect(urlWithTab(at("?onglet=avis&jour=2026-10-26"), "prestations", tabs)).toBe("/en/nala?jour=2026-10-26");
    expect(urlWithTab(at("?onglet=avis"), "prestations", tabs)).toBe("/en/nala");
  });

  it("drops an old tab #hash but keeps any other", () => {
    expect(urlWithTab({ pathname: "/nala", search: "", hash: "#avis" }, "infos", tabs)).toBe("/nala?onglet=infos");
    expect(urlWithTab({ pathname: "/nala", search: "", hash: "#top" }, "infos", tabs)).toBe("/nala?onglet=infos#top");
  });
});

describe("pro page cover", () => {
  it("formats the focal point as object-position", () => {
    expect(coverPosition(0.5, 0.5)).toBe("50% 50%");
    expect(coverPosition(0, 1)).toBe("0% 100%");
    expect(coverPosition(0.3333, 0.25)).toBe("33.3% 25%");
  });

  it("clamps and centres values out of range", () => {
    expect(coverPosition(-0.2, 1.4)).toBe("0% 100%");
    expect(coverPosition(Number.NaN, Number.POSITIVE_INFINITY)).toBe("50% 50%");
  });

  it("sizes the cover per layout", () => {
    expect(coverSizes("bandeau")).toBe("100vw");
    expect(coverSizes("plein")).toBe("100vw");
    expect(coverSizes("encadre")).toContain("calc(100vw - 32px)");
  });
});

describe("pro page services", () => {
  const categories = [
    { id: "c1", name: "Tresses" },
    { id: "c2", name: "Soins" },
    { id: "c3", name: "Vide" },
  ];
  const services = [
    { id: "s1", categoryId: "c2" },
    { id: "s2", categoryId: null },
    { id: "s3", categoryId: "c1" },
    { id: "s4", categoryId: "gone" },
    { id: "s5", categoryId: "c2" },
  ];

  it("groups services in the pro's category order, uncategorised and unknown categories last", () => {
    expect(serviceGroups(categories, services, "Autres")).toEqual([
      { id: "c1", title: "Tresses", services: [services[2]] },
      { id: "c2", title: "Soins", services: [services[0], services[4]] },
      { id: "other", title: "Autres", services: [services[1], services[3]] },
    ]);
  });

  it("drops empty groups", () => {
    expect(serviceGroups(categories, [services[0]!], "Autres").map((g) => g.id)).toEqual(["c2"]);
    expect(serviceGroups([], [], "Autres")).toEqual([]);
  });
});

describe("pro page contacts", () => {
  it("links WhatsApp by digits and Instagram by handle", () => {
    expect(contactLinks({ whatsappE164: "+33 6 12 34 56 78", instagram: "nala.braids" })).toEqual([
      { key: "whatsapp", href: "https://wa.me/33612345678" },
      { key: "instagram", href: "https://www.instagram.com/nala.braids/" },
    ]);
    expect(contactLinks({ whatsappE164: null, instagram: "a b" })).toEqual([{ key: "instagram", href: "https://www.instagram.com/a%20b/" }]);
    expect(contactLinks({ whatsappE164: "", instagram: null })).toEqual([]);
  });
});

describe("pro page photos and avatar", () => {
  const mediaUrl = (path: string) => `https://cdn.example/${path}`;

  it("resolves storage paths and keeps full URLs", () => {
    expect(absolutePhoto("pros/p1/a.jpg", mediaUrl)).toBe("https://cdn.example/pros/p1/a.jpg");
    expect(absolutePhoto("https://img.example/a.jpg", mediaUrl)).toBe("https://img.example/a.jpg");
    expect(absolutePhoto("http://img.example/a.jpg", mediaUrl)).toBe("http://img.example/a.jpg");
  });

  it("takes up to two initials", () => {
    expect(initials("Nala")).toBe("N");
    expect(initials(" aïcha  diallo ")).toBe("AD");
    expect(initials("Kemi Ade Bello")).toBe("KA");
    expect(initials("")).toBe("");
  });
});

describe("services list sections", () => {
  it("groups consecutive services by their category title, one untitled section without titles", () => {
    const s = (id: string, group?: string) => ({ id, group });
    expect(serviceSections([s("a", "Tresses"), s("b", "Tresses"), s("c", "Locks")]).map((x) => [x.title, x.services.map((v) => v.id)])).toEqual([
      ["Tresses", ["a", "b"]],
      ["Locks", ["c"]],
    ]);
    expect(serviceSections([s("a"), s("b")])).toEqual([{ title: undefined, services: [s("a"), s("b")] }]);
  });

  it("folds a category past 5 rows only when that hides 2 or more, never a single list", () => {
    expect(hiddenRows(5, true)).toBe(0);
    expect(hiddenRows(6, true)).toBe(0);
    expect(hiddenRows(7, true)).toBe(2);
    expect(hiddenRows(12, true)).toBe(7);
    expect(hiddenRows(12, false)).toBe(0);
  });

  it("draws a photo column only when a service of the list has a photo", () => {
    expect(thumbColumn([{ image: null }, {}])).toBe(false);
    expect(thumbColumn([{ image: null }, { image: { src: "/a.jpg", alt: "" } }])).toBe(true);
  });
});

describe("facts line", () => {
  const rating = { value: "4,9", count: "(128 avis)", label: "4,9 sur 5, 128 avis" };

  it("takes her facts, leaving out what she has not got", () => {
    expect(factsLine({ rating, area: "Paris 18e", booking: ["Réservation 24h/24"] }, ["ignored"])).toEqual({
      rating,
      items: ["Paris 18e"],
      booking: ["Réservation 24h/24"],
    });
    expect(factsLine({ rating: null, area: "  ", booking: [] }, undefined)).toEqual({ rating: null, items: [], booking: [] });
  });

  it("falls back to the older chips as plain items", () => {
    expect(factsLine(undefined, ["4,9 sur 5", "", "Paris 18e"])).toEqual({ rating: null, items: ["4,9 sur 5", "Paris 18e"], booking: [] });
    expect(factsLine(null, undefined)).toEqual({ rating: null, items: [], booking: [] });
  });
});
