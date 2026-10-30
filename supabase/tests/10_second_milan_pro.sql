begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- Anta Tresses, the second Milan braider
select results_eq(
  $$select handle::text, city, area_label, timezone, currency, locale, paypal_email::text from public.pros
     where id = 'a0000000-0000-4000-8000-000000000005'$$,
  $$values ('anta.tresses', 'Milan', 'Milano, NoLo', 'Europe/Rome', 'EUR', 'it', null::text)$$,
  'Anta Tresses is in Milan, without a PayPal payout e-mail'
);
select ok(public.is_live('a0000000-0000-4000-8000-000000000005'), 'her page is live');
select results_eq(
  $$select name, base_price_cents, base_minutes from public.services
     where pro_id = 'a0000000-0000-4000-8000-000000000005' and active order by position$$,
  $$values ('Knotless braids', 8000, 240), ('Cornrows', 4000, 90)$$,
  'her two services, at Kitoko''s showcase prices'
);
select is(
  (select count(*)::int from public.service_staff ss join public.staff s on s.id = ss.staff_id
    where ss.pro_id = 'a0000000-0000-4000-8000-000000000005' and s.name = 'Anta'),
  2,
  'Anta does both services'
);
select is(
  (select rules -> 'deposit' || jsonb_build_object('cancellation', rules -> 'cancellation') from public.pros
    where id = 'a0000000-0000-4000-8000-000000000005'),
  (select rules -> 'deposit' || jsonb_build_object('cancellation', rules -> 'cancellation') from public.pros
    where id = 'a0000000-0000-4000-8000-000000000003'),
  'same deposit and cancellation rules as Aïcha'
);
select ok(
  exists (select 1 from auth.users u join auth.identities i on i.user_id = u.id
           where u.id = 'a0000000-0000-4000-8000-000000000005' and u.email = 'anta@demo.kitoko.page'),
  'she can sign in to the dashboard'
);

select lives_ok($$select public.reset_demo(id) from public.pros$$, 'reset_demo runs for every pro');

