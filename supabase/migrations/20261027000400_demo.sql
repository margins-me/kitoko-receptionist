-- The demo week: supabase/seed.sql describes each demo pro's bookings in private.demo_bookings (days relative to
-- today); reset_demo(pro) wipes her activity and rebuilds that week, so the demo is always "this week".
-- Everything in it is fictional.

create table private.demo_bookings (
  pro_id uuid not null references public.pros (id) on delete cascade,
  key text not null,
  -- days from today in her time zone; a closed day moves to the next open one (the previous one when in the past)
  day_offset integer not null,
  start_time time not null,
  service_id uuid not null,
  staff_id uuid not null,
  -- option group id -> option id (the group's default when missing), and add-on ids
  options jsonb not null default '{}' check (jsonb_typeof(options) = 'object'),
  addons text[] not null default '{}',
  -- held: a live 10-minute hold, no client; cancelled: by the client in the free window, deposit refunded;
  -- honoured / no_show: payout pending
  status text not null check (status in ('held', 'confirmed', 'honoured', 'no_show', 'cancelled')),
  -- a captured deposit (SEED- capture id)
  paid boolean not null default true,
  source text not null default 'web' check (source in ('web', 'whatsapp', 'mcp', 'manual')),
  client_first_name text,
  client_phone text,
  client_email text,
  locale text,
  -- a web conversation with this token, linked to the booking
  conversation_token text,
  -- its opening messages: [{"role": "user"|"assistant", "text": "..."}] with {name} {date} {time} {ref}
  chat jsonb check (jsonb_typeof(chat) = 'array'),
  primary key (pro_id, key),
  check (status = 'held' or client_first_name is not null)
);

-- depositDue in @kitoko/booking
create function private.deposit_due(p_price_cents integer, p_rule jsonb) returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_rule ->> 'mode'
    when 'fixed' then least((p_rule ->> 'cents')::integer, p_price_cents)
    when 'percent' then floor((p_price_cents * (p_rule ->> 'percent')::integer + 50) / 100.0)::integer
    when 'full' then p_price_cents
    else 0
  end
$$;

-- bookingFee in @kitoko/booking
create function private.booking_fee(p_online_cents integer) returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_online_cents <= 0 then 0
    when p_online_cents <= 5000 then 150
    when p_online_cents <= 10000 then 250
    when p_online_cents <= 20000 then 390
    else 550
  end
$$;

-- quote in @kitoko/booking: base line, one line per option group (chosen or default), add-on lines.
create function private.demo_quote(p_service_id uuid, p_options jsonb, p_addons text[])
returns table (price_cents integer, minutes integer, lines jsonb)
language sql
stable
set search_path = ''
as $$
  with s as (
    select * from public.services where id = p_service_id
  ),
  l as (
    select 0::bigint as ord,
           jsonb_build_object('kind', 'base', 'id', s.id, 'label', jsonb_build_object('fr', s.name),
                              'priceCents', s.base_price_cents, 'minutes', s.base_minutes) as line
      from s
    union all
    select g.ord,
           jsonb_build_object('kind', 'option', 'id', (g.grp ->> 'id') || ':' || (o.opt ->> 'id'), 'label', o.opt -> 'label',
                              'group', g.grp -> 'label', 'priceCents', (o.opt ->> 'priceCents')::integer,
                              'minutes', (o.opt ->> 'minutes')::integer)
      from s
      cross join lateral jsonb_array_elements(s.option_groups) with ordinality as g(grp, ord)
      cross join lateral jsonb_array_elements(g.grp -> 'options') as o(opt)
     where o.opt ->> 'id' = coalesce(p_options ->> (g.grp ->> 'id'), g.grp ->> 'default')
    union all
    select 1000 + a.ord,
           jsonb_build_object('kind', 'addon', 'id', a.ad ->> 'id', 'label', a.ad -> 'label',
                              'priceCents', (a.ad ->> 'priceCents')::integer, 'minutes', (a.ad ->> 'minutes')::integer)
      from s
      cross join lateral jsonb_array_elements(s.addons) with ordinality as a(ad, ord)
     where a.ad ->> 'id' = any (p_addons)
  )
  select sum((line ->> 'priceCents')::integer)::integer,
         sum((line ->> 'minutes')::integer)::integer,
         jsonb_agg(line order by ord)
    from l
$$;

-- today + p_offset, moved off closed days (schedule.weekly.<day> null)
create function private.demo_day(p_schedule jsonb, p_today date, p_offset integer) returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day date := p_today + p_offset;
  v_step integer := case when p_offset < 0 then -1 else 1 end;
begin
  for i in 1..7 loop
    exit when jsonb_typeof(
      p_schedule -> 'weekly' -> ((array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from v_day)::integer])
    ) = 'object';
    v_day := v_day + v_step;
  end loop;
  return v_day;
end;
$$;

-- The demo button: deletes the pro's bookings, payments, refunds, payouts, blocks, clients, conversations, agent
-- events and pending actions, then rebuilds her week from private.demo_bookings relative to today in her time zone.
-- The service role or the pro herself.
create function public.reset_demo(p_pro_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro public.pros;
  v_today date;
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

  for r in
    select * from private.demo_bookings where pro_id = p_pro_id order by day_offset, start_time, key
  loop
    select * into v_quote from private.demo_quote(r.service_id, r.options, r.addons);
    v_rule := coalesce((select deposit from public.services where id = r.service_id), v_pro.rules -> 'deposit');
    v_deposit := private.deposit_due(v_quote.price_cents, v_rule);
    v_fee := private.booking_fee(v_deposit);
    v_start := (private.demo_day(v_pro.schedule, v_today, r.day_offset) + r.start_time) at time zone v_pro.timezone;
    v_locale := coalesce(r.locale, v_pro.locale);

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

revoke all on private.demo_bookings from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_live(uuid) to anon, authenticated, service_role;
grant execute on function public.busy_intervals(uuid, uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.mark_honoured(uuid), public.mark_no_show(uuid) to authenticated, service_role;
grant execute on function public.decide_pending_action(uuid, text) to authenticated, service_role;
grant execute on function public.reset_demo(uuid) to authenticated, service_role;
