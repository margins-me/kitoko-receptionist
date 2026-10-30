-- A second Milan braider (Anta Tresses, supabase/seed.sql) makes "knotless braids in Milan this Saturday morning"
-- a real choice between two pros. This redefines reset_demo so that choice always exists:
--
-- 1. Next Saturday stays free in the morning. Next Saturday is the first Saturday after today in the pro's time zone
--    (today + 1 to today + 7). For a pro with an active "Knotless braids" service and a Saturday opening, the demo
--    keeps [Saturday opening, opening + the knotless duration with default options), rounded up to 30 minutes, free
--    for the staff who do knotless: Aïcha 09:00 to 15:30 (375 min from 09:00 ends 15:15), Anta 10:00 to 14:00
--    (240 min; she opens at 10:00, so her earliest morning start is 10:00). A demo booking of that staff starting
--    inside the window starts at its end instead.
-- 2. Demo bookings never overlap: a booking that would overlap one already placed for the same staff member starts
--    when that one ends. So the bookings pushed out of the Saturday morning run back to back in the afternoon.
-- 3. The sick-day cascade day stays today + 3 with its 3 confirmed, paid bookings. When today + 3 is that Saturday
--    (today is a Wednesday), the 3 cascade bookings move to the afternoon by rules 1 and 2 (from 15:30, back to back,
--    so they end after Aïcha's 17:00 Saturday closing: the demo accepts that once a week to keep both promises).
--
-- Everything else is unchanged from 20261027000400_demo.sql.

create or replace function public.reset_demo(p_pro_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro public.pros;
  v_today date;
  v_saturday date;
  v_sat_open time;
  v_knotless uuid;
  v_knotless_minutes integer;
  v_window_end interval;
  v_day date;
  v_end timestamptz;
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
  if not (private.is_trusted() or p_pro_id is not distinct from (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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

  v_today := (now() at time zone v_pro.timezone)::date;

  -- Rule 1: the protected Saturday morning (isodow 6 = Saturday; 1 to 7 days ahead)
  v_saturday := v_today + ((5 - extract(isodow from v_today)::integer + 7) % 7) + 1;
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
  end if;

  for r in
    select * from private.demo_bookings where pro_id = p_pro_id order by day_offset, start_time, key
  loop
    select * into v_quote from private.demo_quote(r.service_id, r.options, r.addons);
    v_rule := coalesce((select deposit from public.services where id = r.service_id), v_pro.rules -> 'deposit');
    v_deposit := private.deposit_due(v_quote.price_cents, v_rule);
    v_fee := private.booking_fee(v_deposit);
    v_day := private.demo_day(v_pro.schedule, v_today, r.day_offset);
    v_start := (v_day + r.start_time) at time zone v_pro.timezone;
    v_locale := coalesce(r.locale, v_pro.locale);

    if r.status <> 'cancelled' then
      -- Rule 1
      if v_day = v_saturday and v_window_end is not null and r.start_time < (time '00:00' + v_window_end)
         and exists (select 1 from public.service_staff where service_id = v_knotless and staff_id = r.staff_id) then
        v_start := (v_day + v_window_end) at time zone v_pro.timezone;
      end if;
      -- Rule 2
      loop
        select max(upper(b.during)) into v_end
          from public.bookings b
         where b.staff_id = r.staff_id
           and b.status in ('held', 'confirmed', 'honoured')
           and b.during && tstzrange(v_start, v_start + make_interval(mins => v_quote.minutes), '[)');
        exit when v_end is null;
        v_start := v_end;
      end loop;
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

revoke all on function public.reset_demo(uuid) from public, anon;
grant execute on function public.reset_demo(uuid) to authenticated, service_role;
