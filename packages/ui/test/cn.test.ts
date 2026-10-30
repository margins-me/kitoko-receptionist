import { describe, expect, it } from "vitest";
import { cn } from "../src/cn";

describe("cn", () => {
  it("lets a caller's pb-* replace pb-safe (a padding-bottom utility from styles.css)", () => {
    expect(cn("px-4 pt-3 pb-safe", "pb-3")).toBe("px-4 pt-3 pb-3");
    expect(cn("bottom-0", "bottom-(--tab-bar-h)")).toBe("bottom-(--tab-bar-h)");
  });
});
