begin;
create extension if not exists pgtap with schema extensions;
select plan(38);

create function pg_temp.kemi(p_start timestamptz, p_conversation uuid default null)
returns uuid
language sql
as $$
  select id from public.create_hold(
    'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null, p_start, 60,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002'),
    4500, 3000, 150, 'web', p_conversation, null
  )
$$;

create temp table ids (k text primary key, id uuid not null);
create temp table pays (k text primary key, id uuid not null);

-- paypal_prepare
insert into ids select 'a', pg_temp.kemi('2030-04-01 10:00+00');
insert into pays select 'a', public.paypal_prepare((select id from ids where k = 'a'), 'ORDER-A');
select results_eq(
  $$select deposit_cents, fee_cents, amount_cents, currency, status, kind from public.payments where paypal_order_id = 'ORDER-A'$$,
  $$values (3000, 150, 3150, 'GBP', 'created', 'deposit')$$,
  'paypal_prepare records the order with the booking''s amounts'
);
select is(
  public.paypal_prepare((select id from ids where k = 'a'), 'ORDER-A'),
  (select id from pays where k = 'a'),
  'paypal_prepare is idempotent for the same order'
);
select throws_ok(
  $$select public.paypal_prepare(pg_temp.kemi('2030-04-01 12:00+00'), 'ORDER-A')$$,
  '22023', 'order_of_another_booking',
  'an order belongs to one booking'
);
select throws_ok(
  $$select public.paypal_prepare('e0000000-0000-4000-8000-0000000000ff', 'ORDER-X')$$,
  'P0002', 'booking_not_found',
  'paypal_prepare reports an unknown booking'
);

-- paypal_capture_completed
select throws_ok(
  $$select * from public.paypal_capture_completed('ORDER-A', 'CAP-A', 3000, 'GBP', '{}')$$,
  'KT031', 'amount_mismatch',
  'a capture of another amount is refused'
);
select throws_ok(
  $$select * from public.paypal_capture_completed('ORDER-A', 'CAP-A', 3150, 'EUR', '{}')$$,
  'KT031', 'amount_mismatch',
  'a capture in another currency is refused'
);
select throws_ok(
  $$select * from public.paypal_capture_completed('ORDER-NOPE', 'CAP-X', 3150, 'GBP', '{}')$$,
  'P0002', 'payment_not_found',
  'a capture of an unknown order is refused'
);
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-A', 'CAP-A', 3150, 'gbp',
      '{"name": {"given_name": "Nia", "surname": "Test"}, "email_address": "nia@example.com"}')$$,
  $$values ('confirmed')$$,
  'a completed capture confirms the booking'
);
select results_eq(
  $$select b.status, c.first_name, c.email::text, c.phone_e164
      from public.bookings b join public.clients c on c.id = b.client_id
     where b.id = (select id from ids where k = 'a')$$,
  $$values ('confirmed', 'Nia', 'nia@example.com', null::text)$$,
  'the unknown client is created from the payer''s name and e-mail'
);
select results_eq(
  $$select status, capture_id, captured_at is not null from public.payments where paypal_order_id = 'ORDER-A'$$,
  $$values ('captured', 'CAP-A', true)$$,
  'the payment is captured'
);
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-A', 'CAP-A', 3150, 'GBP', '{}')$$,
  $$values ('already_captured')$$,
  'a second capture event is a no-op'
);
select is(
  (select count(*)::int from public.refunds where booking_id = (select id from ids where k = 'a')),
  0,
  'and refunds nothing'
);
select throws_ok(
  $$select public.paypal_prepare((select id from ids where k = 'a'), 'ORDER-A2')$$,
  'KT011', 'not_payable',
  'a paid booking cannot take another order'
);

-- WhatsApp: the number comes from the conversation
insert into public.conversations (id, pro_id, kind, channel, external_id)
values ('c2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'client', 'whatsapp', '447700900555');
insert into ids select 'wa', pg_temp.kemi('2030-04-02 10:00+00', 'c2000000-0000-4000-8000-000000000001');
select public.paypal_prepare((select id from ids where k = 'wa'), 'ORDER-WA');
select public.paypal_capture_completed('ORDER-WA', 'CAP-WA', 3150, 'GBP', '{"name": {"given_name": "Ola"}}');
select results_eq(
  $$select c.first_name, c.phone_e164 from public.bookings b join public.clients c on c.id = b.client_id
     where b.id = (select id from ids where k = 'wa')$$,
  $$values ('Ola', '+447700900555')$$,
  'a WhatsApp client is recorded with her number'
);
select is(
  (select client_id from public.conversations where id = 'c2000000-0000-4000-8000-000000000001'),
  (select client_id from public.bookings where id = (select id from ids where k = 'wa')),
  'the conversation now knows its client'
);

-- slot lost while paying
insert into ids select 'lost', pg_temp.kemi('2030-04-03 10:00+00');
select public.paypal_prepare((select id from ids where k = 'lost'), 'ORDER-LOST');
update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 minute' where id = (select id from ids where k = 'lost');
select pg_temp.kemi('2030-04-03 10:30+00');
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-LOST', 'CAP-LOST', 3150, 'GBP', '{"name": {"given_name": "Zoe"}}')$$,
  $$values ('slot_lost')$$,
  'a capture after the slot went reports slot_lost'
);
select is(
  (select status from public.bookings where id = (select id from ids where k = 'lost')),
  'expired',
  'the booking stays expired'
);
select results_eq(
  $$select amount_cents, reason, status from public.refunds where booking_id = (select id from ids where k = 'lost')$$,
  $$values (3150, 'slot_lost', 'pending')$$,
  'everything is refunded, booking fee included'
);

