import type { ReactNode } from "react";
import { cn } from "./cn";

// The iPhone 18 Pro bezel from Apple Design Resources, at half size: 675 × 1380, its screen a 603 × 1311 hole
// 36 px in from the sides and 34.5 px from the top and bottom. Each app serves it at /iphone-bezel.webp.
const SCREEN_WIDTH = 603;
const SIDE = 36;
const TOP = 34.5;
// The 9-slice cut: the screen's rounded corners and the Dynamic Island fit in the corner and top slices.
const SLICE = 140;
const SCREEN_RADIUS = 100;
// How far the screen's black backing reaches under the bezel, which stays opaque ~20 px in from the hole.
const BLEED = 8;

/**
 * A screen of `width` × `height` px (or a height from `className`) inside the iPhone bezel, which adds its frame around it (margin, so it takes
 * room in layout). The bezel is a border-image over the screen: any screen ratio works, the straight edges stretch.
 */
export function Iphone({ width, height, className, children }: { width: number; height?: number; className?: string; children: ReactNode }) {
  const k = width / SCREEN_WIDTH;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width, height, margin: `${TOP * k}px ${SIDE * k}px` }}>
      {/* The black ring runs under the bezel: the hole is a squircle, not a circle, and the two anti-aliased edges
          meet on the same pixel, so without it the page behind shows as a hairline and as wedges in the corners. */}
      <div className="size-full overflow-hidden" style={{ borderRadius: SCREEN_RADIUS * k, boxShadow: `0 0 0 ${BLEED * k}px #000` }}>
        {children}
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          inset: `${-TOP * k}px ${-SIDE * k}px`,
          borderStyle: "solid",
          borderWidth: SLICE * k,
          borderImage: `url(/iphone-bezel.webp) ${SLICE}`,
        }}
      />
    </div>
  );
}
