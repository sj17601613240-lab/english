-- One table for private vocabulary, stars and notes. The public glossary is words.json.
begin;

create table if not exists public.cgcpp_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  term_key text collate "C" not null check (
    char_length(term_key) between 1 and 200
    and term_key = lower(trim(regexp_replace(term_key, '[[:space:]]+', ' ', 'g')) collate "C")
  ),
  word jsonb,
  favorite boolean not null default false,
  note text not null default '' check (char_length(note) <= 12000),
  revision uuid not null default gen_random_uuid(),
  primary key (user_id, term_key),
  check (word is null or (
    jsonb_typeof(word) = 'object'
    and word ?& array['term', 'cn', 'meaning', 'example', 'category']
    and jsonb_typeof(word->'term') = 'string'
    and jsonb_typeof(word->'cn') = 'string'
    and jsonb_typeof(word->'meaning') = 'string'
    and jsonb_typeof(word->'example') = 'string'
    and jsonb_typeof(word->'category') = 'string'
    and char_length(word->>'term') between 1 and 200
    and term_key = lower(trim(regexp_replace((word->>'term') collate "C", '[[:space:]]+', ' ', 'g')) collate "C")
    and char_length(trim(word->>'cn')) between 1 and 1000
    and char_length(trim(word->>'category')) between 1 and 100
    and char_length(word->>'meaning') <= 6000
    and char_length(word->>'example') <= 6000
  )),
  check (word is not null or favorite or note <> '')
);

alter table public.cgcpp_entries enable row level security;
revoke all on public.cgcpp_entries from public, anon, authenticated;
grant select, insert, update, delete on public.cgcpp_entries to authenticated;

create policy cgcpp_read_own on public.cgcpp_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy cgcpp_insert_own on public.cgcpp_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy cgcpp_update_own on public.cgcpp_entries for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy cgcpp_delete_own on public.cgcpp_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

notify pgrst, 'reload schema';
commit;
