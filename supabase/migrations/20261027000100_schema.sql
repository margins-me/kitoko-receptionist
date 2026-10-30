-- Core booking schema, ported from Kitoko (trimmed) and made staff-aware.
-- Money is integer cents. Every write from the apps goes through the security definer functions below;
-- the pro (auth.uid() = pros.id) only reads her own rows.

create extension if not exists btree_gist with schema extensions;
create extension if not exists citext with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------------------------
-- Helpers that tables use (defaults, triggers)
-- ---------------------------------------------------------------------------------------------------------------

create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A booking reference shown to clients: 6 characters, no 0/O/1/I so it reads well over the phone.
create function private.new_booking_ref() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_ref text;
begin
  loop
    -- bytes 0..5 of a v4 uuid are random; 256 is a multiple of 32, so % 32 has no bias
    v_bytes := uuid_send(gen_random_uuid());
    v_ref := '';
    for i in 0..5 loop
      v_ref := v_ref || substr(v_alphabet, get_byte(v_bytes, i) % 32 + 1, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where ref = v_ref);
  end loop;
  return v_ref;
end;
$$;

-- True for the service role, and for direct database sessions (migrations, seed, pgTAP) that carry no JWT and did
-- not switch to anon or authenticated. The role setting is the session's SET ROLE, which security definer keeps.
create function private.is_trusted() returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    case when current_setting('role') in ('anon', 'authenticated') then current_setting('role') else 'service_role' end
  ) = 'service_role'
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------

