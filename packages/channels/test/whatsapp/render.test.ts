import { describe, expect, it } from "vitest";
import { render, renderEmail, renderText, toCloudApiPayload } from "../../src/whatsapp/render";
import type { TemplateVars } from "../../src/whatsapp/templates";

const confirmed: TemplateVars<"booking_confirmed"> = {
  firstName: "Awa",
  service: "Box braids mi-dos",
  proName: "Nala Braids",
  when: "samedi 24 octobre à 10 h",
  paid: "30 €",
  manageToken: "tok_123",
};

describe("render", () => {
  it("fills the body and the manage button", () => {
    expect(render("booking_confirmed", "fr", confirmed)).toEqual({
      body: "C’est réservé, Awa !\n\nBox braids mi-dos chez Nala Braids, le samedi 24 octobre à 10 h.\nDéjà payé : 30 €.\n\nPour décaler ou annuler, utilise le lien ci-dessous.",
      buttons: [{ text: "Gérer mon rendez-vous", url: "https://kitoko.page/r/tok_123" }],
    });
  });

  it("flattens whitespace and fills empty values, as the Cloud API requires", () => {
    const { body } = render("reminder_eve", "en", {
      firstName: "Awa",
      service: "Knotless",
      proName: "Nala Braids",
      time: "10:00",
      address: "12 rue Myrha, Paris 18e",
      access: "",
      prep: "Wash your hair.\n\tCome   detangled.",
      manageToken: "tok_123",
    });
    expect(body).toContain("Floor and door code: -\n");
    expect(body).toContain("Before you come: Wash your hair. Come detangled.\n");
  });

  it("is typed per template", () => {
    // @ts-expect-error manageToken is missing
    render("booking_confirmed", "fr", { firstName: "Awa", service: "x", proName: "x", when: "x", paid: "x" });
  });

  it("writes the link out in full for plain text and email", () => {
    expect(renderText("booking_confirmed", "en", confirmed)).toMatch(/use the link below\.\n\nManage my booking: https:\/\/kitoko\.page\/r\/tok_123$/);
    expect(renderEmail("booking_confirmed", "fr", confirmed)).toEqual({
      subject: "C’est réservé chez Nala Braids",
      text: expect.stringMatching(/\n\nGérer mon rendez-vous : https:\/\/kitoko\.page\/r\/tok_123$/),
    });
  });

  it("says the waitlist place is held for 30 minutes", () => {
    const vars = { firstName: "Awa", proName: "Nala Braids", date: "samedi 24 octobre", time: "10 h", manageToken: "tok_123" };
    expect(render("waitlist_offer", "fr", vars).body).toContain("On te la garde 30 minutes");
    expect(render("waitlist_offer", "it", vars).body).toContain("Te lo teniamo per 30 minuti");
    expect(render("waitlist_offer", "es", vars).body).toContain("Te lo guardamos 30 minutos");
  });

  it("fills the Italian body and button", () => {
    expect(render("booking_confirmed", "it", { ...confirmed, when: "sabato 24 ottobre alle 10:00" })).toEqual({
      body: "Prenotazione confermata, Awa!\n\nBox braids mi-dos da Nala Braids, sabato 24 ottobre alle 10:00.\nHai già pagato: 30 €.\n\nPer spostare o annullare, usa il link qui sotto.",
      buttons: [{ text: "Gestisci appuntamento", url: "https://kitoko.page/r/tok_123" }],
    });
  });

  it("fills the Spanish body and button", () => {
    expect(render("booking_confirmed", "es", { ...confirmed, when: "sábado 24 de octubre a las 10:00" })).toEqual({
      body: "¡Reserva confirmada, Awa!\n\nBox braids mi-dos con Nala Braids, el sábado 24 de octubre a las 10:00.\nYa has pagado: 30 €.\n\nPara cambiar o cancelar la cita, usa el enlace de abajo.",
      buttons: [{ text: "Gestionar mi cita", url: "https://kitoko.page/r/tok_123" }],
    });
  });

  it("writes Italian and Spanish emails with a subject and the link in full", () => {
    expect(renderEmail("booking_confirmed", "it", confirmed)).toEqual({
      subject: "Hai prenotato da Nala Braids",
      text: expect.stringMatching(/qui sotto\.\n\nGestisci appuntamento: https:\/\/kitoko\.page\/r\/tok_123$/),
    });
    expect(renderEmail("booking_confirmed", "es", confirmed)).toEqual({
      subject: "Reserva confirmada con Nala Braids",
      text: expect.stringMatching(/de abajo\.\n\nGestionar mi cita: https:\/\/kitoko\.page\/r\/tok_123$/),
    });
  });

  it("offers the balance link with or without a tip mention", () => {
    const vars = { firstName: "Awa", proName: "Nala Braids", amount: "85 €", manageToken: "tok_123" };
    expect(render("balance_link", "fr", vars).body).toContain("le solde à régler est de 85 €.");
    expect(render("balance_link", "fr", vars).body).not.toContain("pourboire");
    expect(render("balance_link_tip", "fr", vars).body).toContain("ajouter un pourboire");
    expect(render("balance_link_tip", "en", vars).buttons).toEqual([{ text: "Pay the balance", url: "https://kitoko.page/r/tok_123" }]);
    expect(render("balance_link_tip", "it", vars).body).toContain("aggiungere una mancia");
    expect(render("balance_link_tip", "es", vars).body).toContain("añadir una propina");
    expect(render("balance_link", "es", vars).body).not.toContain("propina");
  });
});

describe("toCloudApiPayload", () => {
  it("builds the Graph API template message", () => {
    expect(toCloudApiPayload("booking_confirmed", "fr", "+33 6 12 34 56 78", confirmed)).toEqual({
      messaging_product: "whatsapp",
      to: "33612345678",
      type: "template",
      template: {
        name: "kitoko_booking_confirmed",
        language: { code: "fr" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Awa" },
              { type: "text", text: "Box braids mi-dos" },
              { type: "text", text: "Nala Braids" },
              { type: "text", text: "samedi 24 octobre à 10 h" },
              { type: "text", text: "30 €" },
            ],
          },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "tok_123" }] },
        ],
      },
    });
  });

  it("omits the button component when the template has none", () => {
    const payload = toCloudApiPayload("booking_cancelled", "en", "+33612345678", {
      firstName: "Awa",
      proName: "Nala Braids",
      service: "Knotless",
      when: "Saturday 24 October at 10:00",
      refund: "30 €",
    });
    expect(payload.template.language).toEqual({ code: "en" });
    expect(payload.template.components.map((c) => c.type)).toEqual(["body"]);
  });

  it("asks Meta for the Italian and Spanish translations of the same template", () => {
    for (const locale of ["it", "es"] as const) {
      const payload = toCloudApiPayload("booking_confirmed", locale, "+39 312 345 6789", confirmed);
      expect(payload.to).toBe("393123456789");
      expect(payload.template.name).toBe("kitoko_booking_confirmed");
      expect(payload.template.language).toEqual({ code: locale });
      expect(payload.template.components).toEqual(toCloudApiPayload("booking_confirmed", "fr", "+33612345678", confirmed).template.components);
    }
  });

  it("sends a Portuguese client the English template until pt is approved", () => {
    expect(toCloudApiPayload("booking_confirmed", "pt", "+351912345678", confirmed).template.language).toEqual({ code: "en" });
    expect(render("booking_confirmed", "pt", confirmed)).toEqual(render("booking_confirmed", "en", confirmed));
  });
});
