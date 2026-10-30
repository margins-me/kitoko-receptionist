begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- preview_cancel (20261027000900_cancel_preview.sql) returns what cancel_booking would do, and changes nothing.
-- Kemi: deposit 30 GBP + 1.50 booking fee; policy: free until 48 h before, then 100 % kept.
create function pg_temp.paid(p_start timestamptz)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.create_hold(
    'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null, p_start, 60,
    '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}'::jsonb,
    (select rules from public.pros where id = 'a0000000-0000-4000-8000-000000000002'), 4500, 3000, 150, 'web', null, null
  );
  perform public.paypal_prepare(v_id, 'ORDER-' || v_id);
  perform public.paypal_capture_completed('ORDER-' || v_id, 'CAP-' || v_id, 3150, 'GBP', '{"name": {"given_name": "Test"}}');
  return v_id;
end;
$$;

create temp table ids (k text primary key, id uuid not null);

-- The late cases sit a day or two from now, where Kemi's demo week may have a booking: clear her live ones (rolled back).
update public.bookings set status = 'cancelled', cancelled_at = now(), cancelled_by = 'system', hold_expires_at = null, displaced_at = null
 where pro_id = 'a0000000-0000-4000-8000-000000000002' and status in ('held', 'confirmed', 'honoured');
insert into ids select 'early', pg_temp.paid('2030-04-02 10:00+00');
insert into ids select 'late', pg_temp.paid(date_trunc('hour', now()) + interval '26 hours');

select results_eq(
  $$select refund_cents, kept_cents, fee_kept_cents from public.preview_cancel((select id from ids where k = 'early'), 'client')$$,
  $$values (3000, 0, 150)$$,
  'client, free window: deposit refunded, booking fee kept'
);
select results_eq(
  $$select refund_cents, kept_cents, fee_kept_cents from public.preview_cancel((select id from ids where k = 'late'), 'client')$$,
  $$values (0, 3000, 150)$$,
  'client, late: the deposit is kept under the policy'
);
select results_eq(
  $$select refund_cents, kept_cents, fee_kept_cents from public.preview_cancel((select id from ids where k = 'late'), 'pro')$$,
  $$values (3150, 0, 0)$$,
  'pro: everything refunded, booking fee included'
);
select is(
  (select status || ' ' || (select count(*) from public.refunds r where r.booking_id = b.id) from public.bookings b where id = (select id from ids where k = 'early')),
  'confirmed 0',
  'a preview cancels nothing and queues no refund'
);
select results_eq(
  $$select refund_cents, kept_cents from public.cancel_booking((select id from ids where k = 'early'), 'client')$$,
  $$values (3000, 0)$$,
  'cancel_booking then does exactly what the preview said'
);
select throws_ok(
  $$select * from public.preview_cancel((select id from ids where k = 'early'), 'client')$$,
  'KT007', 'not_cancellable',
  'a cancelled booking has nothing to preview'
);

set local role authenticated;
select throws_ok(
  $$select * from public.preview_cancel((select id from ids where k = 'late'), 'client')$$,
  '42501', null,
  'only the service role may preview'
);

select * from finish();
rollback;
