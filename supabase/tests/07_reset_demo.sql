begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- start from the demo week whatever ran before (dev data, other suites)
select public.reset_demo(id) from public.pros;
create temp table before as
  select pro_id, status, count(*)::int as n from public.bookings group by 1, 2;

-- activity the demo button must wipe
select public.create_hold(
  'a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', null, '2030-05-01 10:00+00', 90,
  '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}', '{}', 4500, 3000, 150, 'web', null, null
);
insert into public.blocks (pro_id, during, label)
values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-05-02 09:00+00', '2030-05-02 10:00+00', '[)'), 'Noise');
insert into public.agent_events (pro_id, kind, name) values ('a0000000-0000-4000-8000-000000000003', 'tool', 'noise');

select lives_ok($$select public.reset_demo('a0000000-0000-4000-8000-000000000003')$$, 'reset_demo runs');
select lives_ok($$select public.reset_demo('a0000000-0000-4000-8000-000000000003')$$, 'reset_demo runs twice');
select lives_ok(
  $$select public.reset_demo(id) from public.pros$$,
  'reset_demo runs for every pro'
);

select set_eq(
  $$select pro_id, status, count(*)::int from public.bookings group by 1, 2$$,
  $$select pro_id, status, n from before$$,
  'reset_demo is idempotent: same bookings per pro and status'
);
select is_empty(
  $$select 1 from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000003' and lower(during) > '2030-01-01'$$,
  'the bookings made since are gone'
);
select is_empty($$select 1 from public.blocks where label = 'Noise'$$, 'the blocks made since are gone');
select is_empty($$select 1 from public.agent_events where name = 'noise'$$, 'the agent events are gone');

-- Aïcha's week, relative to today in Rome. The cascade day is today + 3, or today + 4 when today + 3 is next Saturday
-- (its morning stays free for knotless): 20261027000700_demo_within_hours.sql.
create temp table aicha as
  select b.*, (lower(b.during) at time zone 'Europe/Rome')::date - (now() at time zone 'Europe/Rome')::date as day
    from public.bookings b
   where b.pro_id = 'a0000000-0000-4000-8000-000000000003';
create temp table cascade as
  select case when extract(isodow from (now() at time zone 'Europe/Rome')::date + 3) = 6 then 4 else 3 end as day;

select results_eq(
  $$select c.token from aicha a
      join public.conversations c on c.id = a.conversation_id
      join public.payments p on p.booking_id = a.id and p.status = 'captured'
     where a.day = (select day from cascade) and a.status = 'confirmed'
     order by lower(a.during)$$,
  array['demo-aicha-client-1', 'demo-aicha-client-2', 'demo-aicha-client-3'],
  'exactly 3 confirmed, paid bookings on the cascade day, each with its web conversation'
);
select is(
  (select count(*)::int from aicha where day = (select day from cascade)),
  3,
  'nothing else on the cascade day'
);
select is(
  (select count(*)::int from aicha where day between 0 and 7),
  10,
  'ten bookings in the coming week'
);
select ok(
  (select bool_and(hold_expires_at between now() + interval '9 minutes' and now() + interval '11 minutes'
                   and client_id is null)
     from aicha where status = 'held')
  and (select count(*) from aicha where status = 'held') = 1,
  'one live hold expiring in about 10 minutes'
);
select results_eq(
  $$select r.amount_cents, r.status, p.refunded_cents, a.cancelled_by
      from aicha a join public.payments p on p.booking_id = a.id join public.refunds r on r.payment_id = p.id
     where a.status = 'cancelled'$$,
  $$values (3000, 'succeeded', 3000, 'client')$$,
  'one cancellation with its deposit refunded'
);
select results_eq(
  $$select a.day, o.amount_cents, o.status from aicha a join public.payouts o on o.booking_id = a.id
     where a.status = 'honoured'$$,
  $$values (-1, 3000, 'pending')$$,
  'yesterday''s booking is done and its payout is pending'
);
select is_empty(
  $$select 1 from public.payments where capture_id not like 'SEED-%'$$,
  'seeded captures start with SEED-'
);
select is(
  (select count(*)::int from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
    where c.pro_id = 'a0000000-0000-4000-8000-000000000003'),
  6,
  'each demo conversation opens with its two messages'
);
select is(
  (select count(distinct staff_id)::int from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000001'),
  2,
  'Studio Nala has bookings on both staff members'
);
select throws_ok(
  $$select public.reset_demo('a0000000-0000-4000-8000-0000000000ff')$$,
  'P0002', 'pro_not_found',
  'reset_demo reports an unknown pro'
);

select * from finish();
rollback;
