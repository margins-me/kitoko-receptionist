import { describe, expect, it } from "vitest";
import { entryPosition, entrySize, hourMarks, isOneLine, overlapColumns, place } from "../src/pro-app";

describe("place", () => {
  const range = { from: 540, to: 1140 };
  it("sizes a block to its duration", () => {
    // 9 h to 15 h 15.
    expect(place({ start: 540, length: 375 }, range, 56 / 60, 48)).toEqual({ top: 0, height: 347 });
  });

  it("keeps short blocks readable and clips to the range", () => {
    // 10 h to 10 h 15, then 8 h to 10 h.
    expect(place({ start: 600, length: 15 }, range, 1, 40)).toEqual({ top: 60, height: 40 });
    expect(place({ start: 480, length: 120 }, range, 1, 40)).toEqual({ top: 0, height: 57 });
  });

  it("marks every hour", () => {
    expect(hourMarks({ from: 540, to: 720 })).toEqual([540, 600, 660, 720]);
  });
});

const box = (top: number, bottom: number) => ({ top, height: bottom - top });

describe("overlapColumns", () => {
  it("keeps items that do not overlap full width", () => {
    expect(overlapColumns([box(0, 100), box(100, 160), box(200, 240)])).toEqual([
      { column: 0, columns: 1 },
      { column: 0, columns: 1 },
      { column: 0, columns: 1 },
    ]);
  });

  it("puts a no-show and the booking at the same time side by side, the first given on the left", () => {
    expect(overlapColumns([box(0, 300), box(0, 300)])).toEqual([
      { column: 0, columns: 2 },
      { column: 1, columns: 2 },
    ]);
  });

  it("shares columns only within a group of overlapping items", () => {
    // 0-300 overlaps 60-120 and 200-260; 120 frees column 1 for 200-260; 400-460 stands alone.
    expect(overlapColumns([box(0, 300), box(60, 120), box(200, 260), box(400, 460)])).toEqual([
      { column: 0, columns: 2 },
      { column: 1, columns: 2 },
      { column: 1, columns: 2 },
      { column: 0, columns: 1 },
    ]);
  });

  it("opens a third column when three items overlap at once", () => {
    expect(overlapColumns([box(0, 200), box(50, 150), box(100, 180)])).toEqual([
      { column: 0, columns: 3 },
      { column: 1, columns: 3 },
      { column: 2, columns: 3 },
    ]);
  });

  it("follows the boxes' tops, not the order given", () => {
    expect(overlapColumns([box(100, 200), box(0, 150)])).toEqual([
      { column: 1, columns: 2 },
      { column: 0, columns: 2 },
    ]);
  });

  it("handles an empty day", () => {
    expect(overlapColumns([])).toEqual([]);
  });
});

describe("isOneLine", () => {
  it("puts short boxes on one line, lower on desktop columns", () => {
    expect(isOneLine(65, false)).toBe(true);
    expect(isOneLine(66, undefined)).toBe(false);
    expect(isOneLine(51, true)).toBe(true);
    expect(isOneLine(52, true)).toBe(false);
    expect(isOneLine(60, true)).toBe(false);
  });
});

describe("entryPosition", () => {
  it("shares the width among the items drawn over each other", () => {
    expect(entryPosition({ top: 10, height: 40 }, { column: 0, columns: 1 })).toEqual({ top: 10, height: 40, left: "0%", right: "0%" });
    expect(entryPosition({ top: 10, height: 40 }, { column: 1, columns: 2 })).toEqual({ top: 10, height: 40, left: "50%", right: "0%" });
    expect(entryPosition({ top: 0, height: 40 }, { column: 0, columns: 2 })).toMatchObject({ left: "0%", right: "50%" });
  });
});

describe("entrySize", () => {
  it("uses smaller type in desktop columns", () => {
    expect(entrySize(true)).toEqual({ button: "gap-px rounded-[10px] p-2", title: "text-sm leading-tight", time: "text-xs", sub: "text-xs leading-snug" });
    expect(entrySize(undefined)).toEqual({ button: "gap-0.5 rounded-input px-3 py-2.5", title: "", time: "text-caption", sub: "text-caption" });
  });
});
