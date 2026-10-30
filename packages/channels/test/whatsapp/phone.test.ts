import { expect, it } from "vitest";
import { fromWaId, toWaId } from "../../src/whatsapp/phone";

it("keeps digits only", () => {
  expect(toWaId("+33 6 12 34 56 78")).toBe("33612345678");
  expect(toWaId("+32470123456")).toBe("32470123456");
});

it("turns a WhatsApp id back into E.164", () => {
  expect(fromWaId("33612345678")).toBe("+33612345678");
  expect(fromWaId("+33612345678")).toBe("+33612345678");
});
