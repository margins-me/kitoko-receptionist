import type { AbstractIntlMessages } from "next-intl";

/** The locales whose missing messages show in English: a key not translated yet never breaks a page. */
// pt: English until native pt-PT copy is written (needs native review); it has no messages/pt files yet.
export const FALLS_BACK_TO_ENGLISH: readonly string[] = ["it", "es", "pt"];

const isObject = (value: unknown): value is AbstractIntlMessages => typeof value === "object" && value !== null && !Array.isArray(value);

/** `messages` laid over `fallback`, key by key at every depth: what `messages` lacks comes from `fallback`. */
export function withFallback(fallback: AbstractIntlMessages, messages: AbstractIntlMessages): AbstractIntlMessages {
  const merged: AbstractIntlMessages = { ...fallback };
  for (const [key, value] of Object.entries(messages)) {
    const base = merged[key];
    merged[key] = isObject(base) && isObject(value) ? withFallback(base, value) : value;
  }
  return merged;
}
