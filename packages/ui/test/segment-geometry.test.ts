import { describe, expect, it } from "vitest";
import { edgeTransition, insetBox } from "../src/micro/segment-geometry";

describe("insetBox", () => {
  it("measures the target's insets inside the row's padding box", () => {
    const row = { clientLeft: 1, clientTop: 2, clientWidth: 300, clientHeight: 40 };
    const p = { left: 10, top: 20, right: 312, bottom: 64 };
    const r = { left: 111, top: 22, right: 211, bottom: 62 };
    expect(insetBox(p, r, row)).toEqual({ left: 100, top: 0, right: 100, bottom: 0 });
  });
});

describe("edgeTransition", () => {
  const at = (left: number, right: number) => ({ left, top: 0, right, bottom: 0 });

  it("jumps when not animating, on first placement, or without a sideways move", () => {
    expect(edgeTransition(at(0, 200), at(100, 100), false)).toBe("none");
    expect(edgeTransition(null, at(100, 100), true)).toBe("none");
    expect(edgeTransition(at(100, 100), at(100, 100), true)).toBe("none");
  });

  it("leads with the right edge when moving right", () => {
    expect(edgeTransition(at(0, 200), at(100, 100), true)).toBe(
      "left 320ms cubic-bezier(0.3,1.25,0.6,1) 40ms, right 180ms cubic-bezier(0.23,1,0.32,1), top 240ms ease, bottom 240ms ease",
    );
  });

  it("leads with the left edge when moving left", () => {
    expect(edgeTransition(at(100, 100), at(0, 200), true)).toBe(
      "left 180ms cubic-bezier(0.23,1,0.32,1), right 320ms cubic-bezier(0.3,1.25,0.6,1) 40ms, top 240ms ease, bottom 240ms ease",
    );
  });
});
