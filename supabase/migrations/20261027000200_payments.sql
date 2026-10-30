-- PayPal money: deposit payments (Orders v2), refunds, payouts to the pro (Payouts API) and webhook events.
-- Amounts always come from the booking row; the apps never pass an amount to charge.
-- Seed rows use capture ids starting with SEED-: the PayPal client never calls PayPal for those.

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  booking_id uuid not null,
  kind text not null default 'deposit' check (kind in ('deposit', 'balance')),
  paypal_order_id text not null unique,
  capture_id text unique,
  -- what the amount pays for: the deposit (service) and the booking fee Kitoko keeps
  deposit_cents integer not null default 0 check (deposit_cents >= 0),
  fee_cents integer not null default 0 check (fee_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null check (currency in ('EUR', 'GBP')),
  -- includes refunds still being processed
  refunded_cents integer not null default 0,
  status text not null default 'created' check (status in ('created', 'approved', 'captured', 'refunded', 'denied')),
  -- PayPal's payer object (name, email_address, payer_id)
  payer jsonb,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pro_id, id),
  foreign key (pro_id, booking_id) references public.bookings (pro_id, id) on delete cascade,
  constraint payments_refunded_within_amount check (refunded_cents between 0 and amount_cents),
  constraint payments_amount_parts check (kind <> 'deposit' or amount_cents = deposit_cents + fee_cents)
);
create index payments_booking_idx on public.payments (booking_id);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  payment_id uuid not null,
  booking_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null check (currency in ('EUR', 'GBP')),
  -- client_cancel, pro_cancel, system_cancel, slot_lost, duplicate, pro_request
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  paypal_refund_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pro_id, payment_id) references public.payments (pro_id, id) on delete cascade,
  foreign key (pro_id, booking_id) references public.bookings (pro_id, id) on delete cascade
);
create index refunds_payment_idx on public.refunds (payment_id);
create index refunds_booking_idx on public.refunds (booking_id);
create index refunds_pending_idx on public.refunds (created_at) where status = 'pending';

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  booking_id uuid not null,
  -- deposit kept for the pro (never the booking fee)
  amount_cents integer not null check (amount_cents > 0),
  -- the booking fee Kitoko kept on this booking, for display
  fee_cents integer not null default 0 check (fee_cents >= 0),
  currency text not null check (currency in ('EUR', 'GBP')),
  reason text not null check (reason in ('honoured', 'no_show', 'late_cancel')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'succeeded', 'failed', 'unclaimed')),
  payout_batch_id text,
  payout_item_id text unique,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pro_id, booking_id) references public.bookings (pro_id, id) on delete cascade
);
-- one payout per booking: honoured, no-show and late cancellation exclude each other
create unique index payouts_one_per_booking on public.payouts (booking_id);
create index payouts_pending_idx on public.payouts (created_at) where status = 'pending';

