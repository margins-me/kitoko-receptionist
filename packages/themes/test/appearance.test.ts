import { describe, expect, it } from "vitest";
import { parseAppearance, resolveAppearance, suggestLayout } from "../src";

describe("parseAppearance", () => {
  it("falls back to defaults on unknown values", () => {
    expect(parseAppearance({ layout: "carrousel", style: "y2k", theme: "neon", titleFont: "comic", gallery: "x" })).toEqual({
      layout: null,
      style: "epure",
      theme: "craie",
      titleFont: null,
      cover: null,
      gallery: [],
    });
  });

  it("keeps valid values and clamps the focal point", () => {
    const a = parseAppearance({ layout: "plein", style: "street", theme: "ebene", titleFont: "syne", coverPath: "p/cover.jpg", focalX: 0.2, focalY: 4, coverWidth: 1600, coverHeight: 0 });
    expect(a).toMatchObject({ layout: "plein", style: "street", theme: "ebene", titleFont: "syne" });
    expect(a.cover).toEqual({ path: "p/cover.jpg", focalX: 0.2, focalY: 0.5, width: 1600, height: null });
  });
});

describe("suggestLayout", () => {
  it.each([
    [null, 0, "bandeau"],
    [null, 2, "bandeau"],
    [{ width: 1200, height: 1600 }, 0, "plein"],
    [{ width: 2400, height: 1200 }, 0, "bandeau"],
    [{ width: 2400, height: 1200 }, 3, "encadre"],
    [null, 4, "encadre"],
  ] as const)("cover %j with %d gallery photos → %s", (cover, galleryCount, layout) => {
    expect(suggestLayout({ cover, galleryCount })).toBe(layout);
  });
});

describe("resolveAppearance", () => {
  const base = parseAppearance({});
  it("passes the style through", () => {
    expect(resolveAppearance({ ...base, style: "doux" }).style).toBe("doux");
  });

  it("uses the theme's suggested font until she picks one", () => {
    expect(resolveAppearance({ ...base, theme: "rose" }).titleFont).toBe("fraunces");
    expect(resolveAppearance({ ...base, theme: "rose", titleFont: "syne" }).titleFont).toBe("syne");
  });

  it("never overrides a chosen layout, but encadré needs a photo", () => {
    const cover = { path: "c.jpg", focalX: 0.5, focalY: 0.5, width: 2000, height: 1000 };
    expect(resolveAppearance({ ...base, layout: "plein", cover }).layout).toBe("plein");
    expect(resolveAppearance({ ...base, layout: "bandeau" }).layout).toBe("bandeau");
    expect(resolveAppearance({ ...base, layout: "plein" }).layout).toBe("plein");
    expect(resolveAppearance({ ...base, layout: "encadre" }).layout).toBe("sans");
    expect(resolveAppearance({ ...base, layout: "sans", cover }).layout).toBe("sans");
    expect(resolveAppearance({ ...base, layout: "encadre", gallery: ["g.jpg"] }).layout).toBe("encadre");
    expect(resolveAppearance({ ...base, cover }).layout).toBe("bandeau");
    expect(resolveAppearance(base).layout).toBe("bandeau");
  });
});
