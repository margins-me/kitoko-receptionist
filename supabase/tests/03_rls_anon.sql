begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email)
values ('a0000000-0000-4000-8000-0000000000f1', 'unpublished@demo.kitoko.page');
insert into public.pros (id, handle, name, rules, schedule, published_at)
values ('a0000000-0000-4000-8000-0000000000f1', 'test-unpublished', 'Unpublished', '{}', '{}', null);
insert into public.staff (id, pro_id, name)
values ('5a000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'Hidden');
insert into public.categories (pro_id, name) values ('a0000000-0000-4000-8000-0000000000f1', 'Hidden');
insert into public.services (pro_id, name, base_price_cents, base_minutes, active)
values
  ('a0000000-0000-4000-8000-0000000000f1', 'Hidden service', 1000, 60, true),
  ('a0000000-0000-4000-8000-000000000002', 'Inactive service', 1000, 60, false);
insert into public.blocks (pro_id, during)
values ('a0000000-0000-4000-8000-0000000000f1', tstzrange('2030-01-14 10:00+00', '2030-01-14 11:00+00', '[)'));
insert into public.blocks (pro_id, during, label)
values ('a0000000-0000-4000-8000-000000000002', tstzrange('2030-01-16 09:00+00', '2030-01-16 10:00+00', '[)'), 'Training');

set local role anon;

select results_eq(
  $$select handle::text from public.pros order by 1$$,
  array['aicha.braids', 'anta.tresses', 'kemi.nails', 'studio-nala'],
  'anon sees exactly the published pros'
);
select throws_ok(
  $$select paypal_email from public.pros$$,
  '42501', 'permission denied for table pros',
  'anon cannot read pros.paypal_email'
);
select throws_ok(
  $$select address from public.pros$$,
  '42501', 'permission denied for table pros',
  'anon cannot read pros.address'
);
select lives_ok(
  $$select handle, name, rules, schedule, currency, city, theme, layout, title_font, whatsapp_e164 from public.pros$$,
  'anon can read the public columns of pros'
);

select throws_ok($$select 1 from public.bookings$$, '42501', 'permission denied for table bookings', 'anon cannot read bookings');
select throws_ok($$select 1 from public.clients$$, '42501', 'permission denied for table clients', 'anon cannot read clients');
select throws_ok($$select 1 from public.blocks$$, '42501', 'permission denied for table blocks', 'anon cannot read blocks');
select throws_ok($$select 1 from public.payments$$, '42501', 'permission denied for table payments', 'anon cannot read payments');
select throws_ok($$select 1 from public.conversations$$, '42501', 'permission denied for table conversations', 'anon cannot read conversations');
select throws_ok(
  $$select 1 from public.conversation_messages$$, '42501', 'permission denied for table conversation_messages',
  'anon cannot read conversation messages'
);
select throws_ok($$select 1 from public.paypal_events$$, '42501', 'permission denied for table paypal_events', 'anon cannot read paypal_events');

select isnt_empty(
  $$select 1 from public.services where pro_id = 'a0000000-0000-4000-8000-000000000003'$$,
  'anon sees the services of a live pro'
);
select is_empty($$select 1 from public.services where name = 'Inactive service'$$, 'anon cannot see an inactive service');
select is_empty(
  $$select 1 from public.services where pro_id = 'a0000000-0000-4000-8000-0000000000f1'$$,
  'anon cannot see the services of an unpublished pro'
);
select results_eq(
  $$select name from public.staff where pro_id = 'a0000000-0000-4000-8000-000000000001' order by position$$,
  array['Nala', 'Sira'],
  'anon sees the staff of a live pro'
);
select is_empty($$select 1 from public.staff where pro_id = 'a0000000-0000-4000-8000-0000000000f1'$$, 'anon cannot see the staff of an unpublished pro');
select isnt_empty(
  $$select 1 from public.service_staff where pro_id = 'a0000000-0000-4000-8000-000000000001'$$,
  'anon sees who performs which service'
);
select throws_ok(
  $$insert into public.categories (pro_id, name) values ('a0000000-0000-4000-8000-000000000002', 'x')$$,
  '42501', 'permission denied for table categories',
  'anon cannot write to categories'
);
select throws_ok(
  $$select * from public.create_hold('a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021')$$,
  '42501', null,
  'anon cannot hold a slot directly'
);

select ok(public.is_live('a0000000-0000-4000-8000-000000000003'), 'is_live is true for a published pro');
select results_eq(
  $$select during from public.busy_intervals('a0000000-0000-4000-8000-000000000002', null,
      '2030-01-16 00:00+00', '2030-01-17 00:00+00')$$,
  $$values (tstzrange('2030-01-16 09:00+00', '2030-01-16 10:00+00', '[)'))$$,
  'busy_intervals shows a live pro''s blocks to anon'
);
select is_empty(
  $$select * from public.busy_intervals('a0000000-0000-4000-8000-0000000000f1', null,
      '2030-01-14 00:00+00', '2030-01-15 00:00+00')$$,
  'busy_intervals shows nothing of an unpublished pro to anon'
);

select * from finish();
rollback;
