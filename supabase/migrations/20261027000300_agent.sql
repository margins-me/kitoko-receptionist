-- Conversations with the agents (web chat, WhatsApp, MCP), their messages, the agents' tool calls and the money
-- actions the pro asked her assistant for. Written by the service role; the pro reads her own rows.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  kind text not null check (kind in ('client', 'pro')),
  channel text not null check (channel in ('web', 'whatsapp', 'mcp')),
  -- web: the token; whatsapp: the wa_id (phone digits); mcp: the session
  external_id text not null,
  client_id uuid,
  locale text not null default 'en' check (locale in ('en', 'fr', 'it', 'es', 'pt')),
  -- unguessable: reopens a web chat
  token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    check (length(token) >= 16),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, external_id, pro_id, kind),
  unique (pro_id, id),
  foreign key (pro_id, client_id) references public.clients (pro_id, id) on delete set null (client_id)
);
create index conversations_pro_idx on public.conversations (pro_id, last_message_at desc nulls last);

create table public.conversation_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  -- copied from the conversation (trigger), for RLS and Realtime filters
  pro_id uuid references public.pros (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Anthropic content blocks (or a plain string)
  content jsonb not null check (jsonb_typeof(content) in ('array', 'string')),
  -- false: a system event injected for the agent ("[event] ..."), not shown in the chat
  visible boolean not null default true,
  created_at timestamptz not null default now()
);
create index conversation_messages_conversation_idx on public.conversation_messages (conversation_id, id);

create table public.agent_events (
  id bigint generated always as identity primary key,
  -- copied from the conversation or booking when omitted (trigger); null for a call about no pro (MCP search)
  pro_id uuid references public.pros (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  -- tool: a tool call and its result; model: a model turn; paypal: a PayPal call or webhook; error; system
  kind text not null default 'tool' check (kind in ('tool', 'model', 'paypal', 'error', 'system')),
  name text not null,
  input jsonb,
  output jsonb,
  ms integer check (ms >= 0),
  created_at timestamptz not null default now()
);
create index agent_events_conversation_idx on public.agent_events (conversation_id, id) where conversation_id is not null;
create index agent_events_booking_idx on public.agent_events (booking_id, id) where booking_id is not null;
create index agent_events_pro_idx on public.agent_events (pro_id, id);

-- Refunds, payouts and invoices the pro asked her assistant for. Only a human (dashboard button, WhatsApp button
-- reply) confirms one, never the model; the money moves in app code after decide_pending_action.
create table public.pending_actions (
  id uuid primary key default gen_random_uuid(),
  pro_id uuid not null references public.pros (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  booking_id uuid,
  kind text not null check (kind in ('refund', 'payout', 'invoice')),
  -- what the confirm button says
  summary text not null,
  amount_cents integer check (amount_cents >= 0),
  currency text check (currency in ('EUR', 'GBP')),
  -- what the app needs to carry it out (payment id, invoice lines...)
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  decided_at timestamptz,
  -- what the app did after the decision (refund id, invoice id, error)
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (pro_id, booking_id) references public.bookings (pro_id, id) on delete cascade
);
create index pending_actions_pro_idx on public.pending_actions (pro_id, created_at desc);

alter table public.bookings
  add constraint bookings_conversation_fkey foreign key (conversation_id)
  references public.conversations (id) on delete set null;

create trigger conversations_set_updated_at before update on public.conversations
  for each row execute function private.set_updated_at();
create trigger pending_actions_set_updated_at before update on public.pending_actions
  for each row execute function private.set_updated_at();

create function private.message_defaults() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select pro_id into new.pro_id from public.conversations where id = new.conversation_id;
  update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end;
$$;

create trigger conversation_messages_defaults before insert on public.conversation_messages
  for each row execute function private.message_defaults();

create function private.agent_event_defaults() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.pro_id := coalesce(
    new.pro_id,
    (select pro_id from public.conversations where id = new.conversation_id),
    (select pro_id from public.bookings where id = new.booking_id)
  );
  return new;
end;
$$;

create trigger agent_events_defaults before insert on public.agent_events
  for each row execute function private.agent_event_defaults();

-- The pro (auth.uid()) or the service role (WhatsApp button reply) confirms or cancels a pending action. Only flips
-- the status, once: KT032 when it is no longer pending. Returns the updated row.
create function public.decide_pending_action(p_id uuid, p_decision text)
returns public.pending_actions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.pending_actions;
begin
  if p_decision is null or p_decision not in ('confirmed', 'cancelled') then
    raise exception 'invalid_argument' using errcode = '22023';
  end if;

  select * into v_a from public.pending_actions where id = p_id for update;
  if not found or not (private.is_trusted() or v_a.pro_id is not distinct from (select auth.uid())) then
    raise exception 'pending_action_not_found' using errcode = 'P0002';
  end if;
  if v_a.status <> 'pending' then
    raise exception 'not_pending' using errcode = 'KT032';
  end if;

  update public.pending_actions
     set status = p_decision,
         decided_at = now()
   where id = p_id
  returning * into v_a;
  return v_a;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.agent_events enable row level security;
alter table public.pending_actions enable row level security;

revoke all on public.conversations, public.conversation_messages, public.agent_events, public.pending_actions
  from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant select on public.conversations, public.conversation_messages, public.agent_events, public.pending_actions
  to authenticated;
create policy conversations_own_read on public.conversations
  for select to authenticated using (pro_id = (select auth.uid()));
create policy conversation_messages_own_read on public.conversation_messages
  for select to authenticated using (pro_id = (select auth.uid()));
create policy agent_events_own_read on public.agent_events
  for select to authenticated using (pro_id = (select auth.uid()));
create policy pending_actions_own_read on public.pending_actions
  for select to authenticated using (pro_id = (select auth.uid()));

grant execute on function public.is_live(uuid) to anon, authenticated, service_role;
grant execute on function public.busy_intervals(uuid, uuid, timestamptz, timestamptz) to anon, authenticated, service_role;
grant execute on function public.mark_honoured(uuid), public.mark_no_show(uuid) to authenticated, service_role;
grant execute on function public.decide_pending_action(uuid, text) to authenticated, service_role;

alter publication supabase_realtime add table
  public.conversation_messages, public.agent_events, public.pending_actions;
