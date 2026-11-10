-- Inheritance: review, sign-off, rulings and richer versions (Phase 8).
--   * Every change to an item by a signed-in user needs a reason and goes through
--     review_obligation(), so review_state, reasons and audit rows cannot be bypassed.
--   * An item accepted by a reviewer remembers the status and trust it was accepted with
--     (reviewed_status, reviewed_trust). If a later run changes either, the item needs
--     re-review, and mark_ready() and approve_version() are refused until it is settled.
--   * Two-step sign-off: the outgoing lead calls mark_ready(); the advisor may approve only
--     while that mark still matches the pending items (app.pending_hash).
--   * Advisor rulings on conflicts and reviewer verdicts on links are recorded, never rewritten.
--   * Versions (format 2) also hold evidence flags, same-item links and rulings; context
--     notes sit in their own table so each keeps its own access level.
-- Transaction-local flags set only inside these functions:
--   app.review_action = 'on'  -> review_state, reviewed_* and rulings may change
--   app.audit_action = '<x>'  -> name written to the audit row instead of insert/update/delete

----------------------------------------------------------------------------------------
-- Columns and constraints
----------------------------------------------------------------------------------------

alter table public.obligations
  add column reviewed_status public.obligation_status,
  add column reviewed_trust public.trust_state;

alter table public.docket_entries
  add constraint docket_entries_ruling_check check (ruling is null or ruling in ('done', 'not_done', 'cannot_tell'));

alter table public.obligation_links drop constraint obligation_links_verdict_check;
alter table public.obligation_links drop constraint obligation_links_method_check;
alter table public.obligation_links
  add constraint obligation_links_verdict_check check (verdict in ('same', 'possible', 'distinct')),
  add constraint obligation_links_method_check check (method in ('rule', 'model', 'reviewer'));

alter table public.version_items add column item_format smallint not null default 1;

-- Items accepted before this migration were accepted as they stand now.
update public.obligations set reviewed_status = status, reviewed_trust = trust_state
 where review_state in ('accepted', 'edited');

----------------------------------------------------------------------------------------
-- Guards
----------------------------------------------------------------------------------------

create function app.needs_rereview(o public.obligations) returns boolean
language sql immutable
set search_path = ''
as $$
  select o.review_state in ('accepted', 'edited')
     and (o.status, o.trust_state) is distinct from (o.reviewed_status, o.reviewed_trust)
$$;

-- Runs after app.obligation_provenance (alphabetical trigger order), so trust is settled.
create function app.obligation_review_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if app.flag('app.allow_workspace_delete') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if v_user is not null then
      new.review_state := 'draft';
      new.reviewed_status := null;
      new.reviewed_trust := null;
    end if;
    return new;
  end if;
  -- The server (service role, migrations) and derived recomputations are not review actions.
  if v_user is null or app.flag('app.derived_update') then
    return new;
  end if;
  if coalesce(current_setting('app.audit_reason', true), '') = '' then
    raise exception 'a reason is required to change an item: use the review actions'
      using errcode = 'check_violation';
  end if;
  if app.flag('app.review_action') then
    if new.review_state in ('accepted', 'edited') then
      new.reviewed_status := new.status;
      new.reviewed_trust := new.trust_state;
    else
      new.reviewed_status := null;
      new.reviewed_trust := null;
    end if;
  else
    if new.review_state is distinct from old.review_state then
      raise exception 'review state changes only through the review actions' using errcode = 'insufficient_privilege';
    end if;
    new.reviewed_status := old.reviewed_status;
    new.reviewed_trust := old.reviewed_trust;
  end if;
  return new;
end
$$;

create trigger obligations_zz_review_guard
  before insert or update on public.obligations
  for each row execute function app.obligation_review_guard();

