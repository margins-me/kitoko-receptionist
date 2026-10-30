import { cn } from "./cn";

// AppIcon artwork stays fixed hex: it is an icon, not themed UI. The wordmark uses tokens.
const HONEY = "#C98A3B";
const WORDMARK_CY = [29.4, 88.2, 147.1, 205.9, 264.7, 323.5, 382.3, 441.2, 500.0, 558.8];
const ICON_CY = [42.7, 128.2, 213.7, 299.1, 384.6, 470.1];

/** The Kitoko wordmark. Needs the Archivo variable (--font-archivo) on an ancestor; size it with font-size. */
export function Logo({ onDark = false, className }: { onDark?: boolean; className?: string }) {
  // The gap between braid strands is drawn in the colour behind the logo.
  const gap = onDark ? "stroke-inverse" : "stroke-surface";
  return (
    <span
      role="img"
      aria-label="Kitoko"
      className={cn(
        "inline-block font-display font-semibold font-stretch-62% tracking-[0.02em] whitespace-nowrap",
        onDark ? "text-on-inverse" : "text-ink",
        className,
        // Last: tailwind-merge drops a line-height that comes before a font size (the className sizes the logo).
        "leading-none",
      )}
    >
      K
      <svg viewBox="0 0 200 690" aria-hidden className="mr-[0.02em] inline h-[0.687em] w-[0.2em] overflow-visible align-baseline">
        <g fill="currentColor" strokeWidth={12} className={gap}>
          {WORDMARK_CY.map((cy, i) => {
            const cx = i % 2 ? 115.8 : 84.2;
            return <ellipse key={cy} cx={cx} cy={cy} rx={35.7} ry={60.9} transform={`rotate(${i % 2 ? -32 : 32} ${cx} ${cy})`} />;
          })}
        </g>
        <circle cx={100} cy={629.1} r={60.9} strokeWidth={12} className={cn("fill-honey", gap)} />
      </svg>
      TOKO
    </span>
  );
}

/** Square app icon: black tile, white braid, honey bead. */
export function AppIcon({ size = 48, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label="Kitoko" className={className}>
      <rect width={100} height={100} rx={23} fill="#000000" />
      <svg x={40.35} y={15} width={19.3} height={70} viewBox="-4 -52 208 754" overflow="visible">
        <g fill="#FFFFFF" stroke="#000000" strokeWidth={12}>
          {ICON_CY.map((cy, i) => {
            const cx = i % 2 ? 125.5 : 74.5;
            return <ellipse key={cy} cx={cx} cy={cy} rx={57.8} ry={98.6} transform={`rotate(${i % 2 ? -32 : 32} ${cx} ${cy})`} />;
          })}
        </g>
        <circle cx={100} cy={591.4} r={98.6} fill={HONEY} stroke="#000000" strokeWidth={12} />
      </svg>
    </svg>
  );
}
