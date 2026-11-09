-- Inheritance: provenance, audit and immutability triggers.
--
-- Transaction-local flags (set_config(..., true)), set only inside SECURITY DEFINER code:
--   app.allow_workspace_delete = 'on'  -> immutable rows may be deleted (delete_workspace()).
--   app.derived_update = 'on'          -> a recomputation of derived columns; not audited.
--   app.audit_reason = '<text>'        -> reason recorded on audit rows for this transaction.

create function app.flag(p_name text) returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(current_setting(p_name, true), '') = 'on' $$;

----------------------------------------------------------------------------------------
-- Provenance
----------------------------------------------------------------------------------------

-- An event is never less restricted than the file it came from.
create function app.event_inherit_source_level() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  new.access_level := greatest(
    new.access_level,
    (select s.access_level from public.sources s where s.id = new.source_id)
  );
  return new;
end
$$;

create trigger events_inherit_source_level
  before insert or update of access_level, source_id on public.events
  for each row execute function app.event_inherit_source_level();

-- An obligation inherits the MOST restrictive level among its cited events, and records
-- who uploaded the private sources behind it. Client-supplied private_uploaders are ignored.
create function app.obligation_provenance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_max public.access_level;
  v_uploaders uuid[];
begin
  select
    max(e.access_level),
    coalesce(
      array_agg(distinct coalesce(s.uploaded_by, app.nobody())) filter (where e.access_level = 'private'),
      '{}'
    )
  into v_max, v_uploaders
  from public.evidence ev
  join public.events e on e.id = ev.event_id
  join public.sources s on s.id = e.source_id
  where ev.obligation_id = new.id;

  new.private_uploaders := coalesce(v_uploaders, '{}');
  if v_max is not null then
    new.access_level := greatest(new.access_level, v_max);
  end if;
  return new;
end
$$;

create trigger obligations_provenance
  before insert or update on public.obligations
  for each row execute function app.obligation_provenance();

-- When evidence changes, recompute the parent obligation (fires obligations_provenance).
create function app.evidence_touch_obligation() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.flag('app.allow_workspace_delete') then
    return null;
  end if;
  perform set_config('app.derived_update', 'on', true);
  if tg_op in ('INSERT', 'UPDATE') then
    update public.obligations set private_uploaders = private_uploaders where id = new.obligation_id;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    update public.obligations set private_uploaders = private_uploaders where id = old.obligation_id;
  end if;
  perform set_config('app.derived_update', 'off', true);
  return null;
end
$$;

create trigger evidence_touch_obligation
  after insert or update or delete on public.evidence
  for each row execute function app.evidence_touch_obligation();

----------------------------------------------------------------------------------------
-- Audit
----------------------------------------------------------------------------------------

-- Writes one audit_log row per change. The row carries the access level (and private
-- uploaders) of the item it describes, because before/after contain that item's content.
create function app.audit_row() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_ws uuid;
  v_level public.access_level := 'everyone';
  v_uploaders uuid[] := '{}';
  v_target_id text := v_row ->> 'id';
  v_obligation uuid;
  v_event_level public.access_level;
  v_event_uploader uuid;
