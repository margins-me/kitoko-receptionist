import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");
const css = readFileSync(join(root, "packages/ui/src/styles.css"), "utf8");

function token(name: string): string {
  const hex = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css)?.[1];
  if (!hex) throw new Error(`--color-${name} is not a 6-digit hex in styles.css`);
  return hex;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("token contrast", () => {
  // Control boundaries: WCAG 1.4.11 (3:1). Text: WCAG 1.4.3 (4.5:1). Checked on both card and page greys.
  const pairs: [string, string, number][] = [
    ["field", "surface", 3],
    ["field", "soft", 3],
    ["ring-off", "surface", 3],
    ["ring-off", "soft", 3],
    ["placeholder", "surface", 4.5],
    ["placeholder", "soft", 4.5],
    ["muted", "surface", 4.5],
    ["muted", "soft", 4.5],
    ["muted", "canvas", 4.5],
    ["body", "soft", 4.5],
    ["placeholder", "canvas", 4.5],
    ["page-fg", "page", 4.5],
    ["on-brand", "brand", 4.5],
    ["on-inverse", "inverse", 4.5],
    ["on-inverse-muted", "inverse", 4.5],
    ["on-danger", "danger", 4.5],
  ];
  it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, min) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(min);
  });
});

// Colours in classNames must be role tokens, so a theme can restyle them. Hex in TS for APIs
// that take strings (payment SDKs, canvas, Satori) is not matched: only class syntax is. Arbitrary values with a
// colour function (shadow-[0_2px_4px_rgba(…)]) count too.
const LITERAL =
  /(?<![\w-])(?:[\w-]+:)*(?:text|bg|border|ring|fill|stroke|outline|from|via|to|divide|shadow|decoration|caret|accent)-(?:white|black)(?![\w-])|-\[#[0-9a-f]{3,8}\]|-\[[^\]\s"]*(?:rgba?|hsla?|oklch)\(/gi;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("no literal colours in classNames", () => {
  // One app now: the dashboard lives in apps/web/src/app/dashboard.
  const files = ["apps/web/src", "packages/ui/src"].flatMap((dir) => sources(join(root, dir)));
  it.each(files.map((file) => [file.slice(root.length + 1), file]))("%s", (_, file) => {
    const hits = readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line, i) => [...line.matchAll(LITERAL)].map((m) => `${i + 1}: ${m[0]}`));
    expect(hits).toEqual([]);
  });
});
