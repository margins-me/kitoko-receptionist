import { describe, expect, it } from "vitest";
import { getAvailabilityInputs, getBookingByRef, getProByHandle, getProPage, listBookings, listPros, listServices, listStaff } from "../src";
import { AICHA, anon, NALA, STAFF, svc } from "./fixtures";

describe("public pages", () => {
  it("builds Aïcha's page with the anon client", async () => {
    const page = (await getProPage(anon(), "Aicha.Braids"))!;
    expect(page.pro).toMatchObject({
      id: AICHA,
      handle: "aicha.braids",
      name: "Aïcha Braids",
      city: "Milan",
      currency: "EUR",
      locale: "it",
      timezone: "Europe/Rome",
      avatarPath: "/photos/tresses-pose-sourire.jpg",
      appearance: { layout: "bandeau", style: "editorial", theme: "terre", titleFont: "fraunces", focalX: 0.5 },
      paymentsEnabled: true,
    });
    expect(page.pro.rules.deposit).toEqual({ mode: "fixed", cents: 3000 });
    expect(page.staff.map((s) => s.name)).toEqual(["Aïcha"]);
    expect(page.services.map((s) => [s.name.fr, s.basePriceCents, s.staffIds])).toEqual([
      ["Knotless braids", 8500, [STAFF.aicha]],
      ["Box braids", 7500, [STAFF.aicha]],
      ["Fulani braids", 9000, [STAFF.aicha]],
      ["Cornrows", 4500, [STAFF.aicha]],
    ]);
    expect(page.services[0]!.optionGroups[0]!.label.it).toBe("Misura delle trecce");
    expect(await getProPage(anon(), "nobody-here")).toBeNull();
  });

  it("lists pros for the landing page and MCP search", async () => {
    const all = await listPros(anon());
    expect(all.map((p) => p.handle)).toEqual(["aicha.braids", "anta.tresses", "kemi.nails", "studio-nala"]);
    expect((await listPros(anon(), { city: "milan" })).map((p) => p.handle)).toEqual(["aicha.braids", "anta.tresses"]);
    expect((await listPros(anon(), { trade: "ongles" })).map((p) => p.handle)).toEqual(["kemi.nails", "studio-nala"]);
    expect((await listPros(anon(), { currency: "GBP" })).map((p) => p.handle)).toEqual(["kemi.nails"]);
    expect((await listPros(anon(), { query: "cornrows" })).map((p) => p.handle)).toEqual(["aicha.braids", "anta.tresses"]);
    const kemi = all.find((p) => p.handle === "kemi.nails")!;
    expect(kemi.services[0]).toMatchObject({ name: "Gel extensions", fromPriceCents: 4500, minMinutes: 90 });
  });

  it("reads services, staff and pros", async () => {
    const services = await listServices(anon(), NALA);
    expect(new Set(services.flatMap((s) => s.staffIds))).toEqual(new Set([STAFF.nala, STAFF.sira]));
    expect((await listStaff(anon(), NALA)).map((s) => s.name)).toEqual(["Nala", "Sira"]);
    const pro = (await getProByHandle(svc(), "studio-nala"))!;
    expect(pro).toMatchObject({ currency: "EUR", paypalEmail: "kitoko-nala@business.example.com", locale: "fr" });
  });

  it("finds a booking by its reference and gives the slot engine its inputs", async () => {
    const now = Date.now();
    const [first] = await listBookings(svc(), AICHA, now, now + 7 * 86_400_000);
    expect((await getBookingByRef(svc(), first!.ref.toLowerCase()))?.id).toBe(first!.id);
    expect(await getBookingByRef(svc(), "ZZZZZZ")).toBeNull();
    const inputs = await getAvailabilityInputs(anon(), { proId: AICHA, from: now, to: now + 7 * 86_400_000 });
    expect(inputs.busy.length).toBeGreaterThan(0);
    expect(inputs.busy.every((b) => b.staffId === STAFF.aicha)).toBe(true);
  });
});
