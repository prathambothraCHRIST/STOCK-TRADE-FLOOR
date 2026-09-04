-- Run once in Supabase SQL Editor.
create table if not exists storage_kv (
  scope text not null,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (scope, key)
);

alter table storage_kv enable row level security;

create policy "public read" on storage_kv for select using (true);
create policy "public insert" on storage_kv for insert with check (true);
create policy "public update" on storage_kv for update using (true);
create policy "public delete" on storage_kv for delete using (true);
