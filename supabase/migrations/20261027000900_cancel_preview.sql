-- What cancel_booking would do right now, without doing it: the client agent states the exact outcome (refund, deposit
-- kept, booking fee kept) and cancels only after the client confirms in a later message. Same arithmetic as
-- cancel_booking (20261027000200_payments.sql), read-only.

create function public.preview_cancel(p_booking_id uuid, p_by text)
returns table (refund_cents integer, kept_cents integer, fee_kept_cents integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_p public.payments;
  v_refund integer := 0;
  v_kept integer := 0;
begin
  if p_by is null or p_by not in ('client', 'pro', 'system') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  select * into v_b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_b.status <> 'confirmed' then
    raise exception 'not_cancellable' using errcode = 'KT007';
  end if;

  select * into v_p
    from public.payments
   where booking_id = p_booking_id and kind = 'deposit' and status = 'captured'
   order by captured_at nulls last, created_at
   limit 1;

  if not found then
    return query select 0, 0, 0;
    return;
  end if;

  if p_by = 'client' then
    v_kept := private.kept_service_cents(v_b.policy, lower(v_b.during), now(), v_p.deposit_cents);
    v_refund := v_p.deposit_cents - v_kept;
  else
    v_refund := v_p.amount_cents;
  end if;
  v_refund := greatest(least(v_refund, v_p.amount_cents - v_p.refunded_cents), 0);

  return query select v_refund, v_kept, greatest(v_p.amount_cents - v_p.refunded_cents - v_refund - v_kept, 0);
end;
$$;

revoke all on function public.preview_cancel(uuid, text) from public, anon, authenticated;
grant execute on function public.preview_cancel(uuid, text) to service_role;
