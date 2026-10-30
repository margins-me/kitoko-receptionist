begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into public.conversations (id, pro_id, kind, channel, external_id, locale)
values ('c3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'client', 'web', 'agent-test', 'en');

select matches(
  (select token from public.conversations where id = 'c3000000-0000-4000-8000-000000000001'),
  '^[0-9a-f]{64}$',
  'a conversation gets an unguessable token'
);
select throws_ok(
  $$insert into public.conversations (pro_id, kind, channel, external_id)
    values ('a0000000-0000-4000-8000-000000000002', 'client', 'web', 'agent-test')$$,
  '23505', null,
  'one conversation per channel, external id, pro and kind'
);

insert into public.conversation_messages (conversation_id, role, content, visible)
values ('c3000000-0000-4000-8000-000000000001', 'user', '[{"type": "text", "text": "[event] payment captured"}]', false);
select results_eq(
  $$select m.pro_id, c.last_message_at = m.created_at
      from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
     where m.conversation_id = 'c3000000-0000-4000-8000-000000000001'$$,
  $$values ('a0000000-0000-4000-8000-000000000002'::uuid, true)$$,
  'a message takes its conversation''s pro and moves last_message_at'
);

insert into public.agent_events (conversation_id, kind, name, input, output, ms)
values ('c3000000-0000-4000-8000-000000000001', 'tool', 'list_services', '{}', '{"ok": true}', 12);
insert into public.agent_events (booking_id, kind, name)
select id, 'paypal', 'capture' from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000003' limit 1;
select results_eq(
  $$select pro_id from public.agent_events where created_at = now() order by id$$,  -- this transaction's rows only
  $$values ('a0000000-0000-4000-8000-000000000002'::uuid), ('a0000000-0000-4000-8000-000000000003'::uuid)$$,
  'an agent event takes the pro of its conversation or booking'
);

-- pending actions
insert into public.pending_actions (id, pro_id, kind, summary, amount_cents, currency, payload)
values ('ac000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000002', 'refund', 'Refund 10 GBP', 1000, 'GBP', '{"paymentId": "x"}');
select results_eq(
  $$select status, decided_at is not null from public.decide_pending_action('ac000000-0000-4000-8000-000000000011', 'confirmed')$$,
  $$values ('confirmed', true)$$,
  'decide_pending_action confirms a pending action'
);
select throws_ok(
  $$select public.decide_pending_action('ac000000-0000-4000-8000-000000000011', 'cancelled')$$,
  'KT032', 'not_pending',
  'a decided action cannot be decided again'
);
select throws_ok(
  $$select public.decide_pending_action('ac000000-0000-4000-8000-000000000011', 'maybe')$$,
  '22023', 'invalid_argument',
  'the decision is confirmed or cancelled'
);
select throws_ok(
  $$select public.decide_pending_action('ac000000-0000-4000-8000-0000000000ff', 'cancelled')$$,
  'P0002', 'pending_action_not_found',
  'an unknown action is reported'
);
insert into public.pending_actions (id, pro_id, kind, summary)
values ('ac000000-0000-4000-8000-000000000012', 'a0000000-0000-4000-8000-000000000002', 'invoice', 'Invoice the balance');
select is(
  (public.decide_pending_action('ac000000-0000-4000-8000-000000000012', 'cancelled')).status,
  'cancelled',
  'decide_pending_action cancels a pending action'
);

-- deleting a conversation keeps the booking
update public.bookings set conversation_id = 'c3000000-0000-4000-8000-000000000001'
 where id = (select id from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000002' limit 1);
delete from public.conversations where id = 'c3000000-0000-4000-8000-000000000001';
select is_empty(
  $$select 1 from public.bookings where conversation_id = 'c3000000-0000-4000-8000-000000000001'$$,
  'a deleted conversation is unlinked from its bookings'
);
select is_empty(
  $$select 1 from public.conversation_messages where conversation_id = 'c3000000-0000-4000-8000-000000000001'$$,
  'and its messages go with it'
);

select * from finish();
rollback;
