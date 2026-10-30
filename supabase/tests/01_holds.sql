begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Kemi (solo): staff 21, gel extensions b21. Studio Nala: Nala (11) braids b11/b14, Sira (12) nails b15/b16.
create function pg_temp.hold(
  p_pro uuid, p_service uuid, p_staff uuid, p_start timestamptz, p_minutes integer default 60,
  p_conversation uuid default null, p_price integer default 4500, p_deposit integer default 3000
)
returns uuid
language sql
as $$
  select id from public.create_hold(
    p_pro, p_service, p_staff, p_start, p_minutes,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = p_pro), p_price, p_deposit, 150, 'web', p_conversation, null
  )
$$;

create function pg_temp.kemi(p_start timestamptz, p_minutes integer default 60, p_conversation uuid default null)
returns uuid
language sql
as $$
  select pg_temp.hold('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null,
                      p_start, p_minutes, p_conversation)
$$;

create temp table ids (k text primary key, id uuid not null);

-- create_hold
select lives_ok(
  $$insert into ids select 'first', pg_temp.kemi('2030-01-08 10:00+00')$$,
  'create_hold takes a free slot'
);
select matches(
  (select ref from public.bookings where id = (select id from ids where k = 'first')),
  '^[A-HJ-NP-Z2-9]{6}$',
  'the booking gets a 6-character reference without 0, O, 1 or I'
);
select is(
  (select hold_expires_at from public.bookings where id = (select id from ids where k = 'first')),
  now() + interval '15 minutes',
  'a web hold lasts 15 minutes'
);
select is(
  (select staff_id || ' ' || status || ' ' || currency || ' ' || fee_cents || ' ' || source
     from public.bookings where id = (select id from ids where k = 'first')),
  '5a000000-0000-4000-8000-000000000021 held GBP 150 web',
  'the hold picks the only eligible staff member and takes the pro''s currency'
);
select is(
  (select upper(during) - lower(during) from public.bookings where id = (select id from ids where k = 'first')),
  interval '60 minutes',
  'the hold lasts the given minutes'
);
select throws_ok(
  $$select pg_temp.kemi('2030-01-08 10:30+00')$$,
  '23P01', null,
  'an overlapping hold on the same staff member fails with 23P01'
);
select lives_ok(
  $$select pg_temp.kemi('2030-01-08 11:00+00')$$,
  'an adjacent [) hold is accepted'
);
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null,
                        '2030-01-08 14:00+00', 60, null, 2000, 3000)$$,
  '23514', null,
  'a deposit above the price is rejected'
);
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000011', null,
                        '2030-01-08 14:00+00')$$,
  'KT030', 'no_eligible_staff',
  'a hold cannot use another pro''s service'
);
select throws_ok(
  $$select pg_temp.kemi('2030-01-08 14:00+00', 4)$$,
  '23514', null,
  'a booking shorter than 5 minutes is rejected'
);
select throws_ok(
  $$select * from public.create_hold('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021')$$,
  '22023', 'missing_argument',
  'create_hold needs a start, minutes, amounts and a source'
);

-- stale holds
insert into ids select 'stale', pg_temp.kemi('2030-01-09 10:00+00');
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = (select id from ids where k = 'stale');
select lives_ok($$select pg_temp.kemi('2030-01-09 10:00+00')$$, 'a stale hold does not block its slot');
select is(
  (select status from public.bookings where id = (select id from ids where k = 'stale')),
  'expired',
  'the stale hold is marked expired'
);

insert into ids select 'swept', pg_temp.kemi('2030-01-09 14:00+00');
update public.bookings set hold_expires_at = now() - interval '1 minute' where id = (select id from ids where k = 'swept');
select is(
  (select schedule from cron.job where jobname = 'expire-holds'),
  '* * * * *',
  'the expire-holds job runs every minute'
);
do $$ begin execute (select command from cron.job where jobname = 'expire-holds'); end $$;
select is(
  (select status from public.bookings where id = (select id from ids where k = 'swept')),
  'expired',
  'the expire-holds job expires holds past their time'
);

-- blocks
insert into public.blocks (pro_id, during, label)
values ('a0000000-0000-4000-8000-000000000002', tstzrange('2030-01-10 09:00+00', '2030-01-10 10:00+00', '[)'), 'Test');
select throws_ok(
  $$select pg_temp.kemi('2030-01-10 09:30+00')$$,
  'KT001', 'slot_blocked',
  'a hold over a whole-business block fails with slot_blocked'
);

