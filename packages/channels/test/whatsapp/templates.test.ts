import { describe, expect, it } from "vitest";
import { render, renderEmail } from "../../src/whatsapp/render";
import { TEMPLATE_LOCALES, templates } from "../../src/whatsapp/templates";
import type { TemplateDef, TemplateName, TemplateVars, UtilityName } from "../../src/whatsapp/templates";

const entries = Object.entries(templates) as [TemplateName, TemplateDef][];
const locales = TEMPLATE_LOCALES;
const placeholders = (s: string) => [...s.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));

function sampleVars(t: TemplateDef): Record<string, string> {
  const keys = [...t.variables, ...(t.button ? [t.button.variable] : [])];
  return Object.fromEntries(keys.map((k) => [k, `<${k}>`]));
}

describe("template data", () => {
  it.each(entries)("%s has a body in every locale", (_key, t) => {
    for (const l of locales) expect(t.body[l].trim().length).toBeGreaterThan(0);
  });

  it.each(entries)("%s uses {{1}}..{{n}} once each, in order, matching its variables", (_key, t) => {
    const expected = t.variables.map((_, i) => i + 1);
    for (const l of locales) expect(placeholders(t.body[l])).toEqual(expected);
  });

  it.each(entries)("%s passes Meta's body rules: no leading or trailing variable, no emoji, 1024 chars max", (_key, t) => {
    for (const l of locales) {
      const body = t.body[l];
      expect(body).not.toMatch(/^\s*\{\{|\}\}\s*$/);
      expect(body).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(body.length).toBeLessThanOrEqual(1024);
    }
  });

  it.each(entries)("%s has no leading or trailing spaces and no doubled spaces in any locale", (_key, t) => {
    for (const l of locales) {
      for (const text of [t.body[l], ...(t.category === "UTILITY" ? [t.subject[l]] : []), ...(t.button ? [t.button.text[l]] : [])]) {
        expect(text).toBe(text.trim());
        expect(text).not.toMatch(/ {2}/);
      }
    }
  });

  it.each(entries)("%s button url ends with its only variable and the text fits 25 chars", (_key, t) => {
    if (!t.button) return;
    expect(t.button.url).toMatch(/^https:\/\/kitoko\.page\/[^{]*\{\{1\}\}$/);
    for (const l of locales) expect(t.button.text[l].length).toBeLessThanOrEqual(25);
  });

  it("names are unique snake_case with the kitoko_ prefix", () => {
    const names = entries.map(([, t]) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^kitoko_[a-z0-9]+(_[a-z0-9]+)*$/);
  });

  it("only the rebooking nudge and the opening announcement are MARKETING", () => {
    const marketing = entries.filter(([, t]) => t.category === "MARKETING").map(([k]) => k);
    expect(marketing.sort()).toEqual(["opening_announcement", "rebooking_nudge"]);
  });

  it.each(entries)("%s renders with no placeholder left", (key, t) => {
    for (const l of locales) {
      const { body, buttons } = render(key, l, sampleVars(t) as TemplateVars<typeof key>);
      expect(body).not.toContain("{{");
      for (const b of buttons) expect(b.url).not.toContain("{{");
    }
  });
});

describe("email fallback", () => {
  const utility = entries.filter((e): e is [UtilityName, Extract<TemplateDef, { category: "UTILITY" }>] => e[1].category === "UTILITY");

  it.each(utility)("%s has a subject in every locale using only its own variables", (_key, t) => {
    for (const l of locales) {
      expect(t.subject[l].trim().length).toBeGreaterThan(0);
      for (const n of placeholders(t.subject[l])) expect(n).toBeLessThanOrEqual(t.variables.length);
    }
  });

  it.each(utility)("%s renders an email with no placeholder left", (key, t) => {
    for (const l of locales) {
      const { subject, text } = renderEmail(key, l, sampleVars(t) as TemplateVars<typeof key>);
      expect(subject + text).not.toContain("{{");
    }
  });
});