-- a lapsed hold whose slot is still free is confirmed
insert into ids select 'lapsed', pg_temp.kemi('2030-04-04 10:00+00');
select public.paypal_prepare((select id from ids where k = 'lapsed'), 'ORDER-LAPSED');
update public.bookings set status = 'expired', hold_expires_at = now() - interval '1 minute' where id = (select id from ids where k = 'lapsed');
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-LAPSED', 'CAP-LAPSED', 3150, 'GBP', '{"name": {"given_name": "Ivy"}}')$$,
  $$values ('confirmed')$$,
  'a capture after the hold lapsed still confirms when the slot is free'
);

-- a second order for a paid booking
insert into public.payments (pro_id, booking_id, paypal_order_id, deposit_cents, fee_cents, amount_cents, currency)
values ('a0000000-0000-4000-8000-000000000002', (select id from ids where k = 'a'), 'ORDER-DUP', 3000, 150, 3150, 'GBP');
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-DUP', 'CAP-DUP', 3150, 'GBP', '{}')$$,
  $$values ('duplicate')$$,
  'a second paid order for the same booking is a duplicate'
);
select results_eq(
  $$select r.amount_cents, r.reason from public.refunds r join public.payments p on p.id = r.payment_id
     where p.paypal_order_id = 'ORDER-DUP'$$,
  $$values (3150, 'duplicate')$$,
  'and is refunded in full'
);

-- paypal_capture_denied
insert into ids select 'denied', pg_temp.kemi('2030-04-05 10:00+00');
select public.paypal_prepare((select id from ids where k = 'denied'), 'ORDER-DENIED');
select lives_ok($$select public.paypal_capture_denied('ORDER-DENIED')$$, 'paypal_capture_denied runs');
select results_eq(
  $$select p.status, b.status from public.payments p join public.bookings b on b.id = p.booking_id where p.paypal_order_id = 'ORDER-DENIED'$$,
  $$values ('denied', 'expired')$$,
  'a denied capture denies the payment and lets go of the hold'
);
select lives_ok($$select public.paypal_capture_denied('ORDER-A')$$, 'a denial never touches a captured payment');
select is((select status from public.payments where paypal_order_id = 'ORDER-A'), 'captured', 'the captured payment stays captured');

-- record_paypal_event
select ok(public.record_paypal_event('WH-1', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-A', '{"id": "WH-1"}', true), 'a new event is recorded');
select ok(not public.record_paypal_event('WH-1', 'PAYMENT.CAPTURE.COMPLETED', 'CAP-A', '{"id": "WH-1"}', true), 'a replayed event is reported as seen');
select is((select count(*)::int from public.paypal_events where event_id = 'WH-1'), 1, 'the event is stored once');

-- refunds finishing
select is(
  (select kept_cents from public.cancel_booking((select id from ids where k = 'wa'), 'pro')),
  0,
  'the pro cancels the WhatsApp booking'
);
select lives_ok(
  $$select public.refund_finished((select id from public.refunds where booking_id = (select id from ids where k = 'wa')), 'RF-1', 'succeeded')$$,
  'refund_finished records a successful refund'
);
select results_eq(
  $$select p.status, p.refunded_cents, r.status, r.paypal_refund_id from public.payments p join public.refunds r on r.payment_id = p.id
     where p.paypal_order_id = 'ORDER-WA'$$,
  $$values ('refunded', 3150, 'succeeded', 'RF-1')$$,
  'a fully refunded payment becomes refunded'
);
select lives_ok(
  $$select public.refund_finished((select id from public.refunds where booking_id = (select id from ids where k = 'wa')), 'RF-1', 'succeeded')$$,
  'refund_finished is idempotent'
);
select throws_ok(
  $$select public.refund_finished((select id from public.refunds where booking_id = (select id from ids where k = 'wa')), null, 'failed')$$,
  'KT032', 'not_pending',
  'a finished refund cannot change outcome'
);
select public.refund_finished((select id from public.refunds where reason = 'slot_lost' and booking_id = (select id from ids where k = 'lost')), null, 'failed');
select is(
  (select refunded_cents from public.payments where paypal_order_id = 'ORDER-LOST'),
  0,
  'a failed refund gives the amount back to the payment'
);

-- request_refund
select throws_ok(
  $$select public.request_refund((select id from public.payments where paypal_order_id = 'ORDER-LAPSED'), 5000, 'pro_request')$$,
  'KT012', 'exceeds_balance',
  'a refund cannot exceed what is left'
);
select public.request_refund((select id from public.payments where paypal_order_id = 'ORDER-LAPSED'), 1000, 'pro_request');
select results_eq(
  $$select r.amount_cents, r.reason, r.status from public.refunds r join public.payments p on p.id = r.payment_id
     where p.paypal_order_id = 'ORDER-LAPSED'$$,
  $$values (1000, 'pro_request', 'pending')$$,
  'request_refund queues a partial refund'
);

-- payouts
select public.mark_honoured((select id from ids where k = 'lapsed'));
select public.payout_sent((select id from public.payouts where booking_id = (select id from ids where k = 'lapsed')), 'BATCH-1', 'ITEM-1');
select results_eq(
  $$select status, payout_batch_id, payout_item_id, amount_cents from public.payouts where booking_id = (select id from ids where k = 'lapsed')$$,
  $$values ('sent', 'BATCH-1', 'ITEM-1', 2000)$$,
  'payout_sent records the batch; the payout is the deposit minus the refunded part'
);
select public.payout_status('ITEM-1', 'succeeded');
select is(
  (select status from public.payouts where payout_item_id = 'ITEM-1'),
  'succeeded',
  'payout_status updates the payout by item id'
);

select * from finish();
rollback;