-- What a demo week must respect, for any "today" (build_demo_week takes the pro's local date).
-- Every booking inside its day's opening hours (open to close, on one local day, never on a closed day).
create function pg_temp.out_of_hours() returns table (pro text, booking text, local_start text, local_end text)
language sql as $$
  select p.handle::text, b.ref::text,
         to_char(lower(b.during) at time zone p.timezone, 'Dy YYYY-MM-DD HH24:MI'),
         to_char(upper(b.during) at time zone p.timezone, 'Dy YYYY-MM-DD HH24:MI')
    from public.bookings b
    join public.pros p on p.id = b.pro_id
   cross join lateral (
     select p.schedule -> 'weekly' -> ((array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
              [extract(isodow from (lower(b.during) at time zone p.timezone))::int]) as h
   ) d
   where jsonb_typeof(d.h) is distinct from 'object'
      or (lower(b.during) at time zone p.timezone)::date <> ((upper(b.during) - interval '1 second') at time zone p.timezone)::date
      or (lower(b.during) at time zone p.timezone)::time < (d.h ->> 'open')::time
      or (upper(b.during) at time zone p.timezone)::time > (d.h ->> 'close')::time
$$;
-- No two live bookings of one staff member overlap.
create function pg_temp.double_booked() returns bigint language sql as $$
  select count(*) from public.bookings a join public.bookings b on a.staff_id = b.staff_id and a.id < b.id and a.during && b.during
   where a.status in ('held', 'confirmed', 'honoured') and b.status in ('held', 'confirmed', 'honoured')
$$;
-- Next Saturday after p_today, and the knotless windows that must stay free on it.
create temp table windows (pro_id uuid, open time, close time);
insert into windows values
  ('a0000000-0000-4000-8000-000000000003', '09:00', '15:15'),  -- 09:00 + 375 min (knotless, default options)
  ('a0000000-0000-4000-8000-000000000005', '10:00', '14:00');  -- she opens at 10:00; 240 min
create function pg_temp.saturday(p_today date) returns date language sql as $$
  select p_today + ((5 - extract(isodow from p_today)::int + 7) % 7) + 1
$$;
create function pg_temp.saturday_clashes(p_today date) returns bigint language sql as $$
  select count(*)
    from public.bookings b
    join windows w on w.pro_id = b.pro_id
   where b.status in ('held', 'confirmed', 'honoured')
     and b.during && tstzrange((pg_temp.saturday(p_today) + w.open) at time zone 'Europe/Rome',
                               (pg_temp.saturday(p_today) + w.close) at time zone 'Europe/Rome', '[)')
$$;
-- Aïcha's cascade: the day of her demo conversations' bookings, and what is on it.
create function pg_temp.cascade_day() returns date language sql as $$
  select min((lower(b.during) at time zone 'Europe/Rome')::date)
    from public.bookings b join public.conversations c on c.id = b.conversation_id
   where b.pro_id = 'a0000000-0000-4000-8000-000000000003' and c.token like 'demo-aicha-client-%'
$$;
create function pg_temp.cascade_tokens(p_day date) returns text[] language sql as $$
  select array_agg(c.token order by lower(b.during))
    from public.bookings b
    join public.conversations c on c.id = b.conversation_id
    join public.payments p on p.booking_id = b.id and p.status = 'captured'
   where b.pro_id = 'a0000000-0000-4000-8000-000000000003' and b.status = 'confirmed'
     and (lower(b.during) at time zone 'Europe/Rome')::date = p_day
$$;
create function pg_temp.on_day(p_day date) returns int language sql as $$
  select count(*)::int from public.bookings
   where pro_id = 'a0000000-0000-4000-8000-000000000003' and (lower(during) at time zone 'Europe/Rome')::date = p_day
$$;

create temp table today as select (now() at time zone 'Europe/Rome')::date as d;
select is_empty($$select * from pg_temp.out_of_hours()$$, 'today''s demo week: every booking inside opening hours');
select is(pg_temp.saturday_clashes((select d from today)), 0::bigint, 'next Saturday: Aïcha free 09:00-15:15, Anta free 10:00-14:00');
select is(
  pg_temp.cascade_tokens(pg_temp.cascade_day()),
  array['demo-aicha-client-1', 'demo-aicha-client-2', 'demo-aicha-client-3'],
  'the cascade day keeps its 3 confirmed, paid bookings'
);
select ok(
  (select count(*) from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000005' and status <> 'cancelled')
    between 2 and 4,
  'Anta has a light demo week'
);

-- Every weekday: build each pro's week as if today were today + k.
create temp table shifted (k int, today date, out_of_hours bigint, double_booked bigint, clashes bigint, cascade_day date,
                           cascade text[], on_cascade_day int, lost int, held int, refunded int, balance_due int);
do $$
declare
  k int;
  p record;
  t date;
begin
  for k in 0..6 loop
    for p in select id, timezone from public.pros loop
      perform private.build_demo_week(p.id, (now() at time zone p.timezone)::date + k);
    end loop;
    t := (select d from today) + k;
    insert into shifted
    select k, t, (select count(*) from pg_temp.out_of_hours()), pg_temp.double_booked(), pg_temp.saturday_clashes(t),
           pg_temp.cascade_day(), pg_temp.cascade_tokens(pg_temp.cascade_day()), pg_temp.on_day(pg_temp.cascade_day()),
           (select count(*)::int from private.demo_bookings d
             where not exists (select 1 from public.bookings b where b.pro_id = d.pro_id
                                 and b.status = d.status and b.staff_id = d.staff_id and b.service_id = d.service_id)),
           (select count(*)::int from public.bookings where status = 'held'),
           (select count(*)::int from public.bookings b join public.refunds r on r.booking_id = b.id
             where b.status = 'cancelled' and r.status = 'succeeded'),
           (select count(*)::int from public.bookings b join public.payouts o on o.booking_id = b.id
             where b.status = 'honoured' and b.price_cents > b.deposit_cents and o.status = 'pending');
  end loop;
end;
$$;
select is_empty($$select k from shifted where out_of_hours > 0$$, 'whatever the weekday, every demo booking fits the opening hours');
select is_empty($$select k from shifted where double_booked > 0$$, 'whatever the weekday, no staff member is double-booked');
select is_empty($$select k from shifted where clashes > 0$$, 'whatever the weekday, next Saturday morning stays free for both');
select is_empty(
  $$select k from shifted
     where cascade is distinct from array['demo-aicha-client-1', 'demo-aicha-client-2', 'demo-aicha-client-3']
        or on_cascade_day <> 3$$,
  'whatever the weekday, the cascade day has exactly its 3 confirmed, paid bookings'
);
select is_empty(
  $$select k from shifted
     where cascade_day <> today + case when extract(isodow from today + 3) = 6 then 4 else 3 end$$,
  'the cascade day is today + 3, or today + 4 when today + 3 is the protected Saturday'
);
select is_empty(
  $$select k from shifted where lost > 0 or held <> 1 or refunded < 1 or balance_due < 1$$,
  'whatever the weekday, every demo row is placed: a hold, a refunded cancellation, a done booking with a balance due'
);

select * from finish();
rollback;
