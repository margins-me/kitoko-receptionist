# How we use Bryntum

The pro's dashboard is one Bryntum Scheduler (7.3, `@bryntum/scheduler` + `@bryntum/scheduler-react`) with a Bryntum
Grid under it. The calendar is where the receptionist's work becomes visible: a sick day displaces bookings, the agent
writes to each client with real free times, and the schedule rearranges itself as the clients answer. Nothing in the
calendar moves a booking on its own: every change goes through the same services as the agents
(`@kitoko/agent/services`), and the calendar redraws from the database through Supabase Realtime.

Code: `apps/web/src/components/dashboard/` (`calendar.tsx` for Bryntum, `calendar-layout.ts` for the plain data it
draws, `cascade-grid.tsx` for the Grid, `calendar.css` for the theme).

## Screenshots

Taken on the local stack as Aïcha Braids (Milan, EUR), 1440×900 viewport (stored downscaled to 800×500). Not in the
repo yet: copy them to `docs/img/` before linking them from the README or Devpost.

| | |
|---|---|
| Mid-cascade: Friday blocked, three bookings waiting, the receptionist's offers as dashed ghosts with dependency lines, the "Waiting for client" grid | `bryntum-mid-cascade.jpg` |
| Dragging a row from the grid onto a highlighted start (green: it snaps to 13:00, the tooltip says what the drop does) | `bryntum-drag-from-grid.jpg` |
| After: one client picked a time (✦, solid), one took the refund (✦, struck through), one still has the pro's proposal pending | `bryntum-after.jpg` |
| Money columns in the locked grid with the week's totals in the Summary footer, and the ✦ tooltip | `bryntum-money-columns.jpg` |

## Scheduler with virtual day and staff resources

The Week view is not a time axis of seven days. Every row shares one 08:00–21:00 axis, and the rows are **virtual
resources** `${yyyy-mm-dd}|${staffId}`: seven day rows for a solo pro, day × staff rows for a studio (Studio Nala, with
`mergeCells` on the day column). A booking is placed on the axis's reference day at its local time and in the row of its
real day; a drop is read back from the row it lands in (`toAxis` / `fromAxis`). A booking reads left to right at its time
of day whatever the view, and the Day view is the same Scheduler with one row per staff member.

## eventRenderer and deposit states

`eventRenderer` adds one class per deposit situation (`kt-ev-held` striped honey with a live countdown, `confirmed`
solid ink, `unpaid` outlined, `displaced` dashed red, `cancelled` struck through with the refund, `balance_due` honey
outline, `done`, `no_show`), the same states as the phone agenda and the attention list (`lookOf` in `model.ts`). The
bar is always horizontal; container queries on the bar drop parts as it narrows. A booking the receptionist changed on
the client's answer carries a ✦ badge, and its tooltip says so: "Moved by your receptionist · client said yes · 10:42"
(from her `reschedule_booking` / `cancel_booking` tool calls in `agent_events`).

## timeRanges, resourceTimeRanges, validatorFn and snapping

Everything behind the bookings is a resource time range: closed hours, breaks, blocked time (hatched, labelled), the
"now" line, "Free all day", and at rest a small honey tick at each bookable start. On drag start the calendar asks the
server for the booking's valid new starts (`moveTargets`: same service, length, staff and rules, free) and draws one
honey drop zone per start. `eventDrag.validatorFn` snaps the pointer to the zone it is in, or the nearest start within
45 minutes; the bar turns green or red and the tooltip names the start ("Drop to ask the client") or says "Pick a
highlighted time". The drop itself is always declined (`context.valid = false` in `beforeEventDropFinalize`): a ghost
shows the proposal and the receptionist asks the client (`proposeMove`). Her "yes" moves the booking.

## Grid + drag-from-grid for the cascade

When a block displaces bookings, they appear in a Bryntum **Grid** under the Scheduler ("Waiting for client": client,
service, original time, the times the receptionist offered, status, language), styled with the same tokens. A row leaves
the grid, animated (`animateRemovingRows`), as soon as the client picks a time or the refund.

The pro can drag a row onto the Scheduler, following Bryntum's
[drag-from-grid example](https://bryntum.com/products/scheduler/examples/dragfromgrid/): a `DragHelper` on the grid's
rows (`cloneTarget`, `translateXY`, `dropTargetSelector: '.b-timeline-sub-grid'`, the Scheduler's `scrollManager`), a
proxy shaped like the booking and sized with `timeAxisViewModel.getDistanceForDuration`, the start read with
`getDateFromCoordinate` and the row with `resolveResourceRecord`. It reuses the calendar drag's drop zones, snapping,
green/red validation and tooltip; a valid drop calls `proposeMove` for that booking, an invalid one is refused with "Pick
a highlighted time".

## Dependencies for the agent's offered times

For each displaced booking, the times the receptionist offered its client (stored by `blockTime` → `notifyConversation`
in the `event.booking_displaced` agent event) are drawn as dashed honey ghost events, and the **Dependencies** feature
links each one to the displaced booking (read-only: `allowCreate: false`, `enableDelete: false`; animated dashes). A
pending move proposal gets the same line. When the client picks one, the booking slides to that slot (same record, so
Bryntum animates it), the chosen ghost is replaced by the real booking, and the other ghosts and their lines fade out
before they leave the stores.

## Locked-grid money columns

The Week view's locked grid has three money columns per row: deposits captured, refunded, paid out, by appointment day
(the same payment, refund and payout rows as the Money tab, `bookingMoneyCents`). The Scheduler **Summary** feature puts
the week's totals in the footer under them (`sum: 'sum'` with a `summaryRenderer` per column; the time axis part stays
empty). The Day view keeps its staff rows and shows the day's three figures in the header line above the Scheduler.

## Realtime-driven store updates with highlight

The dashboard subscribes to Supabase Realtime (`bookings`, `blocks`, `payments`, `payouts`, `pending_actions`,
`conversation_messages`, `agent_events`, filtered to the pro). Any change refetches the week through a server action,
and the stores are synced in place (`syncStore`: remove what left, `set()` what changed, add what is new), never
replaced. Bryntum therefore animates what moved, and a changed booking gets a short honey pulse (`kt-flash`) with a
toast in plain words ("Giulia moved to Sat 31 Oct 09:00"). Only a change of rows or axis (week, day, zoom) replaces the
stores.

## Licence

The repo uses the public trial package (`@bryntum/scheduler-trial`, aliased to `@bryntum/scheduler`): the calendar shows
Bryntum's trial watermark.