-- two staff members (Studio Nala)
select lives_ok(
  $$insert into ids select 'braids', pg_temp.hold('a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000014', null, '2030-01-08 10:00+00', 90)$$,
  'Studio Nala: a braid hold'
);
select lives_ok(
  $$insert into ids select 'nails', pg_temp.hold('a0000000-0000-4000-8000-000000000001',
      'b0000000-0000-4000-8000-000000000016', null, '2030-01-08 10:00+00', 60)$$,
  'two staff members can be booked at the same time'
);
select is(
  (select array_agg(s.name order by s.name)
     from public.bookings b join public.staff s on s.id = b.staff_id
    where b.id in (select id from ids where k in ('braids', 'nails'))),
  array['Nala', 'Sira'],
  'braids go to Nala and nails to Sira (service_staff)'
);
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000016', null,
                        '2030-01-08 10:30+00', 30)$$,
  '23P01', 'slot_taken',
  'nails at the same time fail: their only staff member is taken'
);
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000016',
                        '5a000000-0000-4000-8000-000000000011', '2030-01-08 15:00+00', 30)$$,
  'KT030', 'staff_not_eligible',
  'a staff member who does not perform the service is refused'
);
select lives_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000016',
                        '5a000000-0000-4000-8000-000000000012', '2030-01-08 15:00+00', 30)$$,
  'an explicit eligible staff member is accepted'
);

insert into public.blocks (pro_id, staff_id, during, label)
values ('a0000000-0000-4000-8000-000000000001', '5a000000-0000-4000-8000-000000000012',
        tstzrange('2030-01-11 09:00+00', '2030-01-11 12:00+00', '[)'), 'Sira off');
select throws_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000016', null,
                        '2030-01-11 10:00+00', 30)$$,
  'KT001', 'slot_blocked',
  'a staff member''s own block blocks her services'
);
select lives_ok(
  $$select pg_temp.hold('a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', null,
                        '2030-01-11 10:00+00', 90)$$,
  'another staff member''s block does not block the braids'
);

-- three live holds per conversation
insert into public.conversations (id, pro_id, kind, channel, external_id)
values ('c1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'client', 'web', 'test-holds');
select pg_temp.kemi('2030-01-15 09:00+00', 60, 'c1000000-0000-4000-8000-000000000001');
select pg_temp.kemi('2030-01-15 11:00+00', 60, 'c1000000-0000-4000-8000-000000000001');
insert into ids select 'third', pg_temp.kemi('2030-01-15 13:00+00', 60, 'c1000000-0000-4000-8000-000000000001');
select throws_ok(
  $$select pg_temp.kemi('2030-01-15 15:00+00', 60, 'c1000000-0000-4000-8000-000000000001')$$,
  'KT005', 'too_many_holds',
  'a conversation keeps at most 3 live holds'
);

-- release_hold
select lives_ok(
  $$select public.release_hold((select id from ids where k = 'third'))$$,
  'release_hold lets go of a hold'
);
select is(
  (select status from public.bookings where id = (select id from ids where k = 'third')),
  'expired',
  'the released hold is expired'
);
select lives_ok(
  $$select pg_temp.kemi('2030-01-15 15:00+00', 60, 'c1000000-0000-4000-8000-000000000001')$$,
  'after a release the conversation can hold again'
);
select lives_ok(
  $$select public.release_hold((select id from ids where k = 'third'))$$,
  'release_hold is idempotent'
);

-- confirm_booking
select isnt(
  public.confirm_booking((select id from ids where k = 'first'), 'Ada', null, 'ada@example.com', 'en'),
  null,
  'confirm_booking returns the client id'
);
select is(
  (select b.status || ' ' || c.first_name || ' ' || c.email || ' ' || (b.hold_expires_at is null)
     from public.bookings b join public.clients c on c.id = b.client_id
    where b.id = (select id from ids where k = 'first')),
  'confirmed Ada ada@example.com true',
  'the hold is confirmed for a client without a phone number'
);
select throws_ok(
  $$select public.release_hold((select id from ids where k = 'first'))$$,
  'KT003', 'not_releasable',
  'release_hold refuses a confirmed booking'
);
select is(
  public.confirm_booking((select id from ids where k = 'first'), 'Ada'),
  (select client_id from public.bookings where id = (select id from ids where k = 'first')),
  'confirm_booking is idempotent on a confirmed booking'
);

insert into ids select 'lapsed', pg_temp.kemi('2030-01-16 10:00+00');
update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 hour'
 where id = (select id from ids where k = 'lapsed');
select lives_ok(
  $$select public.confirm_booking((select id from ids where k = 'lapsed'), 'Bea', '+447700900999')$$,
  'confirm_booking re-takes a lapsed hold whose slot is still free'
);
select is(
  (select status from public.bookings where id = (select id from ids where k = 'lapsed')),
  'confirmed',
  'the lapsed hold is confirmed'
);

insert into ids select 'lost', pg_temp.kemi('2030-01-16 14:00+00');
update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 hour'
 where id = (select id from ids where k = 'lost');
select pg_temp.kemi('2030-01-16 14:30+00');
select throws_ok(
  $$select public.confirm_booking((select id from ids where k = 'lost'), 'Cleo')$$,
  '23P01', 'slot_taken',
  'confirm_booking fails with 23P01 when someone else took the lapsed slot'
);
select throws_ok(
  $$select public.confirm_booking(pg_temp.kemi('2030-01-17 10:00+00'), ' ')$$,
  '22023', 'first_name_required',
  'a client needs a first name'
);

-- hold length by channel (20261027001000_hold_by_channel.sql)
create function pg_temp.kemi_from(p_start timestamptz, p_source text)
returns uuid
language sql
as $$
  select id from public.create_hold(
    'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null, p_start, 60,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002'), 4500, 3000, 150, p_source, null, null
  )
