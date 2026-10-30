import { z } from "zod";

// Only the fields Kitoko reads. z.object drops unknown keys, so new PayPal fields never break parsing.

export const moneySchema = z.object({ currency_code: z.string(), value: z.string() });

export const linkSchema = z.object({ href: z.string(), rel: z.string(), method: z.string().optional() });
export type Link = z.output<typeof linkSchema>;

export const findLink = (links: Link[] | undefined, ...rels: string[]): string | null => {
  for (const rel of rels) {
    const l = links?.find((x) => x.rel === rel);
    if (l) return l.href;
  }
  return null;
};

/** The last path segment of a HATEOAS link (".../captures/ABC" → "ABC"). */
export const lastSegment = (href: string | null): string | null => {
  if (!href) return null;
  const path = href.split("?")[0] ?? "";
  return path.split("/").filter(Boolean).pop() ?? null;
};