-- A ruling is written only by rule_conflict().
create function app.docket_review_guard() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.flag('app.allow_workspace_delete') or (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.ruling := null; new.ruled_by := null; new.reason := null; new.ruled_at := null;
  elsif (new.ruling, new.ruled_by, new.reason, new.ruled_at) is distinct from (old.ruling, old.ruled_by, old.reason, old.ruled_at)
        and not app.flag('app.review_action') then
    raise exception 'a conflict is ruled on only through the ruling action' using errcode = 'insufficient_privilege';
  end if;
  return new;
end
$$;

create trigger docket_entries_review_guard
  before insert or update on public.docket_entries
  for each row execute function app.docket_review_guard();

----------------------------------------------------------------------------------------
-- Audit: review actions get their own names
----------------------------------------------------------------------------------------

create or replace function app.audit_link() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.obligation_links := case when tg_op = 'DELETE' then old else new end;
  v_level public.access_level;
  v_uploaders uuid[];
  v_obligation uuid;
begin
  if app.flag('app.allow_workspace_delete') or app.flag('app.derived_update') then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;
  select max(o.access_level),
         coalesce(array_agg(distinct u.uid) filter (where u.uid is not null), '{}')
    into v_level, v_uploaders
  from public.obligations o
  left join lateral unnest(case when o.access_level = 'private' then o.private_uploaders else '{}'::uuid[] end) as u(uid) on true
  where o.id in (v_row.a, v_row.b);
  if v_level is null then
    return null;  -- items already gone (cascade)
  end if;
  select o.id into v_obligation
  from public.obligations o where o.id in (v_row.a, v_row.b)
  order by o.access_level desc, o.id limit 1;

  insert into public.audit_log
    (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
  values (
    v_row.workspace_id, (select auth.uid()), coalesce(nullif(current_setting('app.audit_action', true), ''), lower(tg_op)), 'obligation_links', v_row.id::text, v_obligation,
    nullif(current_setting('app.audit_reason', true), ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_level, v_uploaders
  );
  return null;
end
$$;

create or replace function app.audit_row() returns trigger
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
  v_ob_level public.access_level;
  v_ob_uploaders uuid[];
begin
  if app.flag('app.allow_workspace_delete') or app.flag('app.derived_update') then
    return null;
  end if;
  if tg_op = 'UPDATE' and to_jsonb(old) = to_jsonb(new) then
    return null;
  end if;
  -- The server recording what an item was accepted with is not a review action.
  if tg_op = 'UPDATE' and (select auth.uid()) is null
     and (to_jsonb(old) - 'reviewed_status' - 'reviewed_trust') = (to_jsonb(new) - 'reviewed_status' - 'reviewed_trust') then
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
      v_obligation := nullif(v_row ->> 'obligation_id', '')::uuid;
      select max(e.access_level),
             coalesce(array_agg(distinct coalesce(s.uploaded_by, app.nobody()))
                        filter (where e.access_level = 'private'), '{}')
        into v_level, v_uploaders
      from public.events e
      join public.sources s on s.id = e.source_id
      where e.id in ((v_row ->> 'claim_a_event')::uuid, (v_row ->> 'claim_b_event')::uuid);
      v_level := coalesce(v_level, 'private');
      if v_obligation is not null then
        select o.access_level, o.private_uploaders into v_ob_level, v_ob_uploaders
        from public.obligations o where o.id = v_obligation;
        if v_ob_level is null then
          v_obligation := null;  -- item already gone (cascade); the events' level still applies
        else
          v_level := greatest(v_level, v_ob_level);
          if v_ob_level = 'private' then
            v_uploaders := array(select distinct u from unnest(v_uploaders || v_ob_uploaders) u);
          end if;
        end if;
      end if;
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
    coalesce(nullif(current_setting('app.audit_action', true), ''), lower(tg_op)),
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

----------------------------------------------------------------------------------------
-- Review actions
----------------------------------------------------------------------------------------

-- accept | edit | reject | reopen, with a reason. Runs as the caller, so RLS decides which
-- items can be touched. Status and trust are never editable: they come from evidence.
create function public.review_obligation(p_id uuid, p_action text, p_reason text, p_changes jsonb default null)
returns public.review_state
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
  v_kind public.obligation_kind;
  v_state public.review_state;
  v_new public.review_state;
  v_allowed text[];
  v_bad text[];
  v_c jsonb := coalesce(p_changes, '{}');
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for a review action' using errcode = 'check_violation';
  end if;
  if p_action is null or p_action not in ('accept', 'edit', 'reject', 'reopen') then
    raise exception 'unknown review action' using errcode = 'invalid_parameter_value';
  end if;
  select o.workspace_id, o.kind, o.review_state into v_ws, v_kind, v_state from public.obligations o where o.id = p_id;
  if v_ws is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;
  if not app.can_review(v_ws) then
    raise exception 'only the outgoing lead or the advisor can review items' using errcode = 'insufficient_privilege';
  end if;

  if p_action = 'edit' then
    if v_state = 'rejected' then
      raise exception 'reopen a rejected item before editing it' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_c) <> 'object' then
      raise exception 'changes must be an object' using errcode = 'invalid_parameter_value';
    end if;
    v_allowed := case v_kind
      when 'commitment' then array['description', 'owed_by', 'owed_to', 'due_text', 'due_date']
      else array['description', 'owed_by', 'cadence', 'approval_required', 'approver', 'lead_time', 'next_due', 'start_by']
    end;
    select array_agg(k) into v_bad from jsonb_object_keys(v_c) k where k <> all (v_allowed);
    if v_bad is not null then
      raise exception 'these fields cannot be edited: %', array_to_string(v_bad, ', ') using errcode = 'check_violation';
    end if;
    if v_c = '{}' then
      raise exception 'nothing to change' using errcode = 'check_violation';
    end if;
    if v_c ? 'description' and coalesce(trim(v_c ->> 'description'), '') = '' then
      raise exception 'the description cannot be empty' using errcode = 'check_violation';
    end if;
  end if;

  v_new := case p_action
    when 'accept' then case when v_state = 'edited' then 'edited' else 'accepted' end
    when 'edit' then 'edited'
    when 'reject' then 'rejected'
    else 'draft'
  end::public.review_state;

  perform set_config('app.review_action', 'on', true);
  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.audit_action', p_action, true);
  update public.obligations o set
    review_state = v_new,
    description = case when v_c ? 'description' then trim(v_c ->> 'description') else o.description end,
    owed_by = case when v_c ? 'owed_by' then nullif(trim(v_c ->> 'owed_by'), '') else o.owed_by end,
    owed_to = case when v_c ? 'owed_to' then nullif(trim(v_c ->> 'owed_to'), '') else o.owed_to end,
    due_text = case when v_c ? 'due_text' then nullif(trim(v_c ->> 'due_text'), '') else o.due_text end,
    due_date = case when v_c ? 'due_date' then nullif(trim(v_c ->> 'due_date'), '')::date else o.due_date end,
    cadence = case when v_c ? 'cadence' then nullif(trim(v_c ->> 'cadence'), '') else o.cadence end,
    approval_required = case when v_c ? 'approval_required' then nullif(trim(v_c ->> 'approval_required'), '') else o.approval_required end,
    approver = case when v_c ? 'approver' then nullif(trim(v_c ->> 'approver'), '') else o.approver end,
    lead_time = case when v_c ? 'lead_time' then nullif(trim(v_c ->> 'lead_time'), '') else o.lead_time end,
    next_due = case when v_c ? 'next_due' then nullif(trim(v_c ->> 'next_due'), '')::date else o.next_due end,
    start_by = case when v_c ? 'start_by' then nullif(trim(v_c ->> 'start_by'), '')::date else o.start_by end
  where o.id = p_id;
  perform set_config('app.review_action', '', true);
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.audit_action', '', true);

  -- A rejected item stops lending evidence; a reopened one may lend it again.
  if p_action in ('reject', 'reopen') then
    perform app.touch_obligations(app.with_linked(p_id));
  end if;
  return v_new;
end
$$;

-- The advisor's ruling on a conflict. It is recorded and shown as the advisor's decision; it
-- is not evidence, so the item stays contradicted while the records disagree.
create function public.rule_conflict(p_entry uuid, p_ruling text, p_reason text)
returns void
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  if p_ruling is null or p_ruling not in ('done', 'not_done', 'cannot_tell') then
    raise exception 'the ruling must be done, not done or cannot tell' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required for a ruling' using errcode = 'check_violation';
  end if;
  select d.workspace_id into v_ws from public.docket_entries d where d.id = p_entry;
  if v_ws is null then
    raise exception 'conflict not found' using errcode = 'no_data_found';
  end if;
  if not app.has_role(v_ws, array['advisor']::public.app_role[]) then
    raise exception 'only the faculty advisor can rule on a conflict' using errcode = 'insufficient_privilege';
  end if;
  perform set_config('app.review_action', 'on', true);
  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.audit_action', 'rule', true);
  update public.docket_entries d
     set ruling = p_ruling, reason = trim(p_reason), ruled_by = (select auth.uid()), ruled_at = now()
   where d.id = p_entry;
  perform set_config('app.review_action', '', true);
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.audit_action', '', true);
end
$$;

-- A reviewer's verdict on a pair: the same item, or "not the same". It is remembered, so a
-- later run never links a pair a reviewer has ruled out, and never unpicks a pair they joined.
create function public.set_link_verdict(p_workspace uuid, p_a uuid, p_b uuid, p_verdict text, p_reason text)
returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_a uuid := least(p_a, p_b);
  v_b uuid := greatest(p_a, p_b);
  v_id uuid;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can link items' using errcode = 'insufficient_privilege';
  end if;
  if p_verdict is null or p_verdict not in ('same', 'distinct') then
    raise exception 'the verdict must be same or distinct' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required' using errcode = 'check_violation';
  end if;
  if v_a is null or v_a = v_b then
    raise exception 'an item cannot be linked to itself' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.obligations o where o.id in (v_a, v_b) and o.workspace_id = p_workspace and o.review_state <> 'rejected') <> 2 then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;
  if (select count(distinct o.kind) from public.obligations o where o.id in (v_a, v_b)) <> 1 then
    raise exception 'only items of the same kind can be linked' using errcode = 'check_violation';
  end if;

  perform set_config('app.audit_reason', trim(p_reason), true);
  perform set_config('app.audit_action', case p_verdict when 'same' then 'link_same' else 'link_distinct' end, true);
  insert into public.obligation_links (workspace_id, a, b, verdict, method, created_by)
  values (p_workspace, v_a, v_b, p_verdict, 'reviewer', (select auth.uid()))
  on conflict (a, b) do update set verdict = excluded.verdict, method = 'reviewer', created_by = excluded.created_by
  returning id into v_id;
  perform set_config('app.audit_reason', '', true);
  perform set_config('app.audit_action', '', true);
  return v_id;
end
$$;

----------------------------------------------------------------------------------------
-- Version items (format 2) and context notes
----------------------------------------------------------------------------------------

-- What a version holds for one item. Contents are limited to what the item's own level may
-- carry: conflicts only if both claims are at or below it, links only to items it may borrow
-- from. Format 1 (0006) had the obligation and its evidence without the inferred flag.
create function app.version_item(p_obligation uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'format', 2,
    'obligation', to_jsonb(o) - 'private_uploaders' - 'reviewed_status' - 'reviewed_trust',
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'event_id', ev.event_id, 'quote', ev.quote, 'relation', ev.relation,
               'verified', ev.verified, 'inferred', ev.inferred)
             order by ev.id)
      from public.evidence ev where ev.obligation_id = o.id
    ), '[]'),
    'linked_same', coalesce((
      select jsonb_agg(x.id order by x.id)
      from (
        select o2.id
        from public.obligation_links l
        join public.obligations o2 on o2.id = case when l.a = o.id then l.b else l.a end
        where (l.a = o.id or l.b = o.id)
          and l.verdict = 'same'
          and o2.review_state <> 'rejected'
          and (o2.access_level < o.access_level
               or (o2.access_level = o.access_level
                   and (o.access_level <> 'private'
                        or (cardinality(o2.private_uploaders) > 0 and o2.private_uploaders <@ o.private_uploaders))))
      ) x
    ), '[]'),
    'conflicts', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', d.id, 'claim_a_event', d.claim_a_event, 'claim_b_event', d.claim_b_event,
               'quote_a', d.quote_a, 'quote_b', d.quote_b, 'summary', d.summary,
               'ruling', d.ruling, 'reason', d.reason, 'ruled_at', d.ruled_at)
             order by d.id)
      from public.docket_entries d
      join public.events ea on ea.id = d.claim_a_event
      join public.events eb on eb.id = d.claim_b_event
      where d.obligation_id = o.id
        and ea.access_level <= o.access_level and eb.access_level <= o.access_level
    ), '[]')
  )
  from public.obligations o
  where o.id = p_obligation