$$;
insert into ids select 'wa', pg_temp.kemi_from('2030-01-22 10:00+00', 'whatsapp');
insert into ids select 'mcp', pg_temp.kemi_from('2030-01-22 12:00+00', 'mcp');
insert into ids select 'manual', pg_temp.kemi_from('2030-01-22 14:00+00', 'manual');
select is(
  (select hold_expires_at from public.bookings where id = (select id from ids where k = 'wa')),
  now() + interval '30 minutes',
  'a WhatsApp hold lasts 30 minutes'
);
select is(
  (select hold_expires_at from public.bookings where id = (select id from ids where k = 'mcp')),
  now() + interval '30 minutes',
  'an MCP hold lasts 30 minutes'
);
select is(
  (select hold_expires_at from public.bookings where id = (select id from ids where k = 'manual')),
  now() + interval '15 minutes',
  'any other channel keeps 15 minutes'
);

-- refresh_hold_on_open: the first opening of the deposit page tops the hold up to now() + 15 min, once, never shorter
update public.bookings set hold_expires_at = now() + interval '2 minutes' where id = (select id from ids where k = 'manual');
select is(
  public.refresh_hold_on_open((select id from ids where k = 'manual')),
  now() + interval '15 minutes',
  'the first opening gives a nearly lapsed hold 15 more minutes'
);
update public.bookings set hold_expires_at = now() + interval '2 minutes' where id = (select id from ids where k = 'manual');
select is(
  public.refresh_hold_on_open((select id from ids where k = 'manual')),
  now() + interval '2 minutes',
  'a second opening changes nothing (once per booking)'
);
select is(
  public.refresh_hold_on_open((select id from ids where k = 'wa')),
  now() + interval '30 minutes',
  'a longer hold is never shortened'
);
select isnt(
  (select hold_refreshed_at from public.bookings where id = (select id from ids where k = 'wa')),
  null,
  'the refresh is recorded on the booking'
);
select is(
  public.refresh_hold_on_open((select id from ids where k = 'lost')),
  null,
  'a booking that is no longer held is not refreshed'
);

-- busy_intervals
select results_eq(
  $$select during from public.busy_intervals('a0000000-0000-4000-8000-000000000002', null,
      '2030-01-08 00:00+00', '2030-01-09 00:00+00') order by lower(during)$$,
  $$values (tstzrange('2030-01-08 10:00+00', '2030-01-08 11:00+00', '[)')),
           (tstzrange('2030-01-08 11:00+00', '2030-01-08 12:00+00', '[)'))$$,
  'busy_intervals lists the live bookings of the day'
);

select * from finish();
rollback;