create table public.pros (
  id uuid primary key references auth.users (id) on delete cascade,
  handle extensions.citext not null unique,
  name text not null check (length(btrim(name)) between 1 and 80),
  bio text,
  trades text[] not null default '{}',
  locale text not null default 'en' check (locale in ('en', 'fr', 'it', 'es', 'pt')),
  page_locale text not null default 'en' check (page_locale in ('en', 'fr', 'it', 'es', 'pt')),
  timezone text not null default 'Europe/Paris'
    constraint pros_timezone_valid check (('2000-01-01 00:00:00+00'::timestamptz at time zone timezone) is not null),
  currency text not null default 'EUR' check (currency in ('EUR', 'GBP')),
  city text,
  area_label text,
  address jsonb check (jsonb_typeof(address) = 'object'),
  hide_address boolean not null default true,
  avatar_path text,
  cover_path text,
  gallery text[] not null default '{}',
  layout text check (layout in ('bandeau', 'plein', 'encadre', 'sans')),
  style text not null default 'epure' check (style ~ '^[a-z]+$'),
  theme text not null default 'craie' check (theme ~ '^[a-z]+$'),
  title_font text check (title_font ~ '^[a-z]+$'),
  cover_focal_x real not null default 0.5 check (cover_focal_x between 0 and 1),
  cover_focal_y real not null default 0.5 check (cover_focal_y between 0 and 1),
  cover_width integer check (cover_width > 0),
  cover_height integer check (cover_height > 0),
  rules jsonb not null check (jsonb_typeof(rules) = 'object'),
  schedule jsonb not null check (jsonb_typeof(schedule) = 'object'),
  whatsapp_e164 text check (whatsapp_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  instagram text check (instagram ~ '^[A-Za-z0-9._]{1,30}$'),
  -- where Payouts sends her money (PayPal sandbox business account)
  paypal_email extensions.citext,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pros_handle_format check (handle::text ~ '^[a-z0-9]([a-z0-9.-]{1,28}[a-z0-9])$'),
  constraint pros_handle_reserved check (handle::text <> all (array[
    '_next', 'admin', 'api', 'app', 'assets', 'auth', 'dashboard', 'en', 'es', 'fr', 'how-it-works', 'it', 'kitoko',
    'login', 'logout', 'mcp', 'pay', 'photos', 'pt', 'static', 'support', 'www'
  ]))
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  color text check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0,
  unique (pro_id, id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  unique (pro_id, id)
);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  category_id uuid,
  name text not null,
  description text,
  photos text[] not null default '{}',
  base_price_cents integer not null check (base_price_cents >= 0),
  base_minutes integer not null check (base_minutes > 0),
  option_groups jsonb not null default '[]' check (jsonb_typeof(option_groups) = 'array'),
  addons jsonb not null default '[]' check (jsonb_typeof(addons) = 'array'),
  conditions jsonb not null default '[]' check (jsonb_typeof(conditions) = 'array'),
  prep_instructions text,
  deposit jsonb check (jsonb_typeof(deposit) = 'object'),
  active boolean not null default true,
  position integer not null default 0,
  unique (pro_id, id),
  foreign key (pro_id, category_id) references public.categories (pro_id, id) on delete set null (category_id)
);

-- Which staff can perform which service. A solo pro has one staff row on every service.
create table public.service_staff (
  pro_id uuid not null,
  service_id uuid not null,
  staff_id uuid not null,
  primary key (service_id, staff_id),
  foreign key (pro_id, service_id) references public.services (pro_id, id) on delete cascade,
  foreign key (pro_id, staff_id) references public.staff (pro_id, id) on delete cascade
);
create index service_staff_staff_idx on public.service_staff (staff_id);

create table public.day_overrides (
  pro_id uuid not null references public.pros (id) on delete cascade,
  day date not null,
  hours jsonb check (jsonb_typeof(hours) = 'object'),
  primary key (pro_id, day)
);

create table public.blocks (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  -- null: the whole business
  staff_id uuid,
  during tstzrange not null check (
    lower_inc(during) and not upper_inc(during) and not lower_inf(during) and not upper_inf(during)
    and isfinite(lower(during)) and isfinite(upper(during))
  ),
  label text,
  created_at timestamptz not null default now(),
  unique (pro_id, id),
  foreign key (pro_id, staff_id) references public.staff (pro_id, id) on delete cascade
);
create index blocks_pro_during_idx on public.blocks using gist (pro_id, during);

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  first_name text not null check (length(btrim(first_name)) between 1 and 80),
  email extensions.citext,
  notes text,
  locale text not null default 'en' check (locale in ('en', 'fr', 'it', 'es', 'pt')),
  created_at timestamptz not null default now(),
  unique (pro_id, id),
  unique (pro_id, phone_e164)
);
create index clients_email_idx on public.clients (pro_id, email) where email is not null;

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique default private.new_booking_ref() check (ref ~ '^[A-HJ-NP-Z2-9]{6}$'),
  pro_id uuid not null references public.pros (id) on delete cascade,
  staff_id uuid not null,
  client_id uuid,
  service_id uuid not null,
  -- foreign key added with public.conversations (20261027000300_agent.sql)
  conversation_id uuid,
  status text not null check (status in ('held', 'confirmed', 'honoured', 'no_show', 'cancelled', 'expired')),
  during tstzrange not null,
  hold_expires_at timestamptz,
  source text not null check (source in ('web', 'whatsapp', 'mcp', 'manual')),
  -- @kitoko/booking SelectionSnapshot and Rules, frozen at booking time
  selection jsonb not null check (jsonb_typeof(selection) = 'object'),
  policy jsonb not null check (jsonb_typeof(policy) = 'object'),
  price_cents integer not null check (price_cents >= 0),
  deposit_cents integer not null check (deposit_cents >= 0),
  -- booking fee paid by the client on top of the deposit (bookingFee in @kitoko/booking)
  fee_cents integer not null default 0 check (fee_cents >= 0),
  currency text not null check (currency in ('EUR', 'GBP')),
  locale text not null default 'en' check (locale in ('en', 'fr', 'it', 'es', 'pt')),
  reschedule_count integer not null default 0 check (reschedule_count >= 0),
  -- set by a sick-day block (block_time) until the booking is rescheduled or cancelled
  displaced_at timestamptz,
  moved_from timestamptz,
  moved_by text check (moved_by in ('client', 'pro', 'system')),
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('client', 'pro', 'system')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pro_id, id),
  foreign key (pro_id, client_id) references public.clients (pro_id, id) on delete restrict,
  foreign key (pro_id, service_id) references public.services (pro_id, id) on delete restrict,
  foreign key (pro_id, staff_id) references public.staff (pro_id, id) on delete restrict,
  constraint bookings_during_valid check (
    lower_inc(during) and not upper_inc(during) and not lower_inf(during) and not upper_inf(during)
    and upper(during) - lower(during) between interval '5 minutes' and interval '16 hours'
  ),
  constraint bookings_deposit_within_price check (deposit_cents <= price_cents),
  constraint bookings_hold_expiry_required check (status <> 'held' or hold_expires_at is not null),
  constraint bookings_client_required check (client_id is not null or status in ('held', 'expired')),
  constraint bookings_cancellation_consistent check (
    (status = 'cancelled') = (cancelled_at is not null) and (cancelled_at is null) = (cancelled_by is null)
  ),
  -- one staff member cannot be in two places at once; two staff can overlap
  constraint bookings_no_overlap exclude using gist (staff_id with =, during with &&)
    where (status in ('held', 'confirmed', 'honoured'))
);
create index bookings_pro_start_idx on public.bookings (pro_id, lower(during));
create index bookings_hold_expiry_idx on public.bookings (hold_expires_at) where status = 'held';
create index bookings_conversation_idx on public.bookings (conversation_id) where conversation_id is not null;
create index bookings_client_idx on public.bookings (pro_id, client_id);

