// Class names shared by <ProPage> and the app's islands slotted into it (bar, bag, slot chips), so they match.
// Role tokens only: the page's data-theme restyles their colours and data-style their shapes. No tailwind-merge here: the public page stays small.

/** Primary action on the page (Réserver): the theme's accent. */
export const accentButton =
  "inline-flex min-h-[54px] shrink-0 items-center justify-center rounded-pp-button bg-accent px-[26px] text-base font-semibold text-on-accent no-underline";

/**
 * The header's bag and share buttons, one 44 px pill so they read as one control: on a photo (white 94 %, ink) or on
 * the page (bordered). Its buttons are bare (toolbarButton), split by a short rule. `compact`: 36 px, inside the
 * 44 px name bar, where a full-height pill would touch its edges.
 */
export const toolbar = (onPhoto: boolean, compact = false): string =>
  `inline-flex ${compact ? "h-9" : "h-11"} shrink-0 items-center rounded-pp-button ` +
  (onPhoto ? "bg-surface/94 text-ink shadow-float" : "border-(length:--pp-rule) border-(--pp-rule-color) bg-page text-page-fg");

/** A button inside the toolbar: at least 44 px wide, wider when it carries a count. */
export const toolbarButton = "relative inline-flex h-full min-w-11 items-center justify-center gap-1.5 rounded-pp-button px-3";

/** The rule between two toolbar buttons. */
export const toolbarRule = "h-5 w-px shrink-0 bg-current opacity-15";

/** A free slot in the desktop "Prochains créneaux" card. */
export const slotChip =
  "inline-flex min-h-11 items-center justify-center rounded-pp-chip border-(length:--pp-rule) border-(--pp-rule-color) px-3 text-ui text-page-fg no-underline tabular-nums";

/** Left side of the mobile booking bar: "Prochain créneau" over the date. */
export const barLabel = "text-caption text-page-muted";
export const barValue = "truncate text-base leading-tight font-semibold";

/** A loading placeholder line in the page's colours. */
export const placeholder = "inline-block animate-pulse rounded bg-page-chip align-middle";
