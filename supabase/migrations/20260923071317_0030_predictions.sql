create table if not exists predictions (
  id bigint generated always as identity primary key,
  title text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  closes_at timestamptz not null,
  winning_option_id bigint,
  resolved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists prediction_options (
  id bigint generated always as identity primary key,
  prediction_id bigint not null references predictions(id) on delete cascade,
  label text not null,
  display_order integer not null,
  created_at timestamptz not null default now()
);

alter table predictions add constraint predictions_winning_option_fk
  foreign key (winning_option_id) references prediction_options(id);

create table if not exists prediction_bets (
  id bigint generated always as identity primary key,
  prediction_id bigint not null references predictions(id) on delete cascade,
  option_id bigint not null references prediction_options(id),
  channel_id text not null references users(channel_id),
  amount integer not null check (amount >= 100),
  payout integer,
  created_at timestamptz not null default now(),
  unique (prediction_id, channel_id)
);

create index if not exists prediction_options_prediction_id_idx on prediction_options(prediction_id);
create index if not exists prediction_bets_prediction_id_idx on prediction_bets(prediction_id);

alter table predictions enable row level security;
alter table prediction_options enable row level security;
alter table prediction_bets enable row level security;

create policy "predictions_public_read" on predictions
  for select
  using (true);

create policy "prediction_options_public_read" on prediction_options
  for select
  using (true);

-- prediction_bets: 정책 없음 = anon/authenticated 모두 읽기/쓰기 불가 (service_role만 접근, points_ledger와 같은 원칙)
