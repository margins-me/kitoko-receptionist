// Markdown-lite for the receptionist's replies: **bold**, line breaks, and links lifted out of the text to be shown
// as buttons under the bubble. A link to a deposit page (/pay/…) becomes the "Pay deposit" card.

export type Run = { text: string; bold: boolean };
export type ChatLink = { href: string; label: string | null; pay: boolean };
export type RichText = { lines: Run[][]; links: ChatLink[] };

// [label](url) or a bare http(s) URL; the bare one stops before trailing punctuation.
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()"'`{}[\]]+[^\s<>().,;:!?"'`{}[\]*])/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;

/** Same-site paths and http(s) URLs only: never javascript: or data:. */
function safeHref(raw: string): string | null {
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A deposit page: /pay/<id> with or without a language prefix, never the dev approval simulator. */
export function isPayLink(href: string): boolean {
  const path = href.startsWith("/") ? href : new URL(href).pathname;
  return /^(?:\/[a-z]{2})?\/pay\/(?!fake-approve)[^/?#]+/.test(path);
}

function runs(line: string): Run[] {
  const out: Run[] = [];
  let last = 0;
  for (const match of line.matchAll(BOLD)) {
    if (match.index > last) out.push({ text: line.slice(last, match.index), bold: false });
    out.push({ text: match[1] ?? "", bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out;
}

export function parseRichText(text: string): RichText {
  const links: ChatLink[] = [];
  const stripped = text.replace(LINK, (whole, label: string | undefined, target: string | undefined, bare: string | undefined) => {
    const href = safeHref(target ?? bare ?? "");
    if (!href) return label ?? whole;
    if (!links.some((l) => l.href === href)) links.push({ href, label: label?.trim() || null, pay: isPayLink(href) });
    return "";
  });
  const lines = stripped
    .split("\n")
    // A line left holding only "Pay here:" punctuation once its link is gone keeps its words; an empty one goes,
    // but a blank line between paragraphs stays (one).
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/\s+([:.,])$/, "$1"))
    .filter((line, i, all) => line.trim() !== "" || (i > 0 && all[i - 1]?.trim() !== ""))
    .map(runs);
  while (lines.length && lines.at(-1)!.every((r) => !r.text.trim())) lines.pop();
  return { lines, links };
}

/** The reply as plain words, for the screen reader's live region: no asterisks, links by their label. */
export function plainText(text: string): string {
  const { lines, links } = parseRichText(text);
  const words = lines.map((line) => line.map((r) => r.text).join("")).join(" ").replace(/\s+/g, " ").trim();
  return [words, ...links.map((l) => l.label ?? "")].filter(Boolean).join(" ");
}
