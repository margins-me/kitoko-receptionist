-- A declined capture (PayPal 422 INSTRUMENT_DECLINED) leaves the booking held: the buyer approves the same order again
-- with another funding source, and the next capture must not reuse the declined call's PayPal-Request-Id (PayPal
-- replays the stored answer for a request id it has seen, so the retry would be "declined" again). The app sends
-- capture-{order} first, then capture-{order}-{n} after n declines.

alter table public.payments add column capture_declines integer not null default 0 check (capture_declines >= 0);

-- Counts one declined capture of an order still waiting for payment. The payment stays created/approved and the
-- booking stays held (its hold timer is unchanged). Returns the new count, or null when the payment is no longer
-- waiting (captured meanwhile, denied).
create function public.paypal_capture_declined(p_order_id text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payments
     set capture_declines = capture_declines + 1
   where paypal_order_id = p_order_id and status in ('created', 'approved')
  returning capture_declines into v_count;
  if not found and not exists (select 1 from public.payments where paypal_order_id = p_order_id) then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  return v_count;
end;
$$;

revoke all on function public.paypal_capture_declined(text) from public, anon, authenticated;
grant execute on function public.paypal_capture_declined(text) to service_role;
