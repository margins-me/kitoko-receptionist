-- The demo week fits each pro's opening hours. 20261027000600 pushed bookings out of next Saturday morning and placed
-- them back to back, so some ended after closing (a Saturday Fulani 15:30-20:00 after a 17:00 close, the Wednesday
-- cascade until about 22:35). This replaces the generator; the demo rows (private.demo_bookings) are unchanged.
--
-- How private.build_demo_week(pro, today) places each demo row (reset_demo calls it with today in her time zone):
--
-- 1. Opening hours. A booking starts at its row's time if it fits that day's hours (open to close, outside breaks)
--    and nothing of the same staff member is there; otherwise at the day's first start (every stepMinutes from
--    opening) that fits. When nothing fits that day, the next open day is tried (the previous one for a row in the
--    past), up to 14 days. A closed day never gets a booking.
-- 2. Next Saturday morning stays free for knotless. Next Saturday is the first Saturday after today (today + 1 to
--    today + 7). For a pro with an active "Knotless braids" service and a Saturday opening, [opening, opening + the
--    knotless duration with default options, rounded up to 30 min) is taken for the staff who do knotless before
--    anything is placed: Aïcha 09:00-15:30 (375 min), Anta 10:00-14:00 (240 min).
-- 3. The sick-day cascade. Rows whose key starts with "cascade-" (Aïcha's 3 confirmed, paid bookings with a web
--    conversation) all go on one day: today + their day offset (3), or, when the 3 do not fit that day around rule 2,
--    the next open day where they do (in practice: today + 3 is next Saturday, i.e. today is a Wednesday, so the
--    cascade is on Sunday, today + 4). They are placed before every other row, and no other row (cancelled ones
--    included) goes on the cascade day, so blocking that day displaces exactly 3 bookings.
-- 4. Cancelled rows never take time (they are not live) but still sit inside opening hours.
--
-- Rows are placed in (day offset, start time, key) order after the cascade, so the demo is deterministic for a date.

-- Minutes since midnight of a "HH:MM" local time.
create function private.demo_minutes(p_time text) returns integer
language sql
immutable
set search_path = ''
as $$
  select split_part(p_time, ':', 1)::integer * 60 + split_part(p_time, ':', 2)::integer
$$;

-- The first start on p_day for p_minutes that fits the day's hours and breaks and overlaps no taken range of p_staff:
-- p_preferred first, then every stepMinutes from opening. Null when nothing fits (or the day is closed).
create function private.demo_fit(
  p_schedule jsonb,
  p_tz text,
  p_day date,
  p_minutes integer,
  p_preferred time,
  p_staff uuid,
  p_taken_staff uuid[],
  p_taken tstzrange[]
)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_hours jsonb := p_schedule -> 'weekly' -> ((array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from p_day)::integer]);
  v_step integer := greatest(coalesce((p_schedule ->> 'stepMinutes')::integer, 30), 5);
  v_open integer;
  v_close integer;
  v_m integer;
  v_start timestamptz;
  v_range tstzrange;
begin
  if jsonb_typeof(v_hours) is distinct from 'object' then
    return null;
  end if;
  v_open := private.demo_minutes(v_hours ->> 'open');
  v_close := private.demo_minutes(v_hours ->> 'close');

  for v_m in
    select c.m
      from (
        select extract(hour from p_preferred)::integer * 60 + extract(minute from p_preferred)::integer as m, 0 as ord
        union all
        select v_open + g * v_step, 1 from generate_series(0, (v_close - v_open) / v_step) as g
      ) c
     order by c.ord, c.m
  loop
    continue when v_m < v_open or v_m + p_minutes > v_close;
    continue when exists (
      select 1
        from jsonb_array_elements(coalesce(v_hours -> 'breaks', '[]'::jsonb)) as b(brk)
       where v_m < private.demo_minutes(b.brk ->> 'to') and v_m + p_minutes > private.demo_minutes(b.brk ->> 'from')
    );
    v_start := (p_day + make_interval(mins => v_m)) at time zone p_tz;
    v_range := tstzrange(v_start, v_start + make_interval(mins => p_minutes), '[)');
    continue when exists (
      select 1 from unnest(p_taken_staff, p_taken) as t(staff_id, during) where t.staff_id = p_staff and t.during && v_range
    );
    return v_start;
  end loop;
  return null;
