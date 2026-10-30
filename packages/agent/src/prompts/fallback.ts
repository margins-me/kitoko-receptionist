import type { Locale } from "@kitoko/i18n";

/**
 * What the user reads when a run fails (model unavailable, refusal, too many steps). Clients are addressed formally,
 * the pro informally, like the prompts.
 */
const TEXTS: Record<"client" | "pro", Record<Locale, string>> = {
  client: {
    en: "Sorry, I can't answer right now. Please try again in a moment.",
    fr: "Pardon, je ne peux pas répondre pour le moment. Merci de réessayer dans un instant.",
    it: "Mi scusi, al momento non riesco a rispondere. Riprovi tra poco.",
    es: "Disculpe, ahora mismo no puedo responder. Vuelva a intentarlo en un momento.",
    pt: "Peço desculpa, de momento não consigo responder. Tente novamente daqui a pouco.",
  },
  pro: {
    en: "Sorry, I can't answer right now. Try again in a moment.",
    fr: "Oups, je n'arrive pas à répondre pour l'instant. Réessaie dans un instant.",
    it: "Scusa, al momento non riesco a rispondere. Riprova tra poco.",
    es: "Perdona, ahora mismo no puedo responder. Inténtalo de nuevo en un momento.",
    pt: "Desculpa, de momento não consigo responder. Tenta outra vez daqui a pouco.",
  },
};

export const fallbackText = (audience: "client" | "pro", locale: Locale): string => TEXTS[audience][locale];