$$;

-- The part of any format's item that a reviewer can compare across formats, so older
-- versions (whose hashes are never rewritten) are not all reported as changed.
create function app.item_core(p_item jsonb) returns jsonb
language sql immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'obligation', jsonb_build_object(
      'description', p_item #> '{obligation,description}', 'owed_by', p_item #> '{obligation,owed_by}',
      'owed_to', p_item #> '{obligation,owed_to}', 'due_text', p_item #> '{obligation,due_text}',
      'due_date', p_item #> '{obligation,due_date}', 'next_due', p_item #> '{obligation,next_due}',
      'approval_required', p_item #> '{obligation,approval_required}', 'approver', p_item #> '{obligation,approver}',
      'status', p_item #> '{obligation,status}', 'trust_state', p_item #> '{obligation,trust_state}',
      'access_level', p_item #> '{obligation,access_level}'),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object('event_id', e ->> 'event_id', 'quote', e ->> 'quote', 'relation', e ->> 'relation') order by e ->> 'event_id', e ->> 'quote')
      from jsonb_array_elements(coalesce(p_item -> 'evidence', '[]')) e
    ), '[]')
  )
$$;

create table public.version_context_items (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.versions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid not null,
  context_item_id uuid not null,
  kind public.context_kind not null,
  text text not null,
  quote text,
  access_level public.access_level not null,
  private_uploaders uuid[] not null default '{}',
  unique (version_id, context_item_id)
);
create index version_context_items_version_idx on public.version_context_items (version_id, obligation_id);
alter table public.version_context_items enable row level security;

