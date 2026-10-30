import { toWaId } from "./phone";
import { templateLocale, templates } from "./templates";
import type { Locale, TemplateDef, TemplateName, TemplateVars, UtilityDef, UtilityName } from "./templates";

// Cloud API rejects parameters that are empty or hold newlines, tabs or 4+ spaces (error 132018).
function param(vars: Record<string, string>, key: string): string {
  return (vars[key] ?? "").replace(/\s+/g, " ").trim() || "-";
}

function fill(text: string, values: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, n: string) => values[Number(n) - 1] ?? match);
}

export function render<N extends TemplateName>(name: N, locale: Locale, vars: TemplateVars<N>) {
  const l = templateLocale(locale);
  const t: TemplateDef = templates[name];
  const v: Record<string, string> = vars;
  return {
    body: fill(t.body[l], t.variables.map((k) => param(v, k))),
    buttons: t.button ? [{ text: t.button.text[l], url: fill(t.button.url, [param(v, t.button.variable)]) }] : [],
  };
}

export function renderText<N extends TemplateName>(name: N, locale: Locale, vars: TemplateVars<N>): string {
  const { body, buttons } = render(name, locale, vars);
  return [body, ...buttons.map((b) => `${b.text}${locale === "fr" ? " : " : ": "}${b.url}`)].join("\n\n");
}

export function renderEmail<N extends UtilityName>(name: N, locale: Locale, vars: TemplateVars<N>) {
  const t: UtilityDef = templates[name];
  const v: Record<string, string> = vars;
  return {
    subject: fill(t.subject[templateLocale(locale)], t.variables.map((k) => param(v, k))),
    text: renderText(name, locale, vars),
  };
}

export function toCloudApiPayload<N extends TemplateName>(name: N, locale: Locale, to: string, vars: TemplateVars<N>) {
  const t: TemplateDef = templates[name];
  const v: Record<string, string> = vars;
  const text = (key: string) => ({ type: "text", text: param(v, key) });
  return {
    messaging_product: "whatsapp",
    to: toWaId(to),
    type: "template",
    template: {
      name: t.name,
      language: { code: templateLocale(locale) },
      components: [
        { type: "body", parameters: t.variables.map(text) },
        ...(t.button ? [{ type: "button", sub_type: "url", index: "0", parameters: [text(t.button.variable)] }] : []),
      ],
    },
  };
}

/** A reply button (interactive "button" message): Meta allows 3 per message, a 20-character title and a 256-character id. */
export type ReplyButton = { id: string; title: string };

// Free-form messages are only delivered inside the 24-hour customer service window; outside it, use a template.
export function toTextPayload(to: string, text: string) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId(to),
    type: "text",
    text: { preview_url: true, body: text },
  };
}

export function toButtonsPayload(to: string, text: string, buttons: readonly ReplyButton[]) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toWaId(to),
    type: "interactive",
    interactive: {
      type: "button",
      body: { text },
      action: { buttons: buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
    },
  };
}
