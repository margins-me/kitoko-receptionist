begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

do $$
begin
  create extension if not exists dblink with schema extensions;
exception when others then
  null;
end;
$$;

-- the two competing holds need their own committed transactions, so they run over dblink;
-- a non-superuser dblink must authenticate by password, which local pg_hba only asks for off loopback
create function pg_temp.parallel_holds()
returns setof text
language plpgsql
as $f$
declare
  v_conn text;
  v_slot text := $s$tstzrange('2030-02-04 10:00+00', '2030-02-04 11:30+00', '[)')$s$;
  v_call text;
  v_cleanup text;
  v_a uuid;
  v_b_state text := 'ok';
  v_count bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'dblink')
     or inet_server_addr() is null
     or host(inet_server_addr()) in ('127.0.0.1', '::1') then
    return next skip('dblink cannot open a password-authenticated connection back to this database', 4);
    return;
  end if;

  v_conn := format(
    'host=%s port=%s dbname=%s user=postgres password=postgres',
    host(inet_server_addr()), inet_server_port(), current_database()
  );
  v_call := format(
    $q$select id from public.create_hold(
      'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000021', null,
      lower(%1$s), 90, '{"selection":{"options":{},"addons":[],"conditionsAccepted":true},"lines":[]}', '{}',
      4500, 3000, 150, 'web', null, null)$q$,
    v_slot
  );
  v_cleanup := format(
    $q$delete from public.bookings where pro_id = 'a0000000-0000-4000-8000-000000000002' and during && %s$q$,
    v_slot
  );

  perform extensions.dblink_exec(v_conn, v_cleanup);
  perform extensions.dblink_connect('kt_a', v_conn);
  perform extensions.dblink_connect('kt_b', v_conn);
  perform extensions.dblink_exec('kt_a', 'begin');
  perform extensions.dblink_exec('kt_b', 'begin');

  select id into v_a from extensions.dblink('kt_a', v_call) as t(id uuid);
  perform extensions.dblink_send_query('kt_b', v_call);
  perform pg_sleep(0.5);
  return next ok(extensions.dblink_is_busy('kt_b') = 1, 'the second hold waits for the first one''s transaction');

  perform extensions.dblink_exec('kt_a', 'commit');
  begin
    perform * from extensions.dblink_get_result('kt_b') as t(id uuid);
  exception when others then
    v_b_state := sqlstate;
  end;
  begin
    perform * from extensions.dblink_get_result('kt_b') as t(id uuid);
  exception when others then
    null;
  end;
  perform extensions.dblink_exec('kt_b', 'rollback');

  return next ok(v_a is not null, 'the first concurrent hold wins');
  return next is(v_b_state, '23P01', 'the second concurrent hold fails with 23P01');

  select n into v_count
    from extensions.dblink(
      'kt_a',
      format(
        $q$select count(*) from public.bookings
            where pro_id = 'a0000000-0000-4000-8000-000000000002' and status = 'held' and during && %s$q$,
        v_slot
      )
    ) as t(n bigint);
  return next is(v_count, 1::bigint, 'exactly one hold exists for the slot');

  perform extensions.dblink_exec('kt_a', v_cleanup);
  perform extensions.dblink_disconnect('kt_a');
  perform extensions.dblink_disconnect('kt_b');
exception when others then
  perform extensions.dblink_exec(v_conn, v_cleanup);
  raise;
end;
$f$;

select * from pg_temp.parallel_holds();

select * from finish();
rollback;
