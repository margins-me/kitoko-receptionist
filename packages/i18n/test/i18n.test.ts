import { describe, expect, it } from "vitest";
import { isBot, isLocale, localeCookie, matchLocale, pickLocale, referralCode, referralCookie, toLocale } from "../src/index";

describe("matchLocale", () => {
  it("ranks by q-value, header order on ties, and skips refused languages", () => {
    expect(matchLocale("de;q=1, en;q=0.4, fr;q=0.7")).toBe("fr");
    expect(matchLocale("en;q=0.5, es;q=0.8, it;q=0.7")).toBe("es");
    expect(matchLocale("it, es")).toBe("it");
    expect(matchLocale("fr;q=0, en;q=0.1")).toBe("en");
  });

  it("maps regions to their primary subtag", () => {
    expect(matchLocale("fr-BE")).toBe("fr");
    expect(matchLocale("fr-CA,fr;q=0.9")).toBe("fr");
    expect(matchLocale("fr-SN")).toBe("fr");
    expect(matchLocale("es-419")).toBe("es");
    expect(matchLocale("pt-BR")).toBe("pt");
    expect(matchLocale("EN-us")).toBe("en");
  });

  it("returns null for unsupported or empty input", () => {
    expect(matchLocale("de-DE,de;q=0.9,*;q=0.5")).toBeNull();
    expect(matchLocale("")).toBeNull();
    expect(matchLocale(null)).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
    expect(matchLocale([])).toBeNull();
  });

  it("reads navigator.languages in order", () => {
    expect(matchLocale(["de-DE", "pt-BR", "en"])).toBe("pt");
    expect(matchLocale(["nl"])).toBeNull();
  });
});

describe("pickLocale", () => {
  const fallback = "en" as const;

  it("lets the query beat the cookie, the cookie beat the account and the account beat the header", () => {
    expect(pickLocale({ query: "it", cookie: "fr", account: "es", acceptLanguage: "pt", fallback })).toBe("it");
    expect(pickLocale({ query: "xx", cookie: "fr", account: "es", acceptLanguage: "pt", fallback })).toBe("fr");
    expect(pickLocale({ cookie: "de", account: "es", acceptLanguage: "pt", fallback })).toBe("es");
    expect(pickLocale({ acceptLanguage: "fr-FR,fr;q=0.9", fallback })).toBe("fr");
  });

  it("falls back when nothing matches", () => {
    expect(pickLocale({ acceptLanguage: "de-DE", fallback })).toBe("en");
    expect(pickLocale({ fallback: "fr" })).toBe("fr");
  });
});

describe("isBot", () => {
  it("flags requests without Accept-Language", () => {
    expect(isBot("Mozilla/5.0", null)).toBe(true);
    expect(isBot("Mozilla/5.0", " ")).toBe(true);
  });

  it("flags crawlers and link-preview bots", () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      "WhatsApp/2.23.20.0",
      "Twitterbot/1.0",
      "Mozilla/5.0 (compatible; Discordbot/2.0)",
    ]) {
      expect(isBot(ua, "fr-FR")).toBe(true);
    }
  });

  it("lets a person through", () => {
    expect(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", "fr-FR,fr;q=0.9")).toBe(false);
    expect(isBot(null, "fr")).toBe(false);
  });
});

describe("helpers", () => {
  it("reads unknown stored values as English", () => {
    expect(isLocale("pt")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(toLocale("de")).toBe("en");
    expect(toLocale(null)).toBe("en");
  });

  it("sets a year-long Lax cookie on the shared domain", () => {
    expect(localeCookie("fr", ".kitoko.page")).toEqual({
      name: "kitoko_locale",
      value: "fr",
      maxAge: 31536000,
      sameSite: "lax",
      path: "/",
      domain: ".kitoko.page",
    });
    expect(localeCookie("fr")).not.toHaveProperty("domain");
  });
});

describe("referral cookie", () => {
  it("accepts a code of 3 to 24 letters and digits, lowercased", () => {
    expect(referralCode(" Sandrine ")).toBe("sandrine");
    expect(referralCode("k7m2x9ab")).toBe("k7m2x9ab");
  });
  it("refuses anything else", () => {
    for (const bad of ["ab", "a".repeat(25), "no space", "x;y", "é", "", null, undefined, 4]) expect(referralCode(bad)).toBeNull();
  });
  it("lasts 60 days on the shared domain", () => {
    const cookie = referralCookie("sandrine", ".kitoko.page");
    expect(cookie).toMatchObject({ name: "kitoko_via", value: "sandrine", maxAge: 5_184_000, domain: ".kitoko.page" });
    expect(referralCookie("sandrine")).not.toHaveProperty("domain");
  });
});
