begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- Kemi: deposit 30 GBP + 1.50 booking fee; policy: free until 48 h before, then 100 % kept.
create function pg_temp.kemi(p_start timestamptz, p_policy jsonb default null)
returns uuid
language sql
as $$
  select id from public.create_hold(
    'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null, p_start, 60,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    coalesce(p_policy, (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002')),
    4500, 3000, 150, 'web', null, null
  )
$$;

-- a confirmed booking with its deposit captured
create function pg_temp.paid(p_start timestamptz, p_policy jsonb default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := pg_temp.kemi(p_start, p_policy);
begin
  perform public.paypal_prepare(v_id, 'ORDER-' || v_id);
  perform public.paypal_capture_completed('ORDER-' || v_id, 'CAP-' || v_id, 3150, 'GBP',
    '{"name": {"given_name": "Test"}, "email_address": "test@example.com"}');
  return v_id;
end;
$$;

create temp table ids (k text primary key, id uuid not null);

-- The late cases sit a day or two from now, where Kemi's demo week may have a booking: clear her live ones (rolled back).
update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', hold_expires_at = null, displaced_at = null
 where pro_id = 'a0000000-0000-4000-8000-000000000002' and status in ('held', 'confirmed', 'honoured');

-- client, inside the free window
insert into ids select 'early', pg_temp.paid('2030-03-04 10:00+00');
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'early'), 'client')$$,
  $$values (3000, 0)$$,
  'a client cancelling in the free window gets her deposit back; the booking fee is kept'
);
select results_eq(
  $$select amount_cents, status, reason, currency from public.refunds where booking_id = (select id from ids where k = 'early')$$,
  $$values (3000, 'pending', 'client_cancel', 'GBP')$$,
  'a pending refund of the deposit is queued'
);
select is(
  (select refunded_cents from public.payments where booking_id = (select id from ids where k = 'early')),
  3000,
  'the payment reserves the refund'
);
select is_empty(
  $$select 1 from public.payouts where booking_id = (select id from ids where k = 'early')$$,
  'nothing is paid out to the pro'
);
select is(
  (select status || ' ' || cancelled_by from public.bookings where id = (select id from ids where k = 'early')),
  'cancelled client',
  'the booking is cancelled by the client'
);
select throws_ok(
  $$select * from public.cancel_booking((select id from ids where k = 'early'), 'client')$$,
  'KT007', 'not_cancellable',
  'a cancelled booking cannot be cancelled again'
);

-- client, late: the policy keeps everything
insert into ids select 'late', pg_temp.paid(now() + interval '10 hours');
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'late'), 'client')$$,
  $$values (0, 3000)$$,
  'a late client cancellation keeps the deposit'
);
select is_empty(
  $$select 1 from public.refunds where booking_id = (select id from ids where k = 'late')$$,
  'no refund row when nothing is refunded'
);
select results_eq(
  $$select amount_cents, fee_cents, reason, status from public.payouts where booking_id = (select id from ids where k = 'late')$$,
  $$values (3000, 150, 'late_cancel', 'pending')$$,
  'the kept deposit is queued as a payout to the pro (never the fee)'
);

-- client, late, under a 50 % tier
insert into ids select 'half', pg_temp.paid(
  now() + interval '30 hours',
  jsonb_set(
    (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002'),
    '{cancellation}',
    '[{"minHoursBefore": 48, "keepPercent": 0}, {"minHoursBefore": 24, "keepPercent": 50}, {"minHoursBefore": 0, "keepPercent": 100}]'
  )
);
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'half'), 'client')$$,
  $$values (1500, 1500)$$,
  'the policy tier decides what is kept'
);
select results_eq(
  $$select (select amount_cents from public.refunds where booking_id = (select id from ids where k = 'half')),
           (select amount_cents from public.payouts where booking_id = (select id from ids where k = 'half'))$$,
  $$values (1500, 1500)$$,
  'half is refunded and half is paid out'
);

-- by the pro: everything back, fee included
insert into ids select 'pro', pg_temp.paid(now() + interval '10 hours');
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'pro'), 'pro', 'sick')$$,
  $$values (3150, 0)$$,
  'a pro cancellation refunds everything, booking fee included'
);
select results_eq(
  $$select amount_cents, reason from public.refunds where booking_id = (select id from ids where k = 'pro')$$,
  $$values (3150, 'sick')$$,
  'the refund carries the given reason'
);
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking(pg_temp.paid('2030-03-05 10:00+00'), 'system')$$,
  $$values (3150, 0)$$,
  'a system cancellation refunds everything too'
);

-- no captured payment
insert into ids select 'unpaid', pg_temp.kemi('2030-03-06 10:00+00');
select public.confirm_booking((select id from ids where k = 'unpaid'), 'Dee');
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'unpaid'), 'pro')$$,
  $$values (0, 0)$$,
  'without a captured payment nothing is refunded'
);
select is_empty(
  $$select 1 from public.refunds where booking_id = (select id from ids where k = 'unpaid')$$,
  'and no refund row is created'
);

-- kept_service_cents and cancellationOutcome agree on the tiers
select results_eq(
  $$select private.kept_service_cents('{"cancellation": [{"minHoursBefore": 48, "keepPercent": 0}, {"minHoursBefore": 0, "keepPercent": 100}]}',
          now() + h * interval '1 hour', now(), 3000)
      from unnest(array[72, 48, 47, 1, -1]) h$$,
  $$values (0), (0), (3000), (3000), (3000)$$,
  'kept_service_cents: free from 48 h before, all kept after, and after the start'
);

-- mark_honoured / mark_no_show
insert into ids select 'done', pg_temp.paid('2030-03-07 10:00+00');
select isnt(public.mark_honoured((select id from ids where k = 'done')), null, 'mark_honoured queues a payout');
select results_eq(
  $$select amount_cents, fee_cents, currency, reason, status from public.payouts where booking_id = (select id from ids where k = 'done')$$,
  $$values (3000, 150, 'GBP', 'honoured', 'pending')$$,
  'the payout is the deposit, never the booking fee'
);
select is(
  public.mark_honoured((select id from ids where k = 'done')),
  (select id from public.payouts where booking_id = (select id from ids where k = 'done')),
  'mark_honoured is idempotent'
);
select is(
  (select count(*)::int from public.payouts where booking_id = (select id from ids where k = 'done')),
  1,
  'one payout per booking'
);
select throws_ok(
  $$select public.mark_no_show(pg_temp.paid('2030-03-08 10:00+00'))$$,
  'KT018', 'not_markable',
  'a booking that has not started cannot be a no-show'
);
insert into ids select 'noshow', pg_temp.paid(now() - interval '3 hours');
select public.mark_no_show((select id from ids where k = 'noshow'));
select results_eq(
  $$select p.amount_cents, p.reason from public.payouts p where p.booking_id = (select id from ids where k = 'noshow')$$,
  $$values (3000, 'no_show')$$,
  'a no-show pays the deposit out to the pro'
);
select throws_ok(
  $$select public.mark_honoured((select id from ids where k = 'early'))$$,
  'KT018', 'not_markable',
  'a cancelled booking cannot be marked done'
);
insert into ids select 'unpaid2', pg_temp.kemi('2030-03-09 10:00+00');
select public.confirm_booking((select id from ids where k = 'unpaid2'), 'Eve');
select is(
  public.mark_honoured((select id from ids where k = 'unpaid2')),
  null,
  'mark_honoured without a captured deposit queues nothing'
);

select * from finish();
rollback;
