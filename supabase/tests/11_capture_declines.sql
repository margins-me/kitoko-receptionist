begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- A declined capture (422 INSTRUMENT_DECLINED) keeps the booking held and counts the decline, so the next capture
-- sends a new PayPal-Request-Id (20261027000800_capture_declines.sql).
create temp table b as
  select id from public.create_hold(
    'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null, '2030-06-03 10:00+00', 60,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002'),
    4500, 3000, 150, 'web', null, null
  );
select public.paypal_prepare((select id from b), 'ORDER-DECLINED');

select is(public.paypal_capture_declined('ORDER-DECLINED'), 1, 'the first decline is counted');
select is(public.paypal_capture_declined('ORDER-DECLINED'), 2, 'and the next one');
select results_eq(
  $$select p.status, bk.status from public.payments p join public.bookings bk on bk.id = p.booking_id
     where p.paypal_order_id = 'ORDER-DECLINED'$$,
  $$values ('created', 'held')$$,
  'the payment still waits and the booking stays held'
);
select results_eq(
  $$select outcome from public.paypal_capture_completed('ORDER-DECLINED', 'CAP-AFTER-DECLINES', 3150, 'GBP', '{}')$$,
  $$values ('confirmed')$$,
  'a later capture of the same order confirms the booking'
);
select is(public.paypal_capture_declined('ORDER-DECLINED'), null::integer, 'a captured payment is no longer counted');
select throws_ok(
  $$select public.paypal_capture_declined('ORDER-NOBODY')$$,
  'P0002', 'payment_not_found',
  'an unknown order is reported'
);

select * from finish();
rollback;
