-- Inheritance: import flow (Phase 3).
--   * workspaces.is_demo protects the shared demo club from deletion by visitors.
--   * sources keep a "what was read" summary (counts only, never source text).
--   * events keep small parser metadata (e.g. a Trello move into Done).
--   * import_source() writes a file and its events in one transaction, as the caller (RLS applies).
--   * remove_source() deletes a file and its events, as the caller.
--   * Imports and removals are audited.

alter table public.workspaces add column is_demo boolean not null default false;

alter table public.sources
  add column read_summary jsonb not null default '{}',
  add column event_count integer not null default 0 check (event_count >= 0);

alter table public.events add column meta jsonb not null default '{}';

----------------------------------------------------------------------------------------
-- Audit sources (file imports and removals)
----------------------------------------------------------------------------------------

create function app.audit_source() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.sources := case when tg_op = 'DELETE' then old else new end;
begin
  if app.flag('app.allow_workspace_delete') then
    return null;
  end if;
  insert into public.audit_log
    (workspace_id, actor, action, target_type, target_id, reason, before, after, access_level, private_uploaders)
  values (
    v_row.workspace_id,
    (select auth.uid()),
    case when tg_op = 'INSERT' then 'import' else 'remove_source' end,
    'sources',
    v_row.id::text,
    nullif(current_setting('app.audit_reason', true), ''),
    case when tg_op = 'DELETE' then to_jsonb(old) end,
    case when tg_op = 'INSERT' then to_jsonb(new) end,
    v_row.access_level,
    case when v_row.access_level = 'private' then array[coalesce(v_row.uploaded_by, app.nobody())] else '{}' end
  );
  return null;
end
$$;

create trigger audit_sources after insert or delete on public.sources
  for each row execute function app.audit_source();

----------------------------------------------------------------------------------------
-- Import and removal (SECURITY INVOKER: every insert/delete is checked by RLS)
----------------------------------------------------------------------------------------

create function public.import_source(
  p_workspace uuid,
  p_type public.source_type,
  p_filename text,
  p_access public.access_level,
  p_sha256 text,
  p_summary jsonb,
  p_events jsonb,
  p_reason text
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_count integer;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can import files' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_filename), '') = '' then
    raise exception 'a file name is required' using errcode = 'check_violation';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sha256' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'events must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;
  v_count := jsonb_array_length(p_events);
  if v_count > 50000 then
    raise exception 'too many events in one file (% > 50000)', v_count using errcode = 'program_limit_exceeded';
  end if;

  perform set_config('app.audit_reason', coalesce(nullif(trim(p_reason), ''), 'import'), true);

  insert into public.sources (workspace_id, type, filename, access_level, uploaded_by, sha256, read_summary, event_count)
  values (p_workspace, p_type, trim(p_filename), p_access, (select auth.uid()), p_sha256, coalesce(p_summary, '{}'), v_count)
  returning id into v_id;

  insert into public.events (workspace_id, source_id, author, ts, text, thread_id, access_level, meta)
  select p_workspace, v_id, e.author, e.ts, e.text, e.thread_id, p_access, coalesce(e.meta, '{}')
  from jsonb_to_recordset(p_events) as e(author text, ts timestamptz, text text, thread_id text, meta jsonb);

  perform set_config('app.audit_reason', '', true);
  return v_id;
end
$$;

create function public.remove_source(p_source uuid, p_reason text)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to remove a file' using errcode = 'check_violation';
  end if;
  perform set_config('app.audit_reason', trim(p_reason), true);
  delete from public.sources where id = p_source;
  get diagnostics v_deleted = row_count;
  perform set_config('app.audit_reason', '', true);
  if v_deleted = 0 then
    raise exception 'file not found, or you are not allowed to remove it' using errcode = 'insufficient_privilege';
  end if;
end
$$;

-- People named in the events the caller can read, with message counts (for the alias editor).
create function public.event_authors(p_workspace uuid)
returns table (author text, events bigint)
language sql stable security invoker
set search_path = ''
as $$
  select e.author, count(*)
  from public.events e
  where e.workspace_id = p_workspace and e.author is not null
  group by e.author
  order by count(*) desc, e.author
$$;

----------------------------------------------------------------------------------------
-- The shared demo club cannot be deleted by visitors
----------------------------------------------------------------------------------------

create or replace function public.delete_workspace(p_workspace uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (app.can_review(p_workspace) or app.is_service_role()) then
    raise exception 'only the outgoing lead or advisor can delete this workspace' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to delete a workspace' using errcode = 'check_violation';
  end if;
  if not app.is_service_role()
     and exists (select 1 from public.workspaces w where w.id = p_workspace and w.is_demo) then
    raise exception 'the shared demo club cannot be deleted; it is reset by the administrator' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.allow_workspace_delete', 'on', true);
  delete from public.workspaces where id = p_workspace;
  perform set_config('app.allow_workspace_delete', 'off', true);
end
$$;

revoke execute on function public.import_source(uuid, public.source_type, text, public.access_level, text, jsonb, jsonb, text) from public, anon;
revoke execute on function public.remove_source(uuid, text) from public, anon;
revoke execute on function public.event_authors(uuid) from public, anon;
grant execute on function public.import_source(uuid, public.source_type, text, public.access_level, text, jsonb, jsonb, text) to authenticated;
grant execute on function public.remove_source(uuid, text) to authenticated;
grant execute on function public.event_authors(uuid) to authenticated;
