"use client";

import { createContext, useContext } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ThemeId } from "@kitoko/themes";

type BrandValue = { theme?: ThemeId; vars?: Record<string, string> | null };
type BrandProps = { "data-brand"?: ThemeId; style?: CSSProperties };

const BrandContext = createContext<BrandValue>({});

const propsFor = ({ theme, vars }: BrandValue): BrandProps => ({
  ...(theme ? { "data-brand": theme } : {}),
  // Custom properties are not in CSSProperties' keys; React sets them as given.
  ...(vars ? { style: vars as CSSProperties } : {}),
});

/**
 * Gives Kitoko's white surfaces inside (checkout, manage pages, portaled sheets and dialogs) the button colour
 * of the pro's theme: `data-brand` sets only --color-brand and --color-on-brand (packages/themes tailwind.ts).
 * `vars` (buttonVars of her sur-mesure theme, Pro plan) set the same two variables inline, over the preset's.
 */
export function Brand({
  theme,
  vars,
  className,
  children,
}: {
  theme?: ThemeId;
  vars?: Record<string, string> | null;
  className?: string;
  children: ReactNode;
}) {
  const value = { theme, vars };
  return (
    <BrandContext value={value}>
      <div className={className} {...propsFor(value)}>
        {children}
      </div>
    </BrandContext>
  );
}

/** For portaled content, which sits outside the Brand wrapper in the DOM: spread it on the portaled element. */
export function useBrandProps(): BrandProps {
  return propsFor(useContext(BrandContext));
}

/** The nearest <Brand>'s preset and custom button variables, for APIs that take a colour string (a payment SDK's style options). */
export function useBrand(): BrandValue {
  return useContext(BrandContext);
}
