create table if not exists public.alg_calls (
  id text primary key,
  started_at timestamptz not null default now(),
  channel text not null check (channel in ('phone','browser')),
  status text not null,
  destination text,
  seconds integer,
  response_ms integer,
  cost_inr numeric,
  recording text,
  outcome jsonb,
  transcript jsonb not null default '[]'::jsonb
);
create index if not exists alg_calls_started_at on public.alg_calls (started_at desc);
alter table public.alg_calls enable row level security;
insert into storage.buckets (id, name, public) values ('alg-recordings', 'alg-recordings', false) on conflict (id) do nothing;

create table if not exists public.alg_agent_records (
  id text not null,
  kind text not null check (kind in ('outcome','report')),
  payload jsonb not null,
  primary key (id, kind)
);
alter table public.alg_agent_records enable row level security;
