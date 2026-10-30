begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

create function pg_temp.hold(p_pro uuid, p_service uuid, p_start timestamptz, p_minutes integer default 90)
returns uuid
language sql
as $$
  select id from public.create_hold(
    p_pro, p_service, null, p_start, p_minutes,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = p_pro), 4500, 3000, 150, 'web', null, null
  )
$$;

create function pg_temp.booked(p_pro uuid, p_service uuid, p_start timestamptz, p_minutes integer default 90)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_temp.hold(p_pro, p_service, p_start, p_minutes);
begin
  perform public.confirm_booking(v_id, 'Test');
  return v_id;
end;
$$;

create temp table ids (k text primary key, id uuid not null);

-- Aïcha (solo), cornrows b34
insert into ids select 'morning', pg_temp.booked('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', '2030-06-07 09:00+00');
insert into ids select 'afternoon', pg_temp.booked('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', '2030-06-07 13:00+00');
insert into ids select 'held', pg_temp.hold('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', '2030-06-07 15:30+00');

-- the guard on normal blocks
select throws_ok(
  $$insert into public.blocks (pro_id, during)
    values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-06-07 10:00+00', '2030-06-07 11:00+00', '[)'))$$,
  'KT002', 'slot_booked',
  'a normal block cannot cover a confirmed booking'
);
select throws_ok(
  $$insert into public.blocks (pro_id, during)
    values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-06-07 16:00+00', '2030-06-07 16:30+00', '[)'))$$,
  'KT002', 'slot_booked',
  'a normal block cannot cover a live hold'
);
select lives_ok(
  $$insert into public.blocks (pro_id, during, label)
    values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-06-07 11:00+00', '2030-06-07 12:00+00', '[)'), 'Lunch')$$,
  'a normal block on free time is fine'
);

-- sick day
select results_eq(
  $$select * from public.block_time('a0000000-0000-4000-8000-000000000003', null,
      tstzrange('2030-06-07 00:00+00', '2030-06-08 00:00+00', '[)'), 'Sick')$$,
  $$select id from ids where k in ('morning', 'afternoon') order by k desc$$,
  'block_time returns the confirmed bookings it covers, in time order'
);
select is(
  (select count(*)::int from public.bookings where id in (select id from ids where k in ('morning', 'afternoon'))
     and status = 'confirmed' and displaced_at is not null),
  2,
  'they stay confirmed and are marked displaced'
);
select is(
  (select status from public.bookings where id = (select id from ids where k = 'held')),
  'expired',
  'a live hold in the sick day lets go'
);
select is(
  (select count(*)::int from public.blocks where pro_id = 'a0000000-0000-4000-8000-000000000003' and label = 'Sick'),
  1,
  'the block is in place'
);
select ok(
  tstzrange('2030-06-07 00:00+00', '2030-06-08 00:00+00', '[)') in (
    select during from public.busy_intervals('a0000000-0000-4000-8000-000000000003', '5a000000-0000-4000-8000-000000000031',
      '2030-06-07 00:00+00', '2030-06-08 00:00+00')
  ),
  'busy_intervals shows the sick day'
);
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', '2030-06-07 17:00+00')$$,
  'KT001', 'slot_blocked',
  'nobody can hold a slot on the sick day'
);
select lives_ok(
  $$insert into public.blocks (pro_id, during)
    values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-06-07 09:00+00', '2030-06-07 10:00+00', '[)'))$$,
  'a normal block may cover a displaced booking'
);
select is(
  (select count(*)::int from public.block_time('a0000000-0000-4000-8000-000000000003', null,
     tstzrange('2030-06-07 08:00+00', '2030-06-07 09:30+00', '[)'), 'Again')),
  1,
  'a second block_time over a displaced booking still lists it'
);

-- moving a displaced booking
select is(
  public.reschedule_booking((select id from ids where k = 'morning'), '2030-06-10 09:00+00', 'client'),
  '5a000000-0000-4000-8000-000000000031'::uuid,
  'reschedule_booking moves a displaced booking and returns its staff member'
);
select results_eq(
  $$select lower(during), displaced_at, reschedule_count, moved_by, moved_from, upper(during) - lower(during)
      from public.bookings where id = (select id from ids where k = 'morning')$$,
  $$values ('2030-06-10 09:00+00'::timestamptz, null::timestamptz, 0, 'client', '2030-06-07 09:00+00'::timestamptz, interval '90 minutes')$$,
  'the move clears displaced_at, keeps the length and does not count against the client'
);
select throws_ok(
  $$select public.reschedule_booking((select id from ids where k = 'afternoon'), '2030-06-07 18:00+00', 'pro')$$,
  'KT001', 'slot_blocked',
  'a booking cannot move into the sick day'
);
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'afternoon'), 'pro', 'declined_move')$$,
  $$values (0, 0)$$,
  'a client who declines the move is cancelled by the pro'
);
select is(
  (select displaced_at from public.bookings where id = (select id from ids where k = 'afternoon')),
  null,
  'the cancelled booking is no longer displaced'
);

-- client moves count against the policy (maxCount 1)
insert into ids select 'mover', pg_temp.booked('a0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000034', '2030-06-12 09:00+00');
select lives_ok(
  $$select public.reschedule_booking((select id from ids where k = 'mover'), '2030-06-12 13:00+00', 'client')$$,
  'a client moves her booking once'
);
select throws_ok(
  $$select public.reschedule_booking((select id from ids where k = 'mover'), '2030-06-12 15:30+00', 'client')$$,
  'KT006', 'not_reschedulable',
  'a second client move is refused by the policy'
);
select lives_ok(
  $$select public.reschedule_booking((select id from ids where k = 'mover'), '2030-06-12 15:30+00', 'pro')$$,
  'the pro can still move it'
);
select throws_ok(
  $$select public.reschedule_booking((select id from ids where k = 'mover'), '2030-06-10 09:30+00', 'pro')$$,
  '23P01', 'slot_taken',
  'a booking cannot move onto another one'
);

-- one staff member's sick day (Studio Nala)
insert into ids select 'nala', pg_temp.booked('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', '2030-06-14 10:00+00');
insert into ids select 'sira', pg_temp.booked('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000016', '2030-06-14 10:00+00', 60);
select results_eq(
  $$select * from public.block_time('a0000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000012',
      tstzrange('2030-06-14 00:00+00', '2030-06-15 00:00+00', '[)'), 'Sira sick')$$,
  $$select id from ids where k = 'sira'$$,
  'block_time for one staff member only displaces her bookings'
);
select is(
  (select displaced_at from public.bookings where id = (select id from ids where k = 'nala')),
  null,
  'the other staff member''s booking is untouched'
);
select throws_ok(
  $$select public.block_time('a0000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000031',
      tstzrange('2030-06-15 00:00+00', '2030-06-16 00:00+00', '[)'), 'x')$$,
  'P0002', 'staff_not_found',
  'block_time refuses another pro''s staff member'
);

select * from finish();
rollback;
