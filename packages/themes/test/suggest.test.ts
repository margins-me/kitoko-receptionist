import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, PICKER_THEMES, STYLE_IDS, THEMES, suggestStyle, suggestTheme } from "../src";

describe("suggestTheme", () => {
  it("has nothing to suggest without a colour", () => {
    expect(suggestTheme(null)).toBeNull();
    expect(suggestTheme("")).toBeNull();
    expect(suggestTheme("pink")).toBeNull();
    expect(suggestTheme("#12345")).toBeNull();
  });

  it("gives each picker theme back from its own colours", () => {
    for (const id of PICKER_THEMES) {
      const t = THEMES[id];
      // A dark theme is found by its background; a light one by its accent (craie and taupe have an ink accent: their background).
      const own = t.scheme === "dark" || id === "craie" || id === "taupe" ? t.bg : t.accent;
      expect(suggestTheme(own), id).toBe(id);
    }
  });

  it("puts a dark background on the dark theme of its hue", () => {
    expect(suggestTheme("#1B2A4A")).toBe("indigo"); // navy
    expect(suggestTheme("#4A0E2A")).toBe("velours"); // burgundy
    expect(suggestTheme("#3B2414")).toBe("bogolan"); // chocolate
    expect(suggestTheme("#000000")).toBe("ebene");
    expect(suggestTheme("#111")).toBe("ebene");
  });

  it("falls back to the light accents for a dark colour no dark theme has", () => {
    expect(suggestTheme("#00614c")).toBe("sauge"); // Alicia March's Acuity background
  });

  it("matches a pale colour with the light backgrounds of its hue", () => {
    expect(suggestTheme("#fae8e8")).toBe("rose");
    expect(suggestTheme("#E8B4C8")).toBe("rose");
    expect(suggestTheme("#fff5d9")).toBe("pierre"); // cream
    expect(suggestTheme("#E6E0F8")).toBe("lilas");
  });

  it("matches a mid colour with the nearest accent hue", () => {
    expect(suggestTheme("#C9A45C")).toBe("pierre"); // gold → bronze
    expect(suggestTheme("#7B1E3A")).toBe("rose"); // wine, raspberry hue
    expect(suggestTheme("#7A2E52")).toBe("prune"); // plum
    expect(suggestTheme("#C0392B")).toBe("terre"); // red
    expect(suggestTheme("#8E44AD")).toBe("lilas");
    expect(suggestTheme("#3498DB")).toBe("cobalt");
    expect(suggestTheme("#2ECC71")).toBe("sauge");
  });

  it("matches grey, white and black by lightness only", () => {
    expect(suggestTheme("#FFFFFF")).toBe("craie");
    expect(suggestTheme("#F7F7F7")).toBe("craie");
    expect(suggestTheme("#BDBDBD")).toBe("taupe");
    expect(suggestTheme("#333333")).toBe("ebene");
  });

  it("is null when no theme is within 25° of her hue", () => {
    expect(suggestTheme("#9ACD32")).toBeNull(); // lime
    expect(suggestTheme("#E8F5E9")).toBeNull(); // mint
  });

  it("only suggests picker themes", () => {
    for (const hex of ["#1B2A4A", "#fae8e8", "#C9A45C", "#000000", "#FFFFFF", "#00614c"]) expect(PICKER_THEMES).toContain(suggestTheme(hex));
  });
});

describe("suggestStyle", () => {
  it("starts the landing's four showcase trades on their style", () => {
    expect(suggestStyle(["tresses"])).toBe("heritage");
    expect(suggestStyle(["locks"])).toBe("street");
    expect(suggestStyle(["ongles"])).toBe("doux");
    expect(suggestStyle(["cils"])).toBe("editorial");
  });

  it("gives the other trades a style too", () => {
    expect(suggestStyle(["perruques"])).toBe("prestige");
    expect(suggestStyle(["coiffure"])).toBe("epure");
    expect(suggestStyle(["visage"])).toBe("spa");
    expect(suggestStyle(["massage"])).toBe("spa");
    expect(suggestStyle(["maquillage"])).toBe("editorial");
  });

  it("takes the first trade that has one", () => {
    expect(suggestStyle(["inconnu", "ongles", "tresses"])).toBe("doux");
    expect(suggestStyle(["coiffure", "cils"])).toBe("epure");
  });

  it("defaults to Épuré", () => {
    expect(suggestStyle([])).toBe(DEFAULT_STYLE);
    expect(suggestStyle(["barbier"])).toBe("epure");
  });

  it("always returns a style id", () => {
    for (const trade of ["tresses", "perruques", "ongles", "cils", "locks", "coiffure", "visage", "massage", "maquillage"]) {
      expect(STYLE_IDS).toContain(suggestStyle([trade]));
    }
  });
});