create trigger pros_set_updated_at before update on public.pros
  for each row execute function private.set_updated_at();
create trigger bookings_set_updated_at before update on public.bookings
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------------------------------------------

-- What a cancellation keeps of the paid amount under the policy tiers (cancellationOutcome in @kitoko/booking).
create function private.kept_service_cents(p_policy jsonb, p_starts_at timestamptz, p_at timestamptz, p_service_cents integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select floor(p_service_cents * coalesce(
    case when p_at < p_starts_at then (
      select (t ->> 'keepPercent')::numeric
        from jsonb_array_elements(coalesce(p_policy -> 'cancellation', '[]')) t
       where p_starts_at - p_at >= (t ->> 'minHoursBefore')::numeric * interval '1 hour'
       order by (t ->> 'minHoursBefore')::numeric desc
       limit 1
    ) end,
    100
  ) / 100)::integer
$$;

-- The client of a pro by phone, else by e-mail, else a new one. The first name is required.
create function private.upsert_client(p_pro_id uuid, p_phone text, p_first_name text, p_email text, p_locale text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text := nullif(btrim(p_first_name), '');
  v_email text := nullif(btrim(p_email), '');
  v_locale text := coalesce(p_locale, (select locale from public.pros where id = p_pro_id), 'en');
begin
  if v_name is null then
    raise exception 'first_name_required' using errcode = '22023';
  end if;

  if p_phone is not null then
    insert into public.clients (pro_id, phone_e164, first_name, email, locale)
    values (p_pro_id, p_phone, v_name, v_email, v_locale)
    on conflict (pro_id, phone_e164) do update
      set first_name = excluded.first_name,
          email = coalesce(excluded.email, public.clients.email),
          locale = coalesce(p_locale, public.clients.locale)
    returning id into v_id;
    return v_id;
  end if;

  if v_email is not null then
    select id into v_id
      from public.clients
     where pro_id = p_pro_id and email = v_email::extensions.citext
     order by created_at
     limit 1;
    if found then
      update public.clients set locale = coalesce(p_locale, locale) where id = v_id;
      return v_id;
    end if;
  end if;

  insert into public.clients (pro_id, phone_e164, first_name, email, locale)
  values (p_pro_id, null, v_name, v_email, v_locale)
  returning id into v_id;
  return v_id;
end;
$$;

-- Holds whose time ran out stop counting before anyone else takes their slot (the cron also sweeps them).
create function private.expire_stale_holds(p_pro_id uuid, p_during tstzrange, p_except uuid default null)
returns void
language sql
set search_path = ''
as $$
  update public.bookings
     set status = 'expired'
   where pro_id = p_pro_id
     and status = 'held'
     and hold_expires_at <= now()
     and during && p_during
     and id is distinct from p_except
$$;

-- The first staff member who performs the service and is free (no block, no live booking) over p_during;
-- p_prefer first when she is free. p_ignore: the booking being moved. Null when nobody is free.
create function private.pick_staff(p_pro_id uuid, p_service_id uuid, p_during tstzrange, p_prefer uuid, p_ignore uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select s.id
    from public.service_staff ss
    join public.staff s on s.id = ss.staff_id
   where ss.pro_id = p_pro_id
     and ss.service_id = p_service_id
     and not exists (
       select 1 from public.blocks k
        where k.pro_id = p_pro_id and (k.staff_id is null or k.staff_id = s.id) and k.during && p_during
     )
     and not exists (
       select 1 from public.bookings b
        where b.staff_id = s.id
          and b.id is distinct from p_ignore
          and b.during && p_during
          and (b.status in ('confirmed', 'honoured') or (b.status = 'held' and b.hold_expires_at > now()))
     )
   order by (s.id = p_prefer) desc nulls last, s.position, s.name, s.id
   limit 1
$$;

-- Raised when pick_staff found nobody: blocked when every eligible staff member is blocked, taken otherwise.
create function private.raise_unavailable(p_pro_id uuid, p_service_id uuid, p_during tstzrange)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.service_staff where pro_id = p_pro_id and service_id = p_service_id) then
    raise exception 'no_eligible_staff' using errcode = 'KT030';
  end if;
  if exists (
    select 1 from public.service_staff ss
     where ss.pro_id = p_pro_id and ss.service_id = p_service_id
       and not exists (
         select 1 from public.blocks k
          where k.pro_id = p_pro_id and (k.staff_id is null or k.staff_id = ss.staff_id) and k.during && p_during
       )
  ) then
    raise exception 'slot_taken' using errcode = '23P01';
  end if;
  raise exception 'slot_blocked' using errcode = 'KT001';
end;
$$;

-- A normal block cannot cover a live booking. block_time() (sick day) sets kitoko.block_time for its own insert,
-- after it has marked the bookings it covers as displaced.
create function private.blocks_guard() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.pro_id::text, 0));

  if coalesce(current_setting('kitoko.block_time', true), '') = 'on' then
    return new;
  end if;

  if exists (
    select 1
      from public.bookings b
     where b.pro_id = new.pro_id
       and (new.staff_id is null or b.staff_id = new.staff_id)
       and b.during && new.during
       and (
         (b.status = 'confirmed' and b.displaced_at is null)
         or b.status = 'honoured'
         or (b.status = 'held' and b.hold_expires_at > now())
       )
  ) then
    raise exception 'slot_booked' using errcode = 'KT002';
  end if;

  return new;
