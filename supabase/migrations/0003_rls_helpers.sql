-- Inheritance: RLS helper functions.
-- They live in schema `app`, which PostgREST does not expose, so they cannot be called
-- over the API. They are SECURITY DEFINER (owner bypasses RLS) to avoid policy recursion,
-- STABLE so Postgres can cache them per statement, and pin search_path to ''.

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- Sentinel used when an uploader is unknown, so it can never match a real user.
create function app.nobody() returns uuid
language sql immutable
set search_path = ''
as $$ select '00000000-0000-0000-0000-000000000000'::uuid $$;

create function app.my_role(p_ws uuid) returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select m.role
  from public.memberships m
  where m.workspace_id = p_ws
    and m.user_id = (select auth.uid())
$$;

create function app.is_member(p_ws uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.my_role(p_ws) is not null $$;

create function app.has_role(p_ws uuid, p_roles public.app_role[]) returns boolean
language sql stable security definer
set search_path = ''
as $$ select coalesce(app.my_role(p_ws) = any (p_roles), false) $$;

-- Highest access level each role may read.
create function app.clearance(p_role public.app_role) returns public.access_level
language sql immutable
set search_path = ''
as $$
  select case p_role
    when 'advisor' then 'private'
    when 'outgoing_lead' then 'finance'
    when 'treasurer' then 'finance'
    when 'incoming_lead' then 'committee'
    else 'everyone'
  end::public.access_level
$$;

create function app.is_released(p_ws uuid, p_target_type text, p_target_id uuid, p_role public.app_role)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.releases r
    where r.workspace_id = p_ws
      and r.target_type = p_target_type
      and r.target_id = p_target_id
      and r.to_role = p_role
  )
$$;

-- The single read rule. A row is readable by a member when:
--   1. its level is within the member's role clearance, or
--   2. it is private, the member is the outgoing lead, and every private source behind it
--      was uploaded by that member, or
--   3. it was explicitly released to the member's role.
create function app.can_read(
  p_ws uuid,
  p_level public.access_level,
  p_private_uploaders uuid[],
  p_target_type text,
  p_target_id uuid
) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select
      p_level <= app.clearance(m.role)
      or (
        p_level = 'private'
        and m.role = 'outgoing_lead'
        and cardinality(p_private_uploaders) > 0
        and p_private_uploaders <@ array[(select auth.uid())]
      )
      or (
        p_target_type is not null
        and app.is_released(p_ws, p_target_type, p_target_id, m.role)
      )
    from public.memberships m
    where m.workspace_id = p_ws
      and m.user_id = (select auth.uid())
  ), false)
$$;

-- Uploader of a source as a one-element array (sentinel if unknown).
create function app.source_uploaders(p_source_id uuid) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select array[coalesce(s.uploaded_by, app.nobody())]
  from public.sources s
  where s.id = p_source_id
$$;

create function app.can_read_event(p_event_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_read(e.workspace_id, e.access_level, app.source_uploaders(e.source_id), null, null)
    from public.events e
    where e.id = p_event_id
  ), false)
$$;

create function app.can_read_obligation(p_obligation_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_read(o.workspace_id, o.access_level, o.private_uploaders, 'obligation', o.id)
    from public.obligations o
    where o.id = p_obligation_id
  ), false)
$$;

create function app.obligation_workspace(p_obligation_id uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$ select o.workspace_id from public.obligations o where o.id = p_obligation_id $$;

create function app.version_workspace(p_version_id uuid) returns uuid
language sql stable security definer
set search_path = ''
as $$ select v.workspace_id from public.versions v where v.id = p_version_id $$;

grant execute on all functions in schema app to anon, authenticated, service_role;