-- Webhook events, deduplicated by PayPal's event id
create table public.paypal_events (
  event_id text primary key,
  type text not null,
  resource_id text,
  payload jsonb not null,
  verified boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create trigger payments_set_updated_at before update on public.payments
  for each row execute function private.set_updated_at();
create trigger refunds_set_updated_at before update on public.refunds
  for each row execute function private.set_updated_at();
create trigger payouts_set_updated_at before update on public.payouts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------------------------

-- Queues a refund on a captured payment (reserving it in refunded_cents) and returns its id.
create function private.queue_refund(p_payment public.payments, p_amount_cents integer, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.payments set refunded_cents = refunded_cents + p_amount_cents where id = p_payment.id;
  insert into public.refunds (pro_id, payment_id, booking_id, amount_cents, currency, reason)
  values (p_payment.pro_id, p_payment.id, p_payment.booking_id, p_amount_cents, p_payment.currency, p_reason)
  returning id into v_id;
  return v_id;
end;
$$;

-- The captured deposit of a booking (the first one), or null.
create function private.captured_deposit(p_booking_id uuid)
returns public.payments
language sql
stable
set search_path = ''
as $$
  select *
    from public.payments
   where booking_id = p_booking_id and kind = 'deposit' and status in ('captured', 'refunded')
   order by captured_at nulls last, created_at
   limit 1
$$;

-- Pending payout of the deposit kept for the pro: deposit minus the refunded deposit part. Never the booking fee.
create function private.queue_payout(p_booking_id uuid, p_amount_cents integer, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_p public.payments := private.captured_deposit(p_booking_id);
  v_id uuid;
begin
  if v_p.id is null or p_amount_cents <= 0 then
    return null;
  end if;
  insert into public.payouts (pro_id, booking_id, amount_cents, fee_cents, currency, reason)
  values (v_p.pro_id, p_booking_id, p_amount_cents, v_p.fee_cents, v_p.currency, p_reason)
  on conflict (booking_id) do nothing
  returning id into v_id;
  return coalesce(v_id, (select id from public.payouts where booking_id = p_booking_id));
end;
$$;

create function private.mark_booking(p_booking_id uuid, p_status text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_p public.payments;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found or not (private.is_trusted() or v_b.pro_id is not distinct from (select auth.uid())) then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_b.pro_id::text, 0));
  select * into v_b from public.bookings where id = p_booking_id for update;

  if v_b.status = p_status then
    return (select id from public.payouts where booking_id = p_booking_id);
  end if;
  if v_b.status <> 'confirmed' or (p_status = 'no_show' and lower(v_b.during) > now()) then
    raise exception 'not_markable' using errcode = 'KT018';
  end if;

  update public.bookings set status = p_status, displaced_at = null where id = p_booking_id;

  v_p := private.captured_deposit(p_booking_id);
  if v_p.id is null then
    return null;
  end if;
  return private.queue_payout(p_booking_id, v_p.deposit_cents - least(v_p.refunded_cents, v_p.deposit_cents), p_status);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Booking outcomes
-- ---------------------------------------------------------------------------------------------------------------

-- Cancels a confirmed booking and works out the money from the policy snapshot:
-- by the client inside the free window: deposit refunded, booking fee kept;
-- by the client late: the policy tiers decide what is kept (kept_service_cents), the rest of the deposit is refunded
--   and the kept part is queued as a payout to the pro;
-- by the pro or the system (e.g. the client declines a sick-day move): everything refunded, booking fee included.
-- Without a captured payment nothing is refunded. Returns the refund queued and the deposit kept.
create function public.cancel_booking(p_booking_id uuid, p_by text, p_reason text default null)
returns table (refund_cents integer, kept_cents integer)
language plpgsql
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

  perform pg_advisory_xact_lock(hashtextextended(v_b.pro_id::text, 0));
  select * into v_b from public.bookings where id = p_booking_id for update;

  if v_b.status <> 'confirmed' then
    raise exception 'not_cancellable' using errcode = 'KT007';
  end if;

  update public.bookings
     set status = 'cancelled',
         cancelled_at = now(),
         cancelled_by = p_by,
         cancel_reason = p_reason,
         displaced_at = null
   where id = p_booking_id;

  select * into v_p
    from public.payments
   where booking_id = p_booking_id and kind = 'deposit' and status = 'captured'
   order by captured_at nulls last, created_at
   limit 1
     for update;

  if found then
    if p_by = 'client' then
      v_kept := private.kept_service_cents(v_b.policy, lower(v_b.during), now(), v_p.deposit_cents);
      v_refund := v_p.deposit_cents - v_kept;
    else
      v_refund := v_p.amount_cents;
    end if;
    v_refund := greatest(least(v_refund, v_p.amount_cents - v_p.refunded_cents), 0);

    if v_refund > 0 then
      perform private.queue_refund(v_p, v_refund, coalesce(p_reason, p_by || '_cancel'));
    end if;
    if v_kept > 0 then
      perform private.queue_payout(p_booking_id, v_kept, 'late_cancel');
    end if;
  end if;

  return query select v_refund, v_kept;
end;
$$;

-- The pro (auth.uid()) or the service role marks a confirmed booking done or no-show. Queues the payout of the
-- deposit to her. Idempotent. Returns the payout id (null without a captured deposit).
create function public.mark_honoured(p_booking_id uuid) returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.mark_booking(p_booking_id, 'honoured');
$$;

create function public.mark_no_show(p_booking_id uuid) returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.mark_booking(p_booking_id, 'no_show');
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- PayPal
-- ---------------------------------------------------------------------------------------------------------------

-- Records the PayPal order created for a held booking's deposit. Amounts come from the booking row.
-- Idempotent for the same order. Returns the payment id.
create function public.paypal_prepare(p_booking_id uuid, p_order_id text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
  v_existing public.payments;
  v_id uuid;
begin
  select * into v_b from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  select * into v_existing from public.payments where paypal_order_id = p_order_id;
  if found then
    if v_existing.booking_id <> p_booking_id then
      raise exception 'order_of_another_booking' using errcode = '22023';
    end if;
    return v_existing.id;
  end if;

  if v_b.status not in ('held', 'expired') or v_b.deposit_cents + v_b.fee_cents = 0
     or (private.captured_deposit(p_booking_id)).id is not null then
    raise exception 'not_payable' using errcode = 'KT011';
  end if;

  insert into public.payments (pro_id, booking_id, kind, paypal_order_id, deposit_cents, fee_cents, amount_cents, currency)
  values (v_b.pro_id, p_booking_id, 'deposit', p_order_id, v_b.deposit_cents, v_b.fee_cents,
          v_b.deposit_cents + v_b.fee_cents, v_b.currency)
  returning id into v_id;
  return v_id;
end;
$$;

-- PAYMENT.CAPTURE.COMPLETED (or the capture on return from PayPal). Idempotent. Checks the amount and currency
-- against the payment, then confirms the booking: with the conversation's client when known, else the payer's name
-- and e-mail (and the WhatsApp number). Outcome:
--   confirmed         the booking is confirmed
--   already_captured  this order was already processed
--   slot_lost         the slot went meanwhile: booking expired, full refund queued (reason slot_lost)
--   duplicate         the booking was already paid by another order: full refund queued (reason duplicate)
create function public.paypal_capture_completed(
  p_order_id text,
  p_capture_id text,
  p_amount_cents integer,
  p_currency text,
  p_payer jsonb default null
)
returns table (payment_id uuid, booking_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_p public.payments;
  v_b public.bookings;
  v_first text;
  v_phone text;
  v_email text;
  v_client public.clients;
  v_channel text;
  v_external text;
begin
  select * into v_p from public.payments where paypal_order_id = p_order_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_p.pro_id::text, 0));
  select * into v_p from public.payments where id = v_p.id for update;

  if v_p.status in ('captured', 'refunded') then
    return query select v_p.id, v_p.booking_id, 'already_captured'::text;
    return;
  end if;

  if p_amount_cents is distinct from v_p.amount_cents or upper(coalesce(p_currency, '')) <> v_p.currency then
    raise exception 'amount_mismatch' using errcode = 'KT031';
  end if;

  update public.payments
     set status = 'captured',
         capture_id = p_capture_id,
         payer = p_payer,
         captured_at = now()
   where id = v_p.id
  returning * into v_p;

  if exists (
    select 1 from public.payments
     where booking_id = v_p.booking_id and id <> v_p.id and kind = 'deposit' and status in ('captured', 'refunded')
  ) then
    perform private.queue_refund(v_p, v_p.amount_cents, 'duplicate');
    return query select v_p.id, v_p.booking_id, 'duplicate'::text;
    return;
  end if;

  select * into v_b from public.bookings where id = v_p.booking_id for update;

  if v_b.status = 'confirmed' then
    return query select v_p.id, v_p.booking_id, 'confirmed'::text;
    return;
  end if;

  if v_b.status in ('held', 'expired') then
    select c.channel, c.external_id into v_channel, v_external
      from public.conversations c
     where c.id = v_b.conversation_id;
    select cl.* into v_client
      from public.conversations c
      join public.clients cl on cl.id = c.client_id
     where c.id = v_b.conversation_id;

    v_email := nullif(btrim(p_payer ->> 'email_address'), '');
    if v_client.id is not null then
      v_first := v_client.first_name;
      v_phone := v_client.phone_e164;
      if v_client.phone_e164 is null and v_client.email is null and v_email is not null then
        update public.clients set email = v_email where id = v_client.id;
      end if;
      v_email := coalesce(v_client.email::text, v_email);
    else
      v_first := coalesce(nullif(btrim(p_payer -> 'name' ->> 'given_name'), ''), 'Client');
      if v_channel = 'whatsapp' and '+' || ltrim(v_external, '+') ~ '^\+[1-9][0-9]{6,14}$' then
        v_phone := '+' || ltrim(v_external, '+');
      end if;
    end if;

    begin
      perform public.confirm_booking(v_b.id, v_first, v_phone, v_email, null);
      return query select v_p.id, v_p.booking_id, 'confirmed'::text;
      return;
    exception when sqlstate '23P01' or sqlstate 'KT001' or sqlstate 'KT030' then
      null;
    end;
  end if;

  -- the slot is gone (or the booking was closed meanwhile): give everything back
  update public.bookings set status = 'expired' where id = v_b.id and status = 'held';
  perform private.queue_refund(v_p, v_p.amount_cents, 'slot_lost');
  return query select v_p.id, v_p.booking_id, 'slot_lost'::text;
end;
$$;

-- PAYMENT.CAPTURE.DENIED (or a declined capture): the payment is denied and its hold lets go of the slot.
create function public.paypal_capture_denied(p_order_id text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
begin
  select * into v_p from public.payments where paypal_order_id = p_order_id for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_p.status not in ('created', 'approved') then
    return;
  end if;
  update public.payments set status = 'denied' where id = v_p.id;
  update public.bookings set status = 'expired' where id = v_p.booking_id and status = 'held';
end;
$$;

-- A refund the pro confirmed (pending action) on a captured payment. Raises KT012 above what is left to refund.
create function public.request_refund(p_payment_id uuid, p_amount_cents integer, p_reason text default 'pro_request')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.payments;
begin
  select * into v_p from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_p.status <> 'captured' then
    raise exception 'not_refundable' using errcode = 'KT033';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 or p_amount_cents > v_p.amount_cents - v_p.refunded_cents then
    raise exception 'exceeds_balance' using errcode = 'KT012';
  end if;
  return private.queue_refund(v_p, p_amount_cents, coalesce(p_reason, 'pro_request'));
end;
$$;

-- The PayPal refund call finished. succeeded: the payment becomes refunded once fully refunded; failed: the amount is
-- released from refunded_cents. Idempotent for the same status.
-- p_status has a default only because p_paypal_refund_id is optional (none on a failure); it is required.
create function public.refund_finished(p_refund_id uuid, p_paypal_refund_id text default null, p_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.refunds;
begin
  if p_status is null or p_status not in ('succeeded', 'failed') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  select * into v_r from public.refunds where id = p_refund_id for update;
  if not found then
    raise exception 'refund_not_found' using errcode = 'P0002';
  end if;
  if v_r.status = p_status then
    update public.refunds set paypal_refund_id = coalesce(paypal_refund_id, p_paypal_refund_id) where id = p_refund_id;
    return;
  end if;
  if v_r.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'KT032';
  end if;

  update public.refunds
     set status = p_status,
         paypal_refund_id = coalesce(p_paypal_refund_id, paypal_refund_id)
   where id = p_refund_id;

  if p_status = 'failed' then
    update public.payments set refunded_cents = refunded_cents - v_r.amount_cents where id = v_r.payment_id;
  else
    update public.payments p
       set status = 'refunded'
     where p.id = v_r.payment_id
       and p.status = 'captured'
       and p.refunded_cents = p.amount_cents
       and not exists (select 1 from public.refunds r where r.payment_id = p.id and r.status = 'pending');
  end if;
end;
$$;

-- A payout went out in a Payouts batch.
create function public.payout_sent(p_payout_id uuid, p_batch_id text, p_item_id text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payouts
     set status = case when status in ('pending', 'failed') then 'sent' else status end,
         payout_batch_id = p_batch_id,
         payout_item_id = coalesce(p_item_id, payout_item_id),
         sent_at = coalesce(sent_at, now())
   where id = p_payout_id;
  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- PAYMENT.PAYOUTS-ITEM.* webhooks (or a status poll) by payout item id.
create function public.payout_status(p_item_id text, p_status text) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('pending', 'sent', 'succeeded', 'failed', 'unclaimed') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;
  update public.payouts set status = p_status where payout_item_id = p_item_id;
  if not found then
    raise exception 'payout_not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Stores a webhook event once. False when it was already seen (PayPal retries).
create function public.record_paypal_event(
  p_event_id text,
  p_type text,
  p_resource_id text default null,
  p_payload jsonb default '{}',
  p_verified boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.paypal_events (event_id, type, resource_id, payload, verified)
  values (p_event_id, p_type, p_resource_id, coalesce(p_payload, '{}'), coalesce(p_verified, false))
  on conflict (event_id) do nothing;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.payouts enable row level security;
alter table public.paypal_events enable row level security;

revoke all on public.payments, public.refunds, public.payouts, public.paypal_events from anon, authenticated, public;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.payments, public.refunds, public.payouts to authenticated;
create policy payments_own_read on public.payments for select to authenticated using (pro_id = (select auth.uid()));
create policy refunds_own_read on public.refunds for select to authenticated using (pro_id = (select auth.uid()));
create policy payouts_own_read on public.payouts for select to authenticated using (pro_id = (select auth.uid()));

grant execute on function public.is_live(uuid) to anon, authenticated, service_role;
grant execute on function public.busy_intervals(uuid, uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.mark_honoured(uuid), public.mark_no_show(uuid) to authenticated, service_role;
grant execute on function
  public.cancel_booking(uuid, text, text),
  public.paypal_prepare(uuid, text),
  public.paypal_capture_completed(text, text, integer, text, jsonb),
  public.paypal_capture_denied(text),
  public.request_refund(uuid, integer, text),
  public.refund_finished(uuid, text, text),
  public.payout_sent(uuid, text, text),
  public.payout_status(text, text),
  public.record_paypal_event(text, text, text, jsonb, boolean)
  to service_role;

alter publication supabase_realtime add table public.payments, public.payouts;
