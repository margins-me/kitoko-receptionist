begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is_empty(
  $$select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity$$,
  'every table in public has RLS enabled'
);

select results_eq(
  $$select p.proname::text collate "default"
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     order by 1$$,
  array['busy_intervals', 'is_live'],
  'anon can execute only the public page helpers'
);

select results_eq(
  $$select p.proname::text collate "default"
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
     order by 1$$,
  array['busy_intervals', 'decide_pending_action', 'is_live', 'mark_honoured', 'mark_no_show', 'reset_demo'],
  'authenticated can execute only the pro functions'
);

select is_empty(
  $$select p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and has_function_privilege('authenticated', p.oid, 'execute')
       and not p.prosecdef$$,
  'every function a pro can call is security definer, so it checks ownership itself'
);

select is_empty(
  $$select c.relname
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'S')
       and (has_table_privilege('anon', c.oid, 'insert, update, delete, truncate')
         or has_table_privilege('authenticated', c.oid, 'insert, update, delete, truncate, references, trigger'))$$,
  'anon and authenticated cannot write anywhere: writes go through the functions'
);

select is_empty(
  $$select p.proname
      from pg_proc p
     where p.pronamespace = 'private'::regnamespace
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
         or has_schema_privilege('anon', 'private', 'usage') or has_schema_privilege('authenticated', 'private', 'usage'))$$,
  'anon and authenticated cannot reach the private helpers'
);

select is_empty(
  $$select p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.prokind = 'f'
       and not has_function_privilege('service_role', p.oid, 'execute')$$,
  'the service role can execute every public function'
);

select * from finish();
rollback;
