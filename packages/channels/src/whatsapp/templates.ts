import type { Locale } from "@kitoko/booking/locale";

export type { Locale };
// pt templates are not registered yet (each language needs Meta approval): a pt client gets the English template.
export type TemplateLocale = Exclude<Locale, "pt">;
export const TEMPLATE_LOCALES: readonly TemplateLocale[] = ["en", "fr", "it", "es"];
export const templateLocale = (locale: Locale): TemplateLocale => (locale === "pt" ? "en" : locale);
export type Category = "UTILITY" | "MARKETING";

type Base = {
  name: string;
  variables: readonly string[];
  body: Record<TemplateLocale, string>;
  button?: { text: Record<TemplateLocale, string>; url: string; variable: string };
};
// UTILITY messages fall back to email when WhatsApp fails, so they need a subject.
export type UtilityDef = Base & { category: "UTILITY"; subject: Record<TemplateLocale, string> };
export type TemplateDef = UtilityDef | (Base & { category: "MARKETING" });

const manageButton = {
  text: { fr: "Gérer mon rendez-vous", en: "Manage my booking", it: "Gestisci appuntamento", es: "Gestionar mi cita" },
  url: "https://kitoko.page/r/{{1}}",
  variable: "manageToken",
} as const;

const balanceButton = {
  text: { fr: "Payer le solde", en: "Pay the balance", it: "Paga il saldo", es: "Pagar el saldo" },
  url: "https://kitoko.page/r/{{1}}",
  variable: "manageToken",
} as const;

