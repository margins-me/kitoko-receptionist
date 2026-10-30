// The pro app's screens, shared by the dashboard (thin wrappers keep its hooks and actions) and the landing
// (server components, sample data). Same rules as <ProPage>: display-ready props, words passed in, no framework,
// no hooks and no `desk:` classes (on the landing they would switch on inside a scaled phone).

export { ProTabBar } from "./tab-bar";
export type { ProTab, ProTabBarProps } from "./tab-bar";
export { BlockRow, BookingRow, CancellationCard, DayList, GapRow, OfferLine, TodayHeader } from "./today";
export type { OfferLineProps } from "./today";
export { clockTime, entryPosition, entrySize, hourMarks, isOneLine, overlapColumns, place } from "./geometry";
export type { HourRange } from "./geometry";
export { HourLines, TimelineView } from "./timeline";
export type { TimelineEntry, TimelineLook } from "./timeline";
export { AgendaWeekView } from "./week";
export type { AgendaWeekViewProps, WeekAction, WeekDay, WeekKpi } from "./week";
export { CollectFields } from "./collect";
export type { CollectFieldsProps, CollectMethod } from "./collect";