end;
$$;

-- Wipes the pro's activity and rebuilds her demo week for p_today (her local date). See the rules at the top.
create function private.build_demo_week(p_pro_id uuid, p_today date) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_pro public.pros;
  v_saturday date;
  v_sat_open time;
  v_knotless uuid;
  v_knotless_minutes integer;
  v_window_end interval;
  -- live time already placed, per staff member (parallel arrays)
  v_taken_staff uuid[] := '{}';
  v_taken tstzrange[] := '{}';
  -- the cascade: its day and each row's start (key -> timestamptz)
  v_cascade_day date;
  v_cascade_starts jsonb := '{}';
  v_try_staff uuid[];
  v_try tstzrange[];
  v_try_starts jsonb;
  v_fits boolean;
  v_day date;
  v_step integer;
  v_tries integer;
  r private.demo_bookings;
  v_quote record;
  v_rule jsonb;
  v_deposit integer;
  v_fee integer;
  v_start timestamptz;
  v_locale text;
  v_client uuid;
  v_conversation uuid;
  v_booking uuid;
  v_ref text;
  v_payment uuid;
begin
  select * into v_pro from public.pros where id = p_pro_id;
  if not found then
    raise exception 'pro_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_pro_id::text, 0));

  delete from public.pending_actions where pro_id = p_pro_id;
  delete from public.agent_events where pro_id = p_pro_id;
  -- cascades to payments, refunds and payouts
  delete from public.bookings where pro_id = p_pro_id;
  -- cascades to conversation_messages
  delete from public.conversations where pro_id = p_pro_id;
  delete from public.blocks where pro_id = p_pro_id;
  delete from public.clients where pro_id = p_pro_id;

  -- Rule 2: next Saturday morning (isodow 6 = Saturday; 1 to 7 days ahead)
  v_saturday := p_today + ((5 - extract(isodow from p_today)::integer + 7) % 7) + 1;
  v_sat_open := (v_pro.schedule -> 'weekly' -> 'sat' ->> 'open')::time;
  select s.id, q.minutes into v_knotless, v_knotless_minutes
    from public.services s
    cross join lateral private.demo_quote(s.id, '{}'::jsonb, '{}'::text[]) q
   where s.pro_id = p_pro_id and s.active and s.name = 'Knotless braids'
   order by s.position
   limit 1;
  if v_sat_open is not null and v_knotless is not null then
    v_window_end := make_interval(
      mins => (ceil((extract(epoch from v_sat_open) / 60 + v_knotless_minutes) / 30.0) * 30)::integer
    );
    select v_taken_staff || array_agg(ss.staff_id),
           v_taken || array_agg(tstzrange((v_saturday + v_sat_open) at time zone v_pro.timezone,
                                          (v_saturday + v_window_end) at time zone v_pro.timezone, '[)'))
      into v_taken_staff, v_taken
      from public.service_staff ss
     where ss.service_id = v_knotless;
  end if;

  -- Rule 3: the cascade day, the first day from today + its offset where all its rows fit
  select private.demo_day(v_pro.schedule, p_today, min(day_offset)) into v_day
    from private.demo_bookings
   where pro_id = p_pro_id and key like 'cascade-%';
  v_tries := 0;
  while v_day is not null and v_cascade_day is null and v_tries < 14 loop
    v_try_staff := v_taken_staff;
    v_try := v_taken;
    v_try_starts := '{}';
    v_fits := true;
    for r in
      select * from private.demo_bookings where pro_id = p_pro_id and key like 'cascade-%' order by start_time, key
    loop
      select * into v_quote from private.demo_quote(r.service_id, r.options, r.addons);
      v_start := private.demo_fit(v_pro.schedule, v_pro.timezone, v_day, v_quote.minutes, r.start_time, r.staff_id, v_try_staff, v_try);
      if v_start is null then
        v_fits := false;
        exit;
      end if;
      v_try_staff := v_try_staff || r.staff_id;
      v_try := v_try || tstzrange(v_start, v_start + make_interval(mins => v_quote.minutes), '[)');
      v_try_starts := v_try_starts || jsonb_build_object(r.key, v_start);
    end loop;
    if v_fits then
      v_cascade_day := v_day;
      v_taken_staff := v_try_staff;
      v_taken := v_try;
      v_cascade_starts := v_try_starts;
    else
      v_day := v_day + 1;
      v_tries := v_tries + 1;
    end if;
  end loop;

  for r in
    select * from private.demo_bookings where pro_id = p_pro_id order by day_offset, start_time, key
  loop
    select * into v_quote from private.demo_quote(r.service_id, r.options, r.addons);
    v_rule := coalesce((select deposit from public.services where id = r.service_id), v_pro.rules -> 'deposit');
    v_deposit := private.deposit_due(v_quote.price_cents, v_rule);
    v_fee := private.booking_fee(v_deposit);
    v_locale := coalesce(r.locale, v_pro.locale);

    if v_cascade_starts ? r.key then
      v_start := (v_cascade_starts ->> r.key)::timestamptz;
    else
      -- Rules 1 and 4: its day (closed days move to the next open one, the previous one in the past), else the next
      -- (or previous) day where it fits; never the cascade day
      v_day := private.demo_day(v_pro.schedule, p_today, r.day_offset);
      v_step := case when r.day_offset < 0 then -1 else 1 end;
      v_start := null;
      v_tries := 0;
      while v_start is null and v_tries < 14 loop
        if v_day is distinct from v_cascade_day then
          v_start := private.demo_fit(
            v_pro.schedule, v_pro.timezone, v_day, v_quote.minutes, r.start_time, r.staff_id,
            case when r.status = 'cancelled' then '{}'::uuid[] else v_taken_staff end,
            case when r.status = 'cancelled' then '{}'::tstzrange[] else v_taken end
          );
        end if;
        if v_start is null then
          v_day := v_day + v_step;
          v_tries := v_tries + 1;
        end if;
      end loop;
      if v_start is null then
        raise exception 'demo row % of pro % fits nowhere', r.key, p_pro_id using errcode = 'P0001';
      end if;
      if r.status <> 'cancelled' then
        v_taken_staff := v_taken_staff || r.staff_id;
        v_taken := v_taken || tstzrange(v_start, v_start + make_interval(mins => v_quote.minutes), '[)');
      end if;
    end if;

    v_client := null;
    if r.client_first_name is not null then
      v_client := private.upsert_client(p_pro_id, r.client_phone, r.client_first_name, r.client_email, v_locale);
      update public.clients set notes = 'Fictional demo client' where id = v_client and notes is null;
    end if;

    v_conversation := null;
    if r.conversation_token is not null then
      insert into public.conversations (pro_id, kind, channel, external_id, client_id, locale, token, created_at)
      values (p_pro_id, 'client', 'web', r.conversation_token, v_client, v_locale, r.conversation_token, now() - interval '3 days')
      returning id into v_conversation;
    end if;

    insert into public.bookings (
      pro_id, staff_id, client_id, service_id, conversation_id, status, during, hold_expires_at, source,
      selection, policy, price_cents, deposit_cents, fee_cents, currency, locale,
      cancelled_at, cancelled_by, cancel_reason, created_at
    )
    values (
      p_pro_id, r.staff_id, v_client, r.service_id, v_conversation, r.status,
      tstzrange(v_start, v_start + make_interval(mins => v_quote.minutes), '[)'),
      case when r.status = 'held' then now() + interval '10 minutes' end,
      r.source,
      jsonb_build_object(
        'selection', jsonb_build_object('options', r.options, 'addons', to_jsonb(r.addons), 'conditionsAccepted', true),
        'lines', v_quote.lines
      ),
      v_pro.rules, v_quote.price_cents, v_deposit, v_fee, v_pro.currency, v_locale,
      case when r.status = 'cancelled' then now() - interval '1 day' end,
      case when r.status = 'cancelled' then 'client' end,
      case when r.status = 'cancelled' then 'client_cancel' end,
      case when r.status = 'held' then now() - interval '5 minutes' else now() - interval '3 days' end
    )
    returning id, ref into v_booking, v_ref;

    if r.paid and r.status <> 'held' and v_deposit + v_fee > 0 then
      insert into public.payments (
        pro_id, booking_id, kind, paypal_order_id, capture_id, deposit_cents, fee_cents, amount_cents, currency,
        refunded_cents, status, payer, captured_at, created_at
      )
      values (
        p_pro_id, v_booking, 'deposit', 'SEED-ORDER-' || v_ref, 'SEED-' || v_ref, v_deposit, v_fee, v_deposit + v_fee,
        v_pro.currency, case when r.status = 'cancelled' then v_deposit else 0 end, 'captured',
        jsonb_build_object('name', jsonb_build_object('given_name', r.client_first_name)),
        now() - interval '3 days', now() - interval '3 days'
      )
      returning id into v_payment;

      if r.status = 'cancelled' and v_deposit > 0 then
        insert into public.refunds (pro_id, payment_id, booking_id, amount_cents, currency, reason, status, paypal_refund_id, created_at)
        values (p_pro_id, v_payment, v_booking, v_deposit, v_pro.currency, 'client_cancel', 'succeeded',
                'SEED-REFUND-' || v_ref, now() - interval '1 day');
      elsif r.status in ('honoured', 'no_show') and v_deposit > 0 then
        insert into public.payouts (pro_id, booking_id, amount_cents, fee_cents, currency, reason)
        values (p_pro_id, v_booking, v_deposit, v_fee, v_pro.currency, r.status);
      end if;
    end if;

    if v_conversation is not null and r.chat is not null then
      insert into public.conversation_messages (conversation_id, role, content, created_at)
      select v_conversation,
             m.msg ->> 'role',
             jsonb_build_array(jsonb_build_object('type', 'text', 'text',
               replace(replace(replace(replace(m.msg ->> 'text',
                 '{name}', coalesce(r.client_first_name, '')),
                 '{date}', to_char(v_start at time zone v_pro.timezone, 'DD/MM')),
                 '{time}', to_char(v_start at time zone v_pro.timezone, 'HH24:MI')),
                 '{ref}', v_ref))),
             now() - interval '3 days' + m.ord * interval '1 minute'
        from jsonb_array_elements(r.chat) with ordinality as m(msg, ord);
    end if;
  end loop;
end;
$$;

-- The demo button: the service role or the pro herself. Rebuilds her week relative to today in her time zone.
create or replace function public.reset_demo(p_pro_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
begin
  if not (private.is_trusted() or p_pro_id is not distinct from (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select timezone into v_tz from public.pros where id = p_pro_id;
  if not found then
    raise exception 'pro_not_found' using errcode = 'P0002';
  end if;
  perform private.build_demo_week(p_pro_id, (now() at time zone v_tz)::date);
end;
$$;

revoke all on function private.demo_minutes(text), private.demo_fit(jsonb, text, date, integer, time, uuid, uuid[], tstzrange[]),
  private.build_demo_week(uuid, date) from public, anon, authenticated;
revoke all on function public.reset_demo(uuid) from public, anon;
grant execute on function public.reset_demo(uuid) to authenticated, service_role;