// Keys are what the code uses; `name` is the Meta name, frozen once submitted, so a rejected draft can come back as …_v2 without touching callers.
export const templates = {
  booking_confirmed: {
    name: "kitoko_booking_confirmed",
    category: "UTILITY",
    subject: {
      fr: "C’est réservé chez {{3}}",
      en: "You’re booked with {{3}}",
      it: "Hai prenotato da {{3}}",
      es: "Reserva confirmada con {{3}}",
    },
    variables: ["firstName", "service", "proName", "when", "paid"],
    body: {
      fr: "C’est réservé, {{1}} !\n\n{{2}} chez {{3}}, le {{4}}.\nDéjà payé : {{5}}.\n\nPour décaler ou annuler, utilise le lien ci-dessous.",
      en: "You’re booked, {{1}}!\n\n{{2}} with {{3}} on {{4}}.\nAlready paid: {{5}}.\n\nTo reschedule or cancel, use the link below.",
      it: "Prenotazione confermata, {{1}}!\n\n{{2}} da {{3}}, {{4}}.\nHai già pagato: {{5}}.\n\nPer spostare o annullare, usa il link qui sotto.",
      es: "¡Reserva confirmada, {{1}}!\n\n{{2}} con {{3}}, el {{4}}.\nYa has pagado: {{5}}.\n\nPara cambiar o cancelar la cita, usa el enlace de abajo.",
    },
    button: manageButton,
  },
  deposit_link: {
    name: "kitoko_deposit_link",
    category: "UTILITY",
    subject: {
      fr: "Confirme ton rendez-vous chez {{2}}",
      en: "Confirm your appointment with {{2}}",
      it: "Conferma il tuo appuntamento da {{2}}",
      es: "Confirma tu cita con {{2}}",
    },
    variables: ["firstName", "proName", "service", "when", "deposit"],
    body: {
      fr: "Bonjour {{1}}, {{2}} t’a réservé un créneau : {{3}}, le {{4}}.\n\nPour le confirmer, paie l’acompte de {{5}} et accepte les conditions de réservation dans les 2 heures. Passé ce délai, le créneau est libéré.",
      en: "Hi {{1}}, {{2}} has saved you a slot: {{3}} on {{4}}.\n\nTo confirm it, pay the {{5}} deposit and accept the booking terms within 2 hours. After that, the slot is released.",
      it: "Ciao {{1}}, {{2}} ti ha riservato una fascia oraria: {{3}}, {{4}}.\n\nPer confermarla, paga l’acconto di {{5}} e accetta le condizioni di prenotazione entro 2 ore. Trascorso questo tempo, la fascia oraria viene liberata.",
      es: "Hola, {{1}}. {{2}} te ha reservado un hueco: {{3}}, el {{4}}.\n\nPara confirmarlo, paga la señal de {{5}} y acepta las condiciones de reserva en un plazo de 2 horas. Pasado ese plazo, el hueco queda libre.",
    },
    button: {
      text: { fr: "Payer l’acompte", en: "Pay the deposit", it: "Paga l’acconto", es: "Pagar la señal" },
      url: "https://kitoko.page/r/{{1}}",
      variable: "manageToken",
    },
  },
  reminder_eve: {
    name: "kitoko_reminder_eve",
    category: "UTILITY",
    subject: {
      fr: "À demain chez {{3}}",
      en: "See you tomorrow at {{3}}",
      it: "A domani da {{3}}",
      es: "Mañana tienes cita con {{3}}",
    },
    variables: ["firstName", "service", "proName", "time", "address", "access", "prep"],
    body: {
      fr: "À demain, {{1}} !\n\n{{2}} chez {{3}} à {{4}}.\nAdresse : {{5}}\nÉtage et code : {{6}}\n\nAvant de venir : {{7}}\n\nBesoin de décaler ou d’annuler ? Utilise le lien ci-dessous.",
      en: "See you tomorrow, {{1}}!\n\n{{2}} with {{3}} at {{4}}.\nAddress: {{5}}\nFloor and door code: {{6}}\n\nBefore you come: {{7}}\n\nNeed to reschedule or cancel? Use the link below.",
      it: "A domani, {{1}}!\n\n{{2}} da {{3}} alle {{4}}.\nIndirizzo: {{5}}\nPiano e codice: {{6}}\n\nPrima di venire: {{7}}\n\nDevi spostare o annullare? Usa il link qui sotto.",
      es: "¡Hasta mañana, {{1}}!\n\n{{2}} con {{3}} a las {{4}}.\nDirección: {{5}}\nPiso y código: {{6}}\n\nAntes de venir: {{7}}\n\n¿Necesitas cambiar o cancelar la cita? Usa el enlace de abajo.",
    },
    button: manageButton,
  },
  booking_rescheduled: {
    name: "kitoko_booking_rescheduled",
    category: "UTILITY",
    subject: {
      fr: "Ton rendez-vous chez {{2}} est déplacé",
      en: "Your appointment with {{2}} has moved",
      it: "Il tuo appuntamento da {{2}} è stato spostato",
      es: "Tu cita con {{2}} ha cambiado",
    },
    variables: ["firstName", "proName", "service", "when"],
    body: {
      fr: "Bonjour {{1}}, ton rendez-vous chez {{2}} pour {{3}} est déplacé au {{4}}.\n\nTous les détails sont dans le lien ci-dessous.",
      en: "Hi {{1}}, your appointment with {{2}} for {{3}} has moved to {{4}}.\n\nAll the details are in the link below.",
      it: "Ciao {{1}}, il tuo appuntamento da {{2}} per {{3}} è stato spostato a {{4}}.\n\nTrovi tutti i dettagli nel link qui sotto.",
      es: "Hola, {{1}}. Tu cita con {{2}} para {{3}} se ha cambiado al {{4}}.\n\nTienes todos los detalles en el enlace de abajo.",
    },
    button: manageButton,
  },
  booking_cancelled: {
    name: "kitoko_booking_cancelled",
    category: "UTILITY",
    subject: {
      fr: "Ton rendez-vous chez {{2}} est annulé",
      en: "Your appointment with {{2}} is cancelled",
      it: "Il tuo appuntamento da {{2}} è stato annullato",
      es: "Tu cita con {{2}} se ha cancelado",
    },
    variables: ["firstName", "proName", "service", "when", "refund"],
    body: {
      fr: "Bonjour {{1}}, ton rendez-vous chez {{2}} pour {{3}} le {{4}} est annulé.\n\nMontant remboursé : {{5}}.\n\nÀ bientôt.",
      en: "Hi {{1}}, your appointment with {{2}} for {{3}} on {{4}} is cancelled.\n\nAmount refunded: {{5}}.\n\nTake care.",
      it: "Ciao {{1}}, il tuo appuntamento da {{2}} per {{3}}, {{4}}, è stato annullato.\n\nImporto rimborsato: {{5}}.\n\nA presto.",
      es: "Hola, {{1}}. Tu cita con {{2}} para {{3}} el {{4}} se ha cancelado.\n\nImporte reembolsado: {{5}}.\n\nHasta pronto.",
    },
  },
  review_request: {
    name: "kitoko_review_request",
    category: "UTILITY",
    subject: {
      fr: "Comment s’est passé ton rendez-vous ?",
      en: "How was your appointment?",
      it: "Com’è andato il tuo appuntamento?",
      es: "¿Qué tal tu cita?",
    },
    variables: ["firstName", "proName"],
    body: {
      fr: "Merci pour ta visite, {{1}} ! Comment s’est passé ton rendez-vous chez {{2}} ?\n\nTon avis compte : laisse-le avec le lien ci-dessous.",
      en: "Thanks for coming, {{1}}! How was your appointment with {{2}}?\n\nYour review matters: leave it with the link below.",
      it: "Grazie per la tua visita, {{1}}! Com’è andato il tuo appuntamento da {{2}}?\n\nLa tua recensione conta: lasciala con il link qui sotto.",
      es: "¡Gracias por tu visita, {{1}}! ¿Qué tal tu cita con {{2}}?\n\nTu reseña cuenta: déjala con el enlace de abajo.",
    },
    button: {
      text: { fr: "Laisser un avis", en: "Leave a review", it: "Lascia una recensione", es: "Dejar una reseña" },
      url: "https://kitoko.page/r/{{1}}",
      variable: "manageToken",
    },
  },
  rebooking_nudge: {
    name: "kitoko_rebooking_nudge",
    category: "MARKETING",
    variables: ["firstName", "weeks", "proName"],
    body: {
      fr: "Bonjour {{1}}, ça fait déjà {{2}} semaines depuis ton dernier rendez-vous chez {{3}}.\n\nEnvie de prévoir le prochain ? Les disponibilités sont sur le lien ci-dessous.",
      en: "Hi {{1}}, it’s been {{2}} weeks since your last appointment with {{3}}.\n\nReady to plan the next one? Availability is at the link below.",
      it: "Ciao {{1}}, sono già passate {{2}} settimane dal tuo ultimo appuntamento da {{3}}.\n\nVuoi fissare il prossimo? Le disponibilità sono nel link qui sotto.",
      es: "Hola, {{1}}. Ya han pasado {{2}} semanas desde tu última cita con {{3}}.\n\n¿Te apetece reservar la próxima? Tienes la disponibilidad en el enlace de abajo.",
    },
    button: {
      text: { fr: "Reprendre rendez-vous", en: "Book again", it: "Prenota di nuovo", es: "Volver a reservar" },
      url: "https://kitoko.page/{{1}}",
      variable: "proSlug",
    },
  },
  waitlist_offer: {
    name: "kitoko_waitlist_offer",
    category: "UTILITY",
    subject: {
      fr: "Une place s’est libérée chez {{2}}",
      en: "A spot opened with {{2}}",
      it: "Si è liberato un posto da {{2}}",
      es: "Se ha liberado un hueco con {{2}}",
    },
    variables: ["firstName", "proName", "date", "time"],
    body: {
      fr: "Bonne nouvelle, {{1}} : une place s’est libérée chez {{2}} le {{3}} à {{4}}.\n\nOn te la garde 30 minutes : réserve-la avec le lien ci-dessous.",
      en: "Good news, {{1}}: a spot just opened with {{2}} on {{3}} at {{4}}.\n\nWe’re holding it for you for 30 minutes: book it with the link below.",
      it: "Buone notizie, {{1}}: si è liberato un posto da {{2}} per {{3}} alle {{4}}.\n\nTe lo teniamo per 30 minuti: prenotalo con il link qui sotto.",
      es: "Buenas noticias, {{1}}: se ha liberado un hueco con {{2}} el {{3}} a las {{4}}.\n\nTe lo guardamos 30 minutos: resérvalo con el enlace de abajo.",
    },
    button: {
      text: { fr: "Réserver la place", en: "Book this spot", it: "Prenota il posto", es: "Reservar el hueco" },
      url: "https://kitoko.page/r/{{1}}",
      variable: "manageToken",
    },
  },
  opening_announcement: {
    name: "kitoko_opening_announcement",
    category: "MARKETING",
    variables: ["month", "proName"],
    body: {
      // "en {{1}}" not "de {{1}}": "de avril / de août / de octobre" would need elision.
      fr: "C’est ouvert ! Les dates en {{1}} chez {{2}} sont disponibles.\n\nRéserve avec le lien ci-dessous.",
      en: "Bookings are open! The {{1}} dates with {{2}} are now available.\n\nBook with the link below.",
      it: "Prenotazioni aperte! Le date di {{1}} da {{2}} sono disponibili.\n\nPrenota con il link qui sotto.",
      es: "¡Reservas abiertas! Las fechas de {{1}} con {{2}} ya están disponibles.\n\nReserva con el enlace de abajo.",
    },
    button: {
      text: { fr: "Réserver", en: "Book now", it: "Prenota", es: "Reservar" },
      url: "https://kitoko.page/{{1}}",
      variable: "proSlug",
    },
  },
  order_confirmed: {
    name: "kitoko_order_confirmed",
    category: "UTILITY",
    subject: {
      fr: "Commande confirmée chez {{2}}",
      en: "Your order from {{2}} is confirmed",
      it: "Il tuo ordine da {{2}} è confermato",
      es: "Tu pedido en {{2}} está confirmado",
    },
    variables: ["firstName", "proName", "reception", "details"],
    body: {
      fr: "Commande confirmée, {{1}} ! Merci pour ton achat chez {{2}}.\n\nMode de réception : {{3}}\nInfos pratiques : {{4}}\n\nÀ très vite.",
      en: "Order confirmed, {{1}}! Thanks for shopping with {{2}}.\n\nHow you’ll get it: {{3}}\nDetails: {{4}}\n\nSee you soon.",
      it: "Ordine confermato, {{1}}! Grazie per il tuo acquisto da {{2}}.\n\nModalità di consegna: {{3}}\nInformazioni utili: {{4}}\n\nA presto.",
      es: "¡Pedido confirmado, {{1}}! Gracias por tu compra en {{2}}.\n\nForma de entrega: {{3}}\nInformación práctica: {{4}}\n\n¡Hasta pronto!",
    },
  },
  balance_link: {
    name: "kitoko_balance_link",
    category: "UTILITY",
    subject: {
      fr: "Solde à régler chez {{2}}",
      en: "Your balance with {{2}}",
      it: "Saldo del tuo appuntamento da {{2}}",
      es: "Saldo pendiente con {{2}}",
    },
    variables: ["firstName", "proName", "amount"],
    body: {
      fr: "Merci {{1}} ! Pour ton rendez-vous chez {{2}}, le solde à régler est de {{3}}.\n\nTu peux le payer avec le lien ci-dessous.",
      en: "Thank you, {{1}}! For your appointment with {{2}}, the balance is {{3}}.\n\nYou can pay it with the link below.",
      it: "Grazie, {{1}}! Il saldo da pagare per il tuo appuntamento da {{2}} è di {{3}}.\n\nPuoi pagarlo con il link qui sotto.",
      es: "¡Gracias, {{1}}! El saldo pendiente de tu cita con {{2}} es de {{3}}.\n\nPuedes pagarlo con el enlace de abajo.",
    },
    button: balanceButton,
  },
  // Meta bodies are fixed text, so the optional tip sentence is its own approved template.
  balance_link_tip: {
    name: "kitoko_balance_link_tip",
    category: "UTILITY",
    subject: {
      fr: "Solde à régler chez {{2}}",
      en: "Your balance with {{2}}",
      it: "Saldo del tuo appuntamento da {{2}}",
      es: "Saldo pendiente con {{2}}",
    },
    variables: ["firstName", "proName", "amount"],
    body: {
      fr: "Merci {{1}} ! Pour ton rendez-vous chez {{2}}, le solde à régler est de {{3}}.\n\nTu peux le payer avec le lien ci-dessous et ajouter un pourboire si tu le souhaites.",
      en: "Thank you, {{1}}! For your appointment with {{2}}, the balance is {{3}}.\n\nYou can pay it with the link below and add a tip if you like.",
      it: "Grazie, {{1}}! Il saldo da pagare per il tuo appuntamento da {{2}} è di {{3}}.\n\nPuoi pagarlo con il link qui sotto e aggiungere una mancia, se vuoi.",
      es: "¡Gracias, {{1}}! El saldo pendiente de tu cita con {{2}} es de {{3}}.\n\nPuedes pagarlo con el enlace de abajo y añadir una propina si quieres.",
    },
    button: balanceButton,
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof templates;
type ButtonVar<N extends TemplateName> = (typeof templates)[N] extends { button: { variable: infer V extends string } } ? V : never;
export type UtilityName = { [K in TemplateName]: (typeof templates)[K]["category"] extends "UTILITY" ? K : never }[TemplateName];
export type TemplateVars<N extends TemplateName> = Record<(typeof templates)[N]["variables"][number] | ButtonVar<N>, string>;