begin
  if app.flag('app.allow_workspace_delete') or app.flag('app.derived_update') then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;

  case tg_table_name
    when 'obligations' then
      v_ws := (v_row ->> 'workspace_id')::uuid;
      v_level := greatest((v_row ->> 'access_level')::public.access_level,
                          case when tg_op = 'UPDATE' then old.access_level else 'everyone' end);
      v_uploaders := array(select jsonb_array_elements_text(v_row -> 'private_uploaders'))::uuid[];
      v_obligation := (v_row ->> 'id')::uuid;
    when 'evidence', 'context_items' then
      v_obligation := (v_row ->> 'obligation_id')::uuid;
      select o.workspace_id, o.access_level, o.private_uploaders
        into v_ws, v_level, v_uploaders
      from public.obligations o
      where o.id = v_obligation;
      if v_ws is null then
        return null;  -- parent already gone (cascade); nothing to attribute
      end if;
      if tg_table_name = 'context_items' then
        v_level := greatest(v_level, (v_row ->> 'access_level')::public.access_level);
      else
        -- Do not rely on trigger order: the obligation may not have been raised yet,
        -- so also take the cited event's own level and uploader.
        select e.access_level, coalesce(s.uploaded_by, app.nobody())
          into v_event_level, v_event_uploader
        from public.events e join public.sources s on s.id = e.source_id
        where e.id = (v_row ->> 'event_id')::uuid;
        v_level := greatest(v_level, coalesce(v_event_level, 'private'));
        if coalesce(v_event_level, 'private') = 'private' then
          v_uploaders := array(
            select distinct u from unnest(v_uploaders || coalesce(v_event_uploader, app.nobody())) u);
        end if;
      end if;
    when 'docket_entries' then
      v_ws := (v_row ->> 'workspace_id')::uuid;
      select max(e.access_level),
             coalesce(array_agg(distinct coalesce(s.uploaded_by, app.nobody()))
                        filter (where e.access_level = 'private'), '{}')
        into v_level, v_uploaders
      from public.events e
      join public.sources s on s.id = e.source_id
      where e.id in ((v_row ->> 'claim_a_event')::uuid, (v_row ->> 'claim_b_event')::uuid);
      v_level := coalesce(v_level, 'private');
    when 'memberships' then
      v_ws := (v_row ->> 'workspace_id')::uuid;
      v_target_id := v_row ->> 'user_id';
    else
      -- sealed_items, aliases: no source text
      v_ws := (v_row ->> 'workspace_id')::uuid;
  end case;

  insert into public.audit_log
    (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
  values (
    v_ws,
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    v_target_id,
    v_obligation,
    nullif(current_setting('app.audit_reason', true), ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_level,
    coalesce(v_uploaders, '{}')
  );
  return null;
end
$$;

create trigger audit_obligations after insert or update or delete on public.obligations
  for each row execute function app.audit_row();
create trigger audit_evidence after insert or update or delete on public.evidence
  for each row execute function app.audit_row();
create trigger audit_context_items after insert or update or delete on public.context_items
  for each row execute function app.audit_row();
create trigger audit_docket_entries after insert or update or delete on public.docket_entries
  for each row execute function app.audit_row();
create trigger audit_sealed_items after insert or update or delete on public.sealed_items
  for each row execute function app.audit_row();
create trigger audit_aliases after insert or update or delete on public.aliases
  for each row execute function app.audit_row();
create trigger audit_memberships after insert or update or delete on public.memberships
  for each row execute function app.audit_row();

----------------------------------------------------------------------------------------
-- Immutability (applies to every role, including service_role)
----------------------------------------------------------------------------------------

create function app.forbid_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and app.flag('app.allow_workspace_delete') then
    return old;
  end if;
  raise exception '% is immutable: % is not allowed', tg_table_name, tg_op
    using errcode = 'insufficient_privilege',
          hint = 'Approved versions, version items, acknowledgements and audit rows are append-only.';
end
$$;

create trigger versions_immutable before update or delete on public.versions
  for each row execute function app.forbid_mutation();
create trigger version_items_immutable before update or delete on public.version_items
  for each row execute function app.forbid_mutation();
create trigger acks_immutable before update or delete on public.acks
  for each row execute function app.forbid_mutation();
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function app.forbid_mutation();

create trigger versions_no_truncate before truncate on public.versions
  for each statement execute function app.forbid_mutation();
create trigger version_items_no_truncate before truncate on public.version_items
  for each statement execute function app.forbid_mutation();
create trigger acks_no_truncate before truncate on public.acks
  for each statement execute function app.forbid_mutation();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.forbid_mutation();

grant execute on all functions in schema app to anon, authenticated, service_role;
