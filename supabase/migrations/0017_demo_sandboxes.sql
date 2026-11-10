-- Inheritance: per-visitor demo clubs (Phase 10).
-- "Load demo club" gives each visitor a private copy of the synthetic club, with four role
-- accounts of its own, so one visitor's reviews, approvals and answers never reach another.
-- A copy is deleted after it expires (by the daily cron, or on the next load).

-- Set only by the server (service role) when it creates a copy; members can read their own
-- workspace row but there is no update policy, so they cannot change it. NULL for real
-- workspaces and for the shared demo club.
alter table public.workspaces add column sandbox_expires_at timestamptz;

-- Server-side bookkeeping for clean-up. It outlives its workspace (set null on delete) so the
-- copy's auth users are still found and removed after a visitor deletes the workspace.
-- No policies: only the service role reads or writes it.
create table public.demo_sandboxes (
  id uuid primary key,
  workspace_id uuid references public.workspaces (id) on delete set null,
  user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at)
);
create index demo_sandboxes_expires_idx on public.demo_sandboxes (expires_at);
create index demo_sandboxes_created_idx on public.demo_sandboxes (created_at);

alter table public.demo_sandboxes enable row level security;
revoke all on public.demo_sandboxes from anon, authenticated;
grant select, insert, update, delete on public.demo_sandboxes to service_role;