end;
$$;

create trigger blocks_guard before insert or update of pro_id, staff_id, during on public.blocks
  for each row execute function private.blocks_guard();

-- ---------------------------------------------------------------------------------------------------------------
-- Public functions
-- ---------------------------------------------------------------------------------------------------------------

create function public.is_live(p_pro_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.pros where id = p_pro_id and published_at is not null)
$$;

-- Bookings (live holds, confirmed, honoured) and blocks over [p_from, p_to), for the slot engine.
-- p_staff_id null: every staff member's. A block's staff_id is null when it closes the whole business.
-- p_from and p_to have defaults only because p_staff_id is optional; both are required.
create function public.busy_intervals(
  p_pro_id uuid,
  p_staff_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (staff_id uuid, during tstzrange)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception 'invalid_range' using errcode = '22023';
  end if;

  if not (public.is_live(p_pro_id) or p_pro_id is not distinct from (select auth.uid()) or private.is_trusted()) then
    return;
  end if;

  return query
    select b.staff_id, b.during
      from public.bookings b
     where b.pro_id = p_pro_id
       and (p_staff_id is null or b.staff_id = p_staff_id)
       and (b.status in ('confirmed', 'honoured') or (b.status = 'held' and b.hold_expires_at > now()))
       and b.during && tstzrange(p_from, p_to, '[)')
    union all
    select k.staff_id, k.during
      from public.blocks k
     where k.pro_id = p_pro_id
       and (p_staff_id is null or k.staff_id is null or k.staff_id = p_staff_id)
       and k.during && tstzrange(p_from, p_to, '[)');
end;
$$;

-- Holds a slot for 15 minutes. p_staff_id null: the first eligible staff member who is free.
-- Raises KT001 blocked, 23P01 taken, KT005 when the conversation already has 3 live holds, KT030 staff not eligible.
-- Every parameter after p_staff_id has a default only because p_staff_id is optional; the required ones are checked.
create function public.create_hold(
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
  v_expires timestamptz := now() + interval '15 minutes';
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

-- Lets go of a hold the agent replaced. Idempotent on an expired hold.
create function public.release_hold(p_booking_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;
  if v_status = 'expired' then
    return;
  end if;
  if v_status <> 'held' then
    raise exception 'not_releasable' using errcode = 'KT003';
  end if;
  update public.bookings set status = 'expired' where id = p_booking_id;
end;
$$;

-- Confirms a hold: upserts the client and moves held -> confirmed. A lapsed hold is re-taken when its slot is still
-- free (with its staff member, else another eligible one). Idempotent on a confirmed booking. Returns the client id.
create function public.confirm_booking(
  p_booking_id uuid,
  p_first_name text,
  p_phone text default null,
  p_email text default null,
  p_locale text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro_id uuid;
  v_b public.bookings;
  v_staff uuid;
  v_client uuid;
begin
  select pro_id into v_pro_id from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_pro_id::text, 0));

  select * into v_b from public.bookings where id = p_booking_id for update;

  if v_b.status = 'confirmed' then
    return v_b.client_id;
  end if;
  if v_b.status not in ('held', 'expired') then
    raise exception 'hold_not_confirmable' using errcode = 'KT003';
  end if;

  v_staff := v_b.staff_id;
  if v_b.status = 'expired' or v_b.hold_expires_at <= now() then
    perform private.expire_stale_holds(v_pro_id, v_b.during, p_booking_id);
    if exists (select 1 from public.blocks k where k.pro_id = v_pro_id and k.staff_id is null and k.during && v_b.during) then
      raise exception 'slot_blocked' using errcode = 'KT001';
    end if;
    v_staff := private.pick_staff(v_pro_id, v_b.service_id, v_b.during, v_b.staff_id, p_booking_id);
    if v_staff is null then
      perform private.raise_unavailable(v_pro_id, v_b.service_id, v_b.during);
    end if;
  end if;

  v_client := private.upsert_client(v_pro_id, p_phone, p_first_name, p_email, coalesce(p_locale, v_b.locale));

  update public.bookings
     set status = 'confirmed',
         hold_expires_at = null,
         staff_id = v_staff,
         client_id = v_client,
         locale = coalesce(p_locale, locale)
   where id = p_booking_id;

  if v_b.conversation_id is not null then
    update public.conversations set client_id = v_client where id = v_b.conversation_id and client_id is null;
  end if;

  return v_client;
end;
$$;

-- Moves a confirmed booking to p_start (same length), keeping its staff member when free, else another eligible
-- one. Clears displaced_at; the deposit stays on the booking. The client's own moves count against the policy's
-- reschedule limit (the notice period is checked by the app); moves after a sick day and the pro's do not.
-- Returns the staff id.
create function public.reschedule_booking(p_booking_id uuid, p_start timestamptz, p_by text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro_id uuid;
  v_b public.bookings;
  v_during tstzrange;
  v_staff uuid;
  v_counts boolean;
begin
  if p_start is null or p_by is null or p_by not in ('client', 'pro', 'system') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  select pro_id into v_pro_id from public.bookings where id = p_booking_id;
  if not found then
    raise exception 'booking_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_pro_id::text, 0));

  select * into v_b from public.bookings where id = p_booking_id for update;

  v_counts := p_by = 'client' and v_b.displaced_at is null;
  if v_b.status <> 'confirmed'
     or (v_counts and v_b.reschedule_count >= coalesce((v_b.policy -> 'reschedule' ->> 'maxCount')::integer, 0)) then
    raise exception 'not_reschedulable' using errcode = 'KT006';
  end if;

  v_during := tstzrange(p_start, p_start + (upper(v_b.during) - lower(v_b.during)), '[)');

  perform private.expire_stale_holds(v_pro_id, v_during);

  if exists (select 1 from public.blocks k where k.pro_id = v_pro_id and k.staff_id is null and k.during && v_during) then
    raise exception 'slot_blocked' using errcode = 'KT001';
  end if;

  v_staff := private.pick_staff(v_pro_id, v_b.service_id, v_during, v_b.staff_id, p_booking_id);
  if v_staff is null then
    perform private.raise_unavailable(v_pro_id, v_b.service_id, v_during);
  end if;

  update public.bookings
     set during = v_during,
         staff_id = v_staff,
         moved_from = lower(v_b.during),
         moved_by = p_by,
         displaced_at = null,
         reschedule_count = reschedule_count + case when v_counts then 1 else 0 end
   where id = p_booking_id;

  return v_staff;
end;
$$;

-- Sick day: blocks p_during (p_staff_id null = the whole business), lets go of the live holds it covers and marks the
-- confirmed bookings it covers as displaced (they keep their slot until rebooked or cancelled). Returns their ids.
create function public.block_time(
  p_pro_id uuid,
  p_staff_id uuid default null,
  p_during tstzrange default null,
  p_label text default null
)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_during is null then
    raise exception 'missing_argument' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pros where id = p_pro_id) then
    raise exception 'pro_not_found' using errcode = 'P0002';
  end if;
  if p_staff_id is not null and not exists (select 1 from public.staff where id = p_staff_id and pro_id = p_pro_id) then
    raise exception 'staff_not_found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_pro_id::text, 0));

  update public.bookings
     set status = 'expired'
   where pro_id = p_pro_id
     and status = 'held'
     and during && p_during
     and (p_staff_id is null or staff_id = p_staff_id);

  update public.bookings
     set displaced_at = now()
   where pro_id = p_pro_id
     and status = 'confirmed'
     and displaced_at is null
     and during && p_during
     and (p_staff_id is null or staff_id = p_staff_id);

  perform set_config('kitoko.block_time', 'on', true);
  insert into public.blocks (pro_id, staff_id, during, label) values (p_pro_id, p_staff_id, p_during, p_label);
  perform set_config('kitoko.block_time', 'off', true);

  return query
    select b.id
      from public.bookings b
     where b.pro_id = p_pro_id
       and b.status = 'confirmed'
       and b.displaced_at is not null
       and b.during && p_during
       and (p_staff_id is null or b.staff_id = p_staff_id)
     order by lower(b.during);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Security: revoke-all baseline (Kitoko 20261019000400_security.sql), then grant back what each role needs
-- ---------------------------------------------------------------------------------------------------------------

alter table public.pros enable row level security;
alter table public.staff enable row level security;
alter table public.categories enable row level security;
alter table public.services enable row level security;
alter table public.service_staff enable row level security;
alter table public.day_overrides enable row level security;
alter table public.blocks enable row level security;
alter table public.clients enable row level security;
alter table public.bookings enable row level security;

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema public from anon, authenticated, public;

alter default privileges in schema public revoke all on tables from anon, authenticated, public;
alter default privileges in schema public revoke all on sequences from anon, authenticated, public;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
-- PUBLIC's execute on new functions is a global default; a per-schema revoke cannot remove it
alter default privileges revoke execute on functions from public;

revoke all on schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant usage on schema private to service_role;
-- the bookings.ref default runs as the inserting role
grant execute on function private.new_booking_ref() to service_role;

grant execute on function public.is_live(uuid) to anon, authenticated, service_role;
grant execute on function public.busy_intervals(uuid, uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function
  public.create_hold(uuid, uuid, uuid, timestamptz, integer, jsonb, jsonb, integer, integer, integer, text, uuid, text),
  public.release_hold(uuid),
  public.confirm_booking(uuid, text, text, text, text),
  public.reschedule_booking(uuid, timestamptz, text),
  public.block_time(uuid, uuid, tstzrange, text)
  to service_role;

-- anon reads live pages: public columns of pros (never paypal_email or address), their staff, services, categories
grant select (
  id, handle, name, bio, trades, locale, page_locale, timezone, currency, city, area_label, hide_address,
  avatar_path, cover_path, gallery, layout, style, theme, title_font, cover_focal_x, cover_focal_y, cover_width,
  cover_height, rules, schedule, whatsapp_e164, instagram, published_at, created_at, updated_at
) on public.pros to anon;
grant select on public.staff, public.categories, public.services, public.service_staff, public.day_overrides to anon;

create policy pros_public_read on public.pros for select to anon using (public.is_live(id));
create policy staff_public_read on public.staff for select to anon using (public.is_live(pro_id));
create policy categories_public_read on public.categories for select to anon using (public.is_live(pro_id));
create policy services_public_read on public.services for select to anon using (active and public.is_live(pro_id));
create policy service_staff_public_read on public.service_staff for select to anon using (public.is_live(pro_id));
create policy day_overrides_public_read on public.day_overrides for select to anon using (public.is_live(pro_id));

-- the pro reads her own rows; she writes through the functions
grant select on
  public.pros, public.staff, public.categories, public.services, public.service_staff, public.day_overrides,
  public.blocks, public.clients, public.bookings
  to authenticated;

create policy pros_own_read on public.pros for select to authenticated using (id = (select auth.uid()));
create policy staff_own_read on public.staff for select to authenticated using (pro_id = (select auth.uid()));
create policy categories_own_read on public.categories for select to authenticated using (pro_id = (select auth.uid()));
create policy services_own_read on public.services for select to authenticated using (pro_id = (select auth.uid()));
create policy service_staff_own_read on public.service_staff for select to authenticated using (pro_id = (select auth.uid()));
create policy day_overrides_own_read on public.day_overrides for select to authenticated using (pro_id = (select auth.uid()));
create policy blocks_own_read on public.blocks for select to authenticated using (pro_id = (select auth.uid()));
create policy clients_own_read on public.clients for select to authenticated using (pro_id = (select auth.uid()));
create policy bookings_own_read on public.bookings for select to authenticated using (pro_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------------------------
-- Cron and Realtime
-- ---------------------------------------------------------------------------------------------------------------

select cron.schedule(
  'expire-holds',
  '* * * * *',
  $$update public.bookings set status = 'expired' where status = 'held' and hold_expires_at <= now()$$
);

-- full rows on update/delete, so the calendar can drop a moved or deleted booking
alter table public.bookings replica identity full;
alter table public.blocks replica identity full;
alter publication supabase_realtime add table public.bookings, public.blocks, public.staff;
