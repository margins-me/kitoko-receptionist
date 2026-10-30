-- Hold length by channel, and one refresh when the deposit page is first opened.
-- create_hold is redefined (same signature, grants kept): the TTL comes from p_source.

-- How long a new hold lasts for a channel: 30 minutes on WhatsApp and MCP, 15 everywhere else (web, manual).
create function private.hold_ttl(p_source text) returns interval
language sql
immutable
set search_path = ''
as $$
  select case when p_source in ('whatsapp', 'mcp') then interval '30 minutes' else interval '15 minutes' end
$$;

-- Holds a slot: 15 minutes on the web, 30 on WhatsApp and MCP (the client switches app to pay, an outside agent hands
-- the approval link to its human). p_staff_id null: the first eligible staff member who is free.
-- Raises KT001 blocked, 23P01 taken, KT005 when the conversation already has 3 live holds, KT030 staff not eligible.
-- Every parameter after p_staff_id has a default only because p_staff_id is optional; the required ones are checked.
create or replace function public.create_hold(
  p_pro_id uuid,
  p_service_id uuid,
  p_staff_id uuid default null,
  p_start timestamptz default null,
  p_minutes integer default null,
  p_selection jsonb default null,
  p_policy jsonb default null,
  p_price_cents integer default null,
  p_deposit_cents integer default null,
  p_fee_cents integer default null,
  p_source text default null,
  p_conversation_id uuid default null,
  p_locale text default null
)
returns table (id uuid, ref text, staff_id uuid, hold_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_during tstzrange;
  v_currency text;
  v_pro_locale text;
  v_staff uuid;
  v_id uuid;
  v_ref text;
  v_expires timestamptz := now() + private.hold_ttl(p_source);
begin
  if p_start is null or p_minutes is null or p_selection is null or p_policy is null or p_price_cents is null
     or p_deposit_cents is null or p_fee_cents is null or p_source is null then
    raise exception 'missing_argument' using errcode = '22023';
  end if;

  select currency, locale into v_currency, v_pro_locale from public.pros where id = p_pro_id;
  if not found then
    raise exception 'pro_not_found' using errcode = 'P0002';
  end if;

  v_during := tstzrange(p_start, p_start + make_interval(mins => p_minutes), '[)');

  perform pg_advisory_xact_lock(hashtextextended(p_pro_id::text, 0));

  if p_conversation_id is not null and (
    select count(*)
      from public.bookings b
     where b.conversation_id = p_conversation_id
       and b.status = 'held'
       and b.hold_expires_at > now()
  ) >= 3 then
    raise exception 'too_many_holds' using errcode = 'KT005';
  end if;

  perform private.expire_stale_holds(p_pro_id, v_during);

  if exists (select 1 from public.blocks k where k.pro_id = p_pro_id and k.staff_id is null and k.during && v_during) then
    raise exception 'slot_blocked' using errcode = 'KT001';
  end if;

  if p_staff_id is not null then
    if not exists (
      select 1 from public.service_staff ss
       where ss.pro_id = p_pro_id and ss.service_id = p_service_id and ss.staff_id = p_staff_id
    ) then
      raise exception 'staff_not_eligible' using errcode = 'KT030';
    end if;
    if exists (select 1 from public.blocks k where k.pro_id = p_pro_id and k.staff_id = p_staff_id and k.during && v_during) then
      raise exception 'slot_blocked' using errcode = 'KT001';
    end if;
    v_staff := p_staff_id;
  else
    v_staff := private.pick_staff(p_pro_id, p_service_id, v_during, null, null);
    if v_staff is null then
      perform private.raise_unavailable(p_pro_id, p_service_id, v_during);
    end if;
  end if;

  -- 23P01 here when the staff member is taken (bookings_no_overlap)
  insert into public.bookings (
    pro_id, staff_id, service_id, conversation_id, status, during, hold_expires_at, source,
    selection, policy, price_cents, deposit_cents, fee_cents, currency, locale
  )
  values (
    p_pro_id, v_staff, p_service_id, p_conversation_id, 'held', v_during, v_expires, p_source,
    p_selection, p_policy, p_price_cents, p_deposit_cents, p_fee_cents, v_currency, coalesce(p_locale, v_pro_locale)
  )
  returning bookings.id, bookings.ref into v_id, v_ref;

  return query select v_id, v_ref, v_staff, v_expires;
end;
$$;

-- The first time the deposit page is opened for a held booking, its hold runs at least 15 more minutes from now
-- (never shortened). Only once per booking: hold_refreshed_at records it. Returns the hold's end (null when the
-- booking is not held, unchanged when it was refreshed before).
alter table public.bookings add column hold_refreshed_at timestamptz;

create function public.refresh_hold_on_open(p_booking_id uuid) returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b public.bookings;
begin
  select * into v_b from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_b.status <> 'held' then
    return null;
  end if;
  if v_b.hold_refreshed_at is not null then
    return v_b.hold_expires_at;
  end if;
  update public.bookings
     set hold_expires_at = greatest(hold_expires_at, now() + interval '15 minutes'),
         hold_refreshed_at = now()
   where id = p_booking_id
  returning hold_expires_at into v_b.hold_expires_at;
  return v_b.hold_expires_at;
end;
$$;

revoke all on function private.hold_ttl(text) from public, anon, authenticated;
revoke all on function public.refresh_hold_on_open(uuid) from public, anon, authenticated;
grant execute on function public.refresh_hold_on_open(uuid) to service_role;
