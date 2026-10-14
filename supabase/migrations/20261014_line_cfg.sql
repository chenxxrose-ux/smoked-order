-- LINE 機器人設定（Channel secret、access token、綁定的群組）。只有 edge function（service role）讀寫。
create table if not exists public.line_cfg (k text primary key, v text not null, updated_at timestamptz not null default now());
alter table public.line_cfg enable row level security;
revoke all on public.line_cfg from anon, authenticated;
