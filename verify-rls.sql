-- Execute in the Supabase SQL Editor as the project database administrator.
-- The two synthetic identities and all dictionary rows are rolled back.
begin;

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.cgcpp_entries'::regclass) then
    raise exception 'RLS is disabled';
  end if;
end $$;

insert into auth.users (id, aud, role) values
  ('b2418b33-4f90-415f-a822-57da153728a1', 'authenticated', 'authenticated'),
  ('b2418b33-4f90-415f-a822-57da153728a2', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b2418b33-4f90-415f-a822-57da153728a1', true);

insert into public.cgcpp_entries (term_key, word, favorite, note) values (
  'weighted grayscale',
  '{"term":"weighted grayscale","cn":"加权灰度","meaning":"","example":"Compute grayscale using BT.709 luma weights.","category":"图像 / 色彩"}',
  true, 'RLS verification'
);

do $$
declare previous_revision uuid;
begin
  select revision into strict previous_revision
    from public.cgcpp_entries where term_key = 'weighted grayscale' and favorite;
  begin
    insert into public.cgcpp_entries (term_key, favorite) values ('weighted grayscale', true);
    raise exception 'Duplicate was accepted';
  exception when unique_violation then null;
  end;
  update public.cgcpp_entries set note = 'new note', revision = gen_random_uuid()
    where term_key = 'weighted grayscale' and revision = previous_revision;
  if not found then raise exception 'Owner update failed'; end if;
  update public.cgcpp_entries set note = 'stale note'
    where term_key = 'weighted grayscale' and revision = previous_revision;
  if found then raise exception 'Stale revision was accepted'; end if;
end $$;

select set_config('request.jwt.claim.sub', 'b2418b33-4f90-415f-a822-57da153728a2', true);

do $$
begin
  if exists (select 1 from public.cgcpp_entries) then
    raise exception 'Second user could read the first user''s entry';
  end if;
  update public.cgcpp_entries set favorite = false where term_key = 'weighted grayscale';
  if found then raise exception 'Second user could update the first user''s entry'; end if;
  delete from public.cgcpp_entries where term_key = 'weighted grayscale';
  if found then raise exception 'Second user could delete the first user''s entry'; end if;
  begin
    insert into public.cgcpp_entries (user_id, term_key, favorite) values
      ('b2418b33-4f90-415f-a822-57da153728a1', 'forged entry', true);
    raise exception 'Second user could insert for the first user';
  exception when insufficient_privilege then null;
  end;
  insert into public.cgcpp_entries (term_key, favorite) values ('weighted grayscale', true);
  begin
    update public.cgcpp_entries set user_id = 'b2418b33-4f90-415f-a822-57da153728a1'
      where term_key = 'weighted grayscale';
    raise exception 'An entry could be transferred to another owner';
  exception when insufficient_privilege then null;
  end;
  delete from public.cgcpp_entries where term_key = 'weighted grayscale';
  if not found then raise exception 'Owner delete failed'; end if;
end $$;

set local role anon;
do $$
declare statement text;
begin
  foreach statement in array array[
    'select * from public.cgcpp_entries',
    'insert into public.cgcpp_entries (term_key, favorite) values (''anon write'', true)',
    'update public.cgcpp_entries set favorite = false',
    'delete from public.cgcpp_entries'
  ] loop
    begin
      execute statement;
      raise exception 'Anonymous operation allowed: %', statement;
    exception when insufficient_privilege then null;
    end;
  end loop;
end $$;

reset role;
rollback;

select 'PASS: RLS, owner CRUD, deduplication, revision guard, cross-user isolation and anonymous denial' as result;
