-- Inheritance: tables. RLS is enabled and policies are defined in 0004.
-- Every workspace-owned row cascades from workspaces so delete_workspace() removes everything.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.app_role not null,
  primary key (workspace_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  type public.source_type not null,
  filename text not null,
  access_level public.access_level not null,
  uploaded_by uuid references auth.users (id) on delete set null,
  sha256 text not null,
  imported_at timestamptz not null default now(),
  unique (workspace_id, sha256)
);
create index sources_workspace_idx on public.sources (workspace_id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  author text,
  ts timestamptz,
  text text not null,
  thread_id text,
  access_level public.access_level not null
);
create index events_workspace_idx on public.events (workspace_id);
create index events_source_idx on public.events (source_id);
create index events_text_trgm_idx on public.events using gin (text extensions.gin_trgm_ops);

create table public.aliases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  canonical text not null,
  variants text[] not null default '{}',
  kind public.alias_kind not null
);
create index aliases_workspace_idx on public.aliases (workspace_id);

create table public.obligations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind public.obligation_kind not null,
  description text not null,
  owed_by text,
  owed_to text,
  due_text text,
  due_date date,
  next_due date,
  approval_required text,
  approver text,
  status public.obligation_status not null default 'open',
  trust_state public.trust_state not null default 'gap',
  -- Raised automatically to the most restrictive level among cited events (0005).
  access_level public.access_level not null default 'committee',
  -- Uploaders of the private source files behind this item. Maintained by trigger (0005);
  -- lets the outgoing lead read private items built only from their own files.
  private_uploaders uuid[] not null default '{}',
  review_state public.review_state not null default 'draft',
  created_at timestamptz not null default now()
);
create index obligations_workspace_idx on public.obligations (workspace_id);
create index obligations_description_trgm_idx on public.obligations using gin (description extensions.gin_trgm_ops);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  quote text not null,
  relation public.evidence_relation not null,
  verified boolean not null default false
);
create index evidence_obligation_idx on public.evidence (obligation_id);
create index evidence_event_idx on public.evidence (event_id);

create table public.context_items (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  kind public.context_kind not null,
  text text not null,
  access_level public.access_level not null
);
create index context_items_obligation_idx on public.context_items (obligation_id);

create table public.docket_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  claim_a_event uuid not null references public.events (id) on delete cascade,
  claim_b_event uuid not null references public.events (id) on delete cascade,
  summary text not null,
  ruling text,
  ruled_by uuid references auth.users (id) on delete set null,
  reason text,
  ruled_at timestamptz
);
create index docket_entries_workspace_idx on public.docket_entries (workspace_id);

-- Placeholder only: holds NO source text. Visible to all members by design.
create table public.sealed_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid references public.obligations (id) on delete cascade,
  holder_role public.app_role not null,
  topic_label text not null check (length(topic_label) <= 80),
  approved_by uuid references auth.users (id) on delete set null
);
create index sealed_items_workspace_idx on public.sealed_items (workspace_id);

-- Immutable (0005). snapshot/diff hold ids and hashes only, never item text:
-- RLS cannot filter inside jsonb, so content lives in version_items.
create table public.versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  number integer not null check (number > 0),
  approved_by uuid references auth.users (id) on delete set null,
  snapshot jsonb not null,
  diff jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, number)
);

-- Immutable. One row per obligation per approved version, filtered by RLS like obligations.
create table public.version_items (
  version_id uuid not null references public.versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid not null,
  access_level public.access_level not null,
  private_uploaders uuid[] not null default '{}',
  item jsonb not null,
  item_hash text not null,
  primary key (version_id, obligation_id)
);
create index version_items_workspace_idx on public.version_items (workspace_id);

-- Immutable: a changed decision is a new row; the latest per (version, obligation, user) wins.
create table public.acks (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  version_id uuid not null references public.versions (id) on delete cascade,
  obligation_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  action public.ack_action not null,
  note text,
  created_at timestamptz not null default now()
);
create index acks_version_idx on public.acks (version_id, obligation_id, user_id, seq desc);

-- Explicit releases of restricted items to a role. Insert only via release_item().
create table public.releases (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  target_type text not null check (target_type in ('obligation', 'context_item')),
  target_id uuid not null,
  to_role public.app_role not null,
  released_by uuid references auth.users (id) on delete set null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now(),
  unique (target_type, target_id, to_role)
);
create index releases_lookup_idx on public.releases (workspace_id, target_type, target_id);

-- Immutable. access_level/private_uploaders copy the target row's, because before/after
-- contain its content and RLS must filter on them.
create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor uuid,
  action text not null,
  target_type text not null,
  target_id text,
  -- Set when the row concerns an obligation (or its evidence/context/release). Reading the
  -- audit row then also requires being able to read that obligation now.
  obligation_id uuid,
  reason text,
  before jsonb,
  after jsonb,
  access_level public.access_level not null,
  private_uploaders uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_workspace_idx on public.audit_log (workspace_id, id desc);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  result jsonb,
  created_at timestamptz not null default now()
);
create index jobs_queue_idx on public.jobs (workspace_id, status, created_at);

-- Server-side only (no policies). Keyed by prompt hash.
create table public.llm_cache (
  hash text primary key,
  response jsonb not null,
  created_at timestamptz not null default now()
);
