import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "../src/button";
import { buttonState } from "../src/button-state";
import { buttonStyles, iconButtonStyles } from "../src/button-styles";

const base = { variant: "primary", size: "lg" } as const;

describe("buttonState", () => {
  it("is on by default, with the plain look and the caller's classes", () => {
    const s = buttonState({ ...base, className: "flex-1" });
    expect(s.off).toBe(false);
    expect(s.showReason).toBe(false);
    expect(s.ariaDisabled).toBeUndefined();
    expect(s.ariaBusy).toBeUndefined();
    expect(s.buttonClass).toBe(`${buttonStyles(base)} flex-1`);
  });

  it("is off while disabled or loading, with the muted look", () => {
    for (const s of [buttonState({ ...base, disabled: true }), buttonState({ ...base, loading: true })]) {
      expect(s.off).toBe(true);
      expect(s.ariaDisabled).toBe(true);
      expect(s.buttonClass).toContain("cursor-not-allowed");
      expect(s.buttonClass).toContain("bg-hairline text-muted");
    }
    expect(buttonState({ ...base, loading: true }).ariaBusy).toBe(true);
    expect(buttonState({ ...base, disabled: true }).ariaBusy).toBeUndefined();
  });

  it("greys a ghost button's text instead of its background", () => {
    const s = buttonState({ variant: "ghost", size: "md", disabled: true });
    expect(s.buttonClass).toContain("text-disabled");
    expect(s.buttonClass).not.toContain("bg-hairline");
  });

  it("shows the reason only when disabled, full width, with the classes on the wrapper", () => {
    expect(buttonState({ ...base, loading: true, reason: "Pas encore" }).showReason).toBe(false);
    expect(buttonState({ ...base, disabled: true, reason: "" }).showReason).toBe(false);
    const s = buttonState({ ...base, disabled: true, reason: "Pas encore", className: "flex-1" });
    expect(s.showReason).toBe(true);
    expect(s.buttonClass).toContain("w-full");
    expect(s.buttonClass).not.toContain("flex-1");
    expect(s.wrapperClass).toBe("inline-flex flex-col gap-1.5 flex-1");
    expect(buttonState({ ...base, disabled: true, reason: "r", fullWidth: true }).wrapperClass).toBe("inline-flex flex-col gap-1.5 w-full");
  });
});

describe("buttonStyles", () => {
  // Merge-free: the pro page joins these without tailwind-merge, so no two parts may set the same property.
  it("keeps the size's padding on a ghost button and underlines it", () => {
    const ghost = buttonStyles({ variant: "ghost", size: "sm" }).split(" ");
    expect(ghost).toContain("px-4");
    expect(ghost).toContain("underline");
    expect(ghost).not.toContain("no-underline");
    expect(buttonStyles({ size: "sm" }).split(" ")).toContain("px-4");
  });

  it("replaces the variant colours while disabled", () => {
    const off = buttonStyles({ variant: "outline", disabled: true }).split(" ");
    expect(off).toEqual(expect.arrayContaining(["border", "border-transparent", "bg-hairline", "text-muted", "cursor-not-allowed"]));
    expect(off).not.toContain("bg-surface");
    expect(off).not.toContain("border-outline");
  });

  it("has a danger outline and an icon button look", () => {
    expect(buttonStyles({ variant: "danger-outline" })).toContain("border-outline bg-surface text-danger");
    expect(iconButtonStyles()).toContain("size-11");
    expect(iconButtonStyles({ variant: "soft" })).toMatch(/ bg-soft$/);
  });
});

describe("Button", () => {
  const render = (props: Parameters<typeof Button>[0]) => renderToStaticMarkup(createElement(Button, props));

  it("renders a plain button", () => {
    expect(render({ children: "Go" })).toBe(`<button type="button" class="${buttonStyles()}">Go</button>`);
  });

  it("renders a spinner and the busy state while loading", () => {
    const html = render({ loading: true, type: "submit", children: "Go" });
    expect(html).toMatch(/^<button type="submit" aria-disabled="true" aria-busy="true" class="[^"]*cursor-not-allowed[^"]*"><svg/);
    expect(html).toContain("animate-spin");
  });

  it("wraps the button with its reason when disabled", () => {
    const html = render({ disabled: true, reason: "Pas encore", className: "flex-1", children: "Go" });
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html.startsWith('<span class="inline-flex flex-col gap-1.5 flex-1"><button')).toBe(true);
    expect(html).toContain(`<span id="${id}" class="text-caption text-muted">Pas encore</span></span>`);
  });
});
