import { describe, expect, it } from "vitest";
import { dbError } from "../src/errors";

describe("dbError", () => {
  it("maps the expected codes to their names", () => {
    expect(dbError({ code: "23P01" }, ["23P01", "KT001"])).toBe("slot_taken");
    expect(dbError({ code: "KT001" }, ["23P01", "KT001"])).toBe("slot_blocked");
    expect(dbError({ code: "KT005" }, ["KT005"])).toBe("too_many_holds");
    expect(dbError({ code: "KT030" }, ["KT030"])).toBe("staff_not_eligible");
    expect(dbError({ code: "KT031" }, ["KT031"])).toBe("amount_mismatch");
    expect(dbError({ code: "KT032" }, ["KT032"])).toBe("not_pending");
    expect(dbError({ code: "P0002" }, ["P0002"])).toBe("not_found");
    expect(dbError({ code: "42501" }, ["42501"])).toBe("forbidden");
  });

  it("rethrows a code the caller did not expect, as a bug", () => {
    const error = { code: "KT001", message: "slot_blocked" };
    expect(() => dbError(error, ["23P01"])).toThrow(expect.objectContaining({ code: "KT001" }));
    expect(() => dbError({ code: "XX000" }, ["P0002"])).toThrow();
  });
});
