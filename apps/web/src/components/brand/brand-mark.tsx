import { Logo } from "@kitoko/ui";
import { archivo } from "@/fonts/archivo";

/** The app's wordmark with "AI front desk" beside it, as on the gallery images. Links home. */
export function BrandMark({ href = "/", size = "md" }: { href?: string; size?: "md" | "lg" }) {
  return (
    <a href={href} aria-label="Kitoko, home" className={`${archivo.variable} inline-flex shrink-0 flex-col items-start gap-1 text-ink no-underline sm:flex-row sm:items-baseline sm:gap-2.5`}>
      <Logo className={size === "lg" ? "text-[30px] sm:text-[36px]" : "text-[26px]"} />
      <span className="text-[10px] font-bold whitespace-nowrap sm:text-[11px] tracking-[0.22em] text-honey uppercase">AI front desk</span>
    </a>
  );
}
