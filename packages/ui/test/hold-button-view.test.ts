import { describe, expect, it } from "vitest";
import { holdView } from "../src/micro/hold-button-view";

const idle = { phase: "idle", hasDoneLabel: true, off: false, loading: false } as const;

describe("holdView", () => {
  it("shows the main label until the hold is done", () => {
    for (const phase of ["idle", "holding"] as const) {
      const v = holdView({ ...idle, phase });
      expect(v.showDone).toBe(false);
      expect(v.labelClass).not.toContain("opacity-0");
      expect(v.doneLabelClass).toContain("opacity-0 blur-[2px]");
    }
    const done = holdView({ ...idle, phase: "done" });
    expect(done.showDone).toBe(true);
    expect(done.labelClass).toContain("opacity-0 blur-[2px]");
    expect(done.doneLabelClass).not.toContain("opacity-0");
  });

  it("keeps the main label when there is no done label", () => {
    expect(holdView({ ...idle, phase: "done", hasDoneLabel: false }).showDone).toBe(false);
  });

  it("dims the button only while off and idle", () => {
    expect(holdView({ ...idle, off: true }).rootClass).toContain("cursor-not-allowed opacity-50");
    expect(holdView({ ...idle, off: true, phase: "done" }).rootClass).not.toContain("opacity-50");
    expect(holdView(idle).rootClass).not.toContain("cursor-not-allowed");
  });

  it("colours the track and the fill by tone", () => {
    expect(holdView(idle)).toMatchObject({ fillClass: "bg-danger text-on-danger" });
    expect(holdView(idle).rootClass).toContain("bg-error-bg text-danger");
    const brand = holdView({ ...idle, tone: "brand" });
    expect(brand.fillClass).toBe("bg-brand text-on-brand");
    expect(brand.rootClass).toContain("bg-soft text-ink");
  });

  it("appends the caller's classes and sets the ARIA state", () => {
    expect(holdView({ ...idle, className: "flex-auto" }).rootClass).toMatch(/^hb-root .* flex-auto$/);
    expect(holdView(idle)).toMatchObject({ ariaDisabled: undefined, ariaBusy: undefined });
    expect(holdView({ ...idle, off: true, loading: true })).toMatchObject({ ariaDisabled: true, ariaBusy: true });
  });
});
