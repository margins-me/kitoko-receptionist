begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- Her demo week, whatever ran before (dev data, other suites).
select public.reset_demo('a0000000-0000-4000-8000-000000000003');

-- Aïcha is signed in. Studio Nala (a..01) and Kemi (a..02) are other pros.
insert into public.pending_actions (id, pro_id, kind, summary, amount_cents, currency)
values
  ('ac000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'refund', 'Refund Giulia 10 EUR', 1000, 'EUR'),
  ('ac000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'refund', 'Refund Awa 10 EUR', 1000, 'EUR');
insert into public.agent_events (pro_id, kind, name) values ('a0000000-0000-4000-8000-000000000001', 'tool', 'list_services');
insert into public.agent_events (pro_id, kind, name) values ('a0000000-0000-4000-8000-000000000003', 'tool', 'list_services');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
set local role authenticated;

select isnt_empty($$select 1 from public.bookings$$, 'a pro reads her own bookings');
select is(
  (select count(*)::int from public.bookings where pro_id <> 'a0000000-0000-4000-8000-000000000003'),
  0,
  'a pro sees zero bookings of another pro'
);
select isnt_empty($$select 1 from public.clients$$, 'a pro reads her own clients');
select is(
  (select count(*)::int from public.clients where pro_id <> 'a0000000-0000-4000-8000-000000000003'),
  0,
  'a pro sees zero clients of another pro'
);
select results_eq($$select name from public.staff$$, array['Aïcha'], 'a pro reads only her own staff');
select results_eq(
  $$select handle::text from public.pros$$,
  array['aicha.braids'],
  'a pro reads only her own pros row'
);
select lives_ok($$select paypal_email from public.pros$$, 'a pro reads her own paypal_email');
select isnt_empty($$select 1 from public.payments$$, 'a pro reads her own payments');
select is(
  (select count(*)::int from public.payments where pro_id <> 'a0000000-0000-4000-8000-000000000003'),
  0,
  'a pro sees zero payments of another pro'
);
select isnt_empty($$select 1 from public.refunds$$, 'a pro reads her own refunds');
select isnt_empty($$select 1 from public.payouts$$, 'a pro reads her own payouts');
select is(
  (select count(*)::int from public.conversations),
  3,
  'a pro reads her own conversations'
);
select is(
  (select count(*)::int from public.conversation_messages),
  6,
  'a pro reads the messages of her conversations'
);
select results_eq($$select pro_id from public.agent_events$$, array['a0000000-0000-4000-8000-000000000003'::uuid], 'a pro reads only her own agent events');
select results_eq(
  $$select id from public.pending_actions$$,
  array['ac000000-0000-4000-8000-000000000001'::uuid],
  'a pro reads only her own pending actions'
);

select throws_ok(
  $$update public.bookings set status = 'cancelled'$$,
  '42501', 'permission denied for table bookings',
  'a pro cannot write bookings directly'
);
select throws_ok(
  $$insert into public.blocks (pro_id, during)
    values ('a0000000-0000-4000-8000-000000000003', tstzrange('2030-01-01 10:00+00', '2030-01-01 11:00+00', '[)'))$$,
  '42501', 'permission denied for table blocks',
  'a pro cannot insert blocks directly (block_time goes through the server)'
);
select throws_ok(
  $$select public.cancel_booking((select id from public.bookings limit 1), 'pro')$$,
  '42501', null,
  'a pro cannot call cancel_booking directly'
);

select is(
  (public.decide_pending_action('ac000000-0000-4000-8000-000000000001', 'confirmed')).status,
  'confirmed',
  'a pro confirms her own pending action'
);
select throws_ok(
  $$select public.decide_pending_action('ac000000-0000-4000-8000-000000000002', 'confirmed')$$,
  'P0002', 'pending_action_not_found',
  'a pro cannot decide another pro''s pending action'
);
select throws_ok(
  $$select public.mark_honoured('e0000000-0000-4000-8000-0000000000ff')$$,
  'P0002', 'booking_not_found',
  'mark_honoured reports an unknown booking'
);

reset role;
create temp table other_booking as
  select id from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000002' and status = 'confirmed' limit 1;
grant select on other_booking to authenticated;
set local role authenticated;

select throws_ok(
  $$select public.mark_honoured((select id from other_booking))$$,
  'P0002', 'booking_not_found',
  'a pro cannot mark another pro''s booking'
);
select throws_ok(
  $$select public.reset_demo('a0000000-0000-4000-8000-000000000002')$$,
  '42501', 'forbidden',
  'a pro cannot reset another pro''s demo'
);
select lives_ok(
  $$select public.reset_demo('a0000000-0000-4000-8000-000000000003')$$,
  'a pro resets her own demo'
);

select * from finish();
rollback;
