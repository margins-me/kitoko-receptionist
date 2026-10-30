import type { ReactNode } from "react";
import { cn } from "./cn";

// A screen drawn at its true width and scaled down into a fixed box: 390 px for a phone, 1280 px for a computer,
// so container queries draw the layout of that screen. The dashboard's page preview, the landing's browser frame.

export type PreviewDevice = "phone" | "desktop";

export const FRAMES: Record<PreviewDevice, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

/** A frame of `device`'s size scaled by `scale`, its content drawn at full size. */
export function PreviewFrame({ device, scale, className, children }: { device: PreviewDevice; scale: number; className?: string; children: ReactNode }) {
  const { width, height } = FRAMES[device];
  return (
    <div className={cn("relative shrink-0 overflow-hidden", className)} style={{ width: width * scale, height: height * scale }}>
      <div className="absolute top-0 left-0 origin-top-left" style={{ width, height, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