-- A note carries its own level, and its item must be readable in the version too.
create policy version_context_items_select on public.version_context_items for select to authenticated
  using (
    app.can_read(workspace_id, access_level, private_uploaders, 'context_item', context_item_id)
    and exists (
      select 1 from public.version_items vi
      where vi.version_id = version_context_items.version_id and vi.obligation_id = version_context_items.obligation_id
    )
  );

create trigger version_context_items_immutable before update or delete on public.version_context_items
  for each row execute function app.forbid_mutation();
create trigger version_context_items_no_truncate before truncate on public.version_context_items
  for each statement execute function app.forbid_mutation();

----------------------------------------------------------------------------------------
-- Sign-off and approval
----------------------------------------------------------------------------------------

-- Hash of everything an approval would hand over, apart from rulings (the advisor's rulings
-- must not invalidate the outgoing lead's mark). Any other change to an accepted item, a note
-- or the set of items does.
create function app.pending_hash(p_ws uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select md5(coalesce(string_agg(
    o.id::text || ':' || md5((app.version_item(o.id) - 'conflicts')::text) || ':' ||
    coalesce((select md5(string_agg(c.id::text || c.text || c.access_level::text, '|' order by c.id))
              from public.context_items c where c.obligation_id = o.id), ''),
    ',' order by o.id), ''))
  from public.obligations o
  where o.workspace_id = p_ws and o.review_state in ('accepted', 'edited')
$$;

create table public.review_signoffs (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  signed_by uuid references auth.users (id) on delete set null,
  pending_hash text not null,
  item_count integer not null,
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);
create index review_signoffs_workspace_idx on public.review_signoffs (workspace_id, seq desc);
alter table public.review_signoffs enable row level security;
create policy review_signoffs_select on public.review_signoffs for select to authenticated
  using (app.can_review(workspace_id));
create trigger review_signoffs_immutable before update or delete on public.review_signoffs
  for each row execute function app.forbid_mutation();
create trigger review_signoffs_no_truncate before truncate on public.review_signoffs
  for each statement execute function app.forbid_mutation();

-- The outgoing lead marks the accepted items ready for the advisor.
create function public.mark_ready(p_workspace uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_hash text;
  v_count integer;
begin
  if not app.has_role(p_workspace, array['outgoing_lead']::public.app_role[]) then
    raise exception 'only the outgoing lead can mark the draft ready for the advisor' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to mark the draft ready' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('approve_version:' || p_workspace::text));
  if exists (select 1 from public.obligations o where o.workspace_id = p_workspace and app.needs_rereview(o)) then
    raise exception 'some accepted items changed since they were accepted: review them again first' using errcode = 'check_violation';
  end if;
  select count(*) into v_count from public.obligations o where o.workspace_id = p_workspace and o.review_state in ('accepted', 'edited');
  if v_count = 0 then
    raise exception 'accept at least one item first' using errcode = 'check_violation';
  end if;
  v_hash := app.pending_hash(p_workspace);
  insert into public.review_signoffs (workspace_id, signed_by, pending_hash, item_count, reason)
  values (p_workspace, (select auth.uid()), v_hash, v_count, trim(p_reason))
  returning id into v_id;
  insert into public.audit_log (workspace_id, actor, action, target_type, target_id, reason, before, after, access_level)
  values (p_workspace, (select auth.uid()), 'mark_ready', 'review_signoffs', v_id::text, trim(p_reason),
          null, jsonb_build_object('item_count', v_count, 'pending_hash', v_hash), 'everyone');
  return v_id;
end
$$;

-- Approve the marked draft as a new immutable version. Advisor only, only while the lead's
-- mark still matches, and not while an accepted item awaits re-review.
create or replace function public.approve_version(p_workspace uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version uuid := gen_random_uuid();
  v_number integer;
  v_prev uuid;
  v_hashes jsonb;
  v_diff jsonb;
  v_signed text;
begin
  if not app.has_role(p_workspace, array['advisor']::public.app_role[]) then
    raise exception 'only the faculty advisor can approve a version' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to approve a version' using errcode = 'check_violation';
  end if;

  -- Serialise approvals and sign-offs per workspace.
  perform pg_advisory_xact_lock(hashtext('approve_version:' || p_workspace::text));

  if exists (select 1 from public.obligations o where o.workspace_id = p_workspace and app.needs_rereview(o)) then
    raise exception 'some accepted items changed since they were accepted: review them again first' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.obligations o where o.workspace_id = p_workspace and o.review_state in ('accepted', 'edited')) then
    raise exception 'there is nothing to approve: no item is accepted' using errcode = 'check_violation';
  end if;
  select s.pending_hash into v_signed from public.review_signoffs s
   where s.workspace_id = p_workspace order by s.seq desc limit 1;
  if v_signed is null then
    raise exception 'the outgoing lead has not marked the draft ready for the advisor' using errcode = 'check_violation';
  end if;
  if v_signed <> app.pending_hash(p_workspace) then
    raise exception 'the draft changed after the outgoing lead marked it ready: it must be marked ready again' using errcode = 'check_violation';
  end if;

  select v.id, v.number into v_prev, v_number
  from public.versions v
  where v.workspace_id = p_workspace
  order by v.number desc
  limit 1;
  v_number := coalesce(v_number, 0) + 1;

  create temp table _items on commit drop as
  select o.id as obligation_id, o.access_level, o.private_uploaders, app.version_item(o.id) as item
  from public.obligations o
  where o.workspace_id = p_workspace and o.review_state in ('accepted', 'edited');

  select coalesce(jsonb_object_agg(obligation_id::text, md5(item::text)), '{}') into v_hashes from _items;

  v_diff := jsonb_build_object(
    'previous_version', v_prev,
    'added', coalesce((select jsonb_agg(i.obligation_id order by i.obligation_id) from _items i
                        where not exists (select 1 from public.version_items p where p.version_id = v_prev and p.obligation_id = i.obligation_id)), '[]'),
    'removed', coalesce((select jsonb_agg(p.obligation_id order by p.obligation_id) from public.version_items p
                          where p.version_id = v_prev and not exists (select 1 from _items i where i.obligation_id = p.obligation_id)), '[]'),
    'changed', coalesce((select jsonb_agg(i.obligation_id order by i.obligation_id)
                           from _items i join public.version_items p on p.version_id = v_prev and p.obligation_id = i.obligation_id
                          where case when p.item_format = 2 then p.item_hash <> md5(i.item::text)
                                     else md5(app.item_core(p.item)::text) <> md5(app.item_core(i.item)::text) end), '[]')
  );

  insert into public.versions (id, workspace_id, number, approved_by, snapshot, diff)
  values (
    v_version, p_workspace, v_number, (select auth.uid()),
    jsonb_build_object('obligation_count', (select count(*) from _items), 'hashes', v_hashes),
    v_diff
  );

  insert into public.version_items (version_id, workspace_id, obligation_id, access_level, private_uploaders, item, item_hash, item_format)
  select v_version, p_workspace, i.obligation_id, i.access_level, i.private_uploaders, i.item, md5(i.item::text), 2
  from _items i;

  insert into public.version_context_items (version_id, workspace_id, obligation_id, context_item_id, kind, text, quote, access_level, private_uploaders)
  select v_version, p_workspace, c.obligation_id, c.id, c.kind, c.text, c.quote, c.access_level, c.private_uploaders
  from public.context_items c join _items i on i.obligation_id = c.obligation_id;

  insert into public.audit_log (workspace_id, actor, action, target_type, target_id, reason, before, after, access_level)
  values (p_workspace, (select auth.uid()), 'approve_version', 'versions', v_version::text, p_reason,
          null, jsonb_build_object('number', v_number, 'diff', v_diff), 'everyone');

  drop table _items;
  return v_version;
end
$$;

-- The accepted items as the next version would hold them, for the items the caller may read
-- (RLS on obligations filters first), with whether each awaits re-review.
create function public.pending_review(p_workspace uuid)
returns table (obligation_id uuid, review_state public.review_state, needs_rereview boolean, item jsonb, item_hash text)
language sql stable security invoker
set search_path = ''
as $$
  select o.id, o.review_state, app.needs_rereview(o), v.item, md5(v.item::text)
  from public.obligations o
  cross join lateral (select app.version_item(o.id) as item) v
  where o.workspace_id = p_workspace and o.review_state in ('accepted', 'edited')
$$;

revoke execute on function public.review_obligation(uuid, text, text, jsonb) from public, anon;
revoke execute on function public.rule_conflict(uuid, text, text) from public, anon;
revoke execute on function public.set_link_verdict(uuid, uuid, uuid, text, text) from public, anon;
revoke execute on function public.mark_ready(uuid, text) from public, anon;
revoke execute on function public.pending_review(uuid) from public, anon;
grant execute on function public.review_obligation(uuid, text, text, jsonb) to authenticated;
grant execute on function public.rule_conflict(uuid, text, text) to authenticated;
grant execute on function public.set_link_verdict(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.mark_ready(uuid, text) to authenticated;
grant execute on function public.pending_review(uuid) to authenticated;
grant execute on all functions in schema app to anon, authenticated, service_role;
