-- Trader Mind: Supabase database layout (exported 2026-11-28 from project trader-mind).
-- Restores the tables, checks, row-level security and the every-minute watcher schedule on a fresh project.
-- No data and no secrets are in this file. Run it once in the Supabase SQL editor, then:
--   1. Edge Functions: deploy supabase/functions/watch and supabase/functions/live from this repo.
--   2. Edge Function secrets: CAPITAL_API_KEY, CAPITAL_LOGIN, CAPITAL_API_PASSWORD, WATCH_KEY, NTFY_TOPIC
--      (typed by Ronald in the dashboard; never stored here).
--   3. Replace <PROJECT_REF> and <WATCH_KEY> in the cron block at the bottom, then run that block.
--   4. Put the new project URL and keys in config.js (app) and trading/.secrets/supabase.env (PC).

-- tables
create table if not exists public.approvals (trade_id text not null, fingerprint text not null, decision text not null, decided_by uuid default auth.uid(), decided_at timestamp with time zone not null default now(), stake_usd numeric, auto boolean default false);
create table if not exists public.journal (id text not null, day date not null, title text not null, body_md text not null, updated_at timestamp with time zone not null default now());
create table if not exists public.settings (key text not null, data jsonb not null, updated_at timestamp with time zone default now());
create table if not exists public.snapshots (key text not null, data jsonb not null, updated_at timestamp with time zone not null default now());
create table if not exists public.trades (id text not null, asset_class text not null, instrument text not null, side text not null, mode text not null, status text not null, strategy text, setup text, entry numeric, stop numeric, target numeric, exit numeric, result text, r numeric, pnl_usd numeric, risk_usd numeric, units numeric, opened_at timestamp with time zone, closed_at timestamp with time zone, expectation text, source text, fingerprint text, expires_at timestamp with time zone, updated_at timestamp with time zone not null default now(), last_price numeric, upl_usd numeric, horizon text, broker text, deal_id text, epic text, rec boolean default false, kind text, win_prob numeric, win_lo numeric, win_hi numeric, exp_r numeric, samples integer, stake_min numeric, stake_max numeric, stake_default numeric, stake_usd numeric, usd_per_unit_move numeric, reward_risk numeric, size_min numeric, size_step numeric);
create table if not exists public.watch_state (trade_id text not null, peak_r numeric default 0, last_r numeric, be_done boolean default false, action text, acted_at timestamp with time zone, updated_at timestamp with time zone default now());

-- keys and checks
alter table public.trades add constraint trades_pkey PRIMARY KEY (id);
alter table public.trades add constraint trades_asset_class_check CHECK ((asset_class = ANY (ARRAY['stock'::text, 'forex'::text, 'commodity'::text, 'crypto'::text])));
alter table public.trades add constraint trades_side_check CHECK ((side = ANY (ARRAY['buy'::text, 'sell'::text])));
alter table public.trades add constraint trades_mode_check CHECK ((mode = ANY (ARRAY['shadow'::text, 'paper'::text, 'demo'::text, 'live'::text])));
alter table public.trades add constraint trades_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'open'::text, 'closed'::text, 'cancelled'::text])));
alter table public.journal add constraint journal_pkey PRIMARY KEY (id);
alter table public.snapshots add constraint snapshots_pkey PRIMARY KEY (key);
alter table public.settings add constraint settings_pkey PRIMARY KEY (key);
alter table public.watch_state add constraint watch_state_pkey PRIMARY KEY (trade_id);
alter table public.approvals add constraint approvals_pkey PRIMARY KEY (trade_id);
alter table public.approvals add constraint approvals_decision_check CHECK ((decision = ANY (ARRAY['approve'::text, 'reject'::text])));
alter table public.approvals add constraint approvals_trade_id_fkey FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE;
alter table public.approvals add constraint approvals_stake_range CHECK (((stake_usd IS NULL) OR ((stake_usd > (0)::numeric) AND (stake_usd <= (4)::numeric))));
alter table public.approvals add constraint approvals_who CHECK (((auto = true) OR (decided_by IS NOT NULL)));

-- row-level security: the app (signed in) can read; it can only write approvals for live demo tickets and its own settings
alter table public.journal enable row level security;
alter table public.snapshots enable row level security;
alter table public.approvals enable row level security;
alter table public.trades enable row level security;
alter table public.settings enable row level security;
alter table public.watch_state enable row level security;
create policy "read when signed in" on public.journal for SELECT to authenticated using (true);
create policy "read when signed in" on public.snapshots for SELECT to authenticated using (true);
create policy "read when signed in" on public.trades for SELECT to authenticated using (true);
create policy "decide when signed in" on public.approvals for INSERT to authenticated with check (((decided_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM trades t
  WHERE ((t.id = approvals.trade_id) AND (t.mode = 'demo'::text) AND (t.status = 'proposed'::text) AND (t.fingerprint = approvals.fingerprint) AND (t.expires_at > now()))))));
create policy "read when signed in" on public.approvals for SELECT to authenticated using (true);
create policy "signed in insert settings" on public.settings for INSERT to authenticated with check ((key = 'main'::text));
create policy "signed in update settings" on public.settings for UPDATE to authenticated using ((key = 'main'::text)) with check ((key = 'main'::text));
create policy "signed in read settings" on public.settings for SELECT to authenticated using (true);
create policy "signed in read watch" on public.watch_state for SELECT to authenticated using (true);

-- the watcher, every minute (needs the pg_cron and pg_net extensions: Database > Extensions)
-- select cron.schedule('trade-watch', '* * * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/watch',
--     headers := '{"Content-Type":"application/json","x-watch-key":"<WATCH_KEY>"}'::jsonb,
--     body := '{}'::jsonb, timeout_milliseconds := 20000)
-- $$);
