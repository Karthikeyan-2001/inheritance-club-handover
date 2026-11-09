-- Inheritance: matching, the trust rule and the docket (Phase 6).
--   * obligation_links records that two items are the same obligation recorded twice
--     ('same'), or might be ('possible'). Items are never merged.
--   * An item's effective evidence is its own verified evidence plus that of items linked as
--     'same' at the same or a less restricted level (app.effective_evidence). Restricted
--     records never change what a less restricted reader is told.
--   * Trust is set only by app.trust_rule(), mirrored by trustState() in
--     src/lib/pipeline/trust.ts. Keep the two in sync. It runs in the obligation trigger, so
--     it follows every change to evidence and links, including files being removed.
--   * A checked commitment's status follows its effective evidence the same way.
--   * A contradicted item gets a docket entry (done claim against not-done claim, both
--     quotes), kept in step by app.sync_docket().

----------------------------------------------------------------------------------------
-- Links
----------------------------------------------------------------------------------------

create table public.obligation_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  a uuid not null references public.obligations (id) on delete cascade,
  b uuid not null references public.obligations (id) on delete cascade,
  verdict text not null check (verdict in ('same', 'possible')),
  method text not null check (method in ('rule', 'model')),
  score real,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (a < b),
  unique (a, b)
);
create index obligation_links_a_idx on public.obligation_links (a);
create index obligation_links_b_idx on public.obligation_links (b);
create index obligation_links_workspace_idx on public.obligation_links (workspace_id);

alter table public.obligation_links enable row level security;

-- A link is visible only to someone who can read both items.
create policy obligation_links_select on public.obligation_links for select to authenticated
  using (app.can_read_obligation(a) and app.can_read_obligation(b));
create policy obligation_links_insert on public.obligation_links for insert to authenticated
  with check (
    app.can_review(workspace_id)
    and app.obligation_workspace(a) = workspace_id and app.obligation_workspace(b) = workspace_id
    and app.can_read_obligation(a) and app.can_read_obligation(b)
    and created_by = (select auth.uid())
  );
create policy obligation_links_update on public.obligation_links for update to authenticated
  using (app.can_review(workspace_id) and app.can_read_obligation(a) and app.can_read_obligation(b))
  with check (app.can_review(workspace_id) and app.can_read_obligation(a) and app.can_read_obligation(b));
create policy obligation_links_delete on public.obligation_links for delete to authenticated
  using (app.can_review(workspace_id) and app.can_read_obligation(a) and app.can_read_obligation(b));

----------------------------------------------------------------------------------------
-- Docket: which item, which quotes, and who made the entry
----------------------------------------------------------------------------------------

alter table public.docket_entries
  add column obligation_id uuid references public.obligations (id) on delete cascade,
  add column quote_a text,
  add column quote_b text,
  -- 'rule': made by app.sync_docket(); 'manual': raised by a reviewer.
  add column origin text not null default 'manual' check (origin in ('rule', 'manual')),
  add column created_at timestamptz not null default now(),
  add constraint docket_entries_claims_key unique (obligation_id, claim_a_event, claim_b_event);
create index docket_entries_obligation_idx on public.docket_entries (obligation_id);

-- Visible only if both claims and the item they are about are readable.
drop policy docket_select on public.docket_entries;
drop policy docket_insert on public.docket_entries;
drop policy docket_update on public.docket_entries;
create policy docket_select on public.docket_entries for select to authenticated
  using (
    app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event)
    and (obligation_id is null or app.can_read_obligation(obligation_id))
  );
create policy docket_insert on public.docket_entries for insert to authenticated
  with check (
    app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event)
    and (obligation_id is null or (app.obligation_workspace(obligation_id) = workspace_id and app.can_read_obligation(obligation_id)))
  );
create policy docket_update on public.docket_entries for update to authenticated
  using (
    app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event)
    and (obligation_id is null or app.can_read_obligation(obligation_id))
  )
  with check (
    app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event)
    and (obligation_id is null or (app.obligation_workspace(obligation_id) = workspace_id and app.can_read_obligation(obligation_id)))
  );

----------------------------------------------------------------------------------------
-- Effective evidence, the trust rule and the status rule
----------------------------------------------------------------------------------------

-- A message author as a comparable name; null when unknown. Mirrors person() in trust.ts.
create function app.person(p text) returns text
language sql immutable
set search_path = ''
as $$ select nullif(lower(trim(regexp_replace(normalize(coalesce(p, ''), NFKC), '\s+', ' ', 'g'))), '') $$;

-- The verified evidence an item may rely on, given its level and private uploaders: its own,
-- and that of items linked as 'same' that everyone who reads this item can also read.
-- Mirrors canBorrow() in trust.ts.
create function app.effective_evidence(p_obligation uuid, p_level public.access_level, p_uploaders uuid[])
returns table (relation public.evidence_relation, inferred boolean, event_id uuid, source_id uuid, author text, ts timestamptz, quote text, borrowed boolean)
language sql stable security definer
set search_path = ''
as $$
  select ev.relation, ev.inferred, ev.event_id, e.source_id, e.author, e.ts, ev.quote, false
  from public.evidence ev
  join public.events e on e.id = ev.event_id
  where ev.obligation_id = p_obligation and ev.verified
  union all
  select ev.relation, ev.inferred, ev.event_id, e.source_id, e.author, e.ts, ev.quote, true
  from public.obligation_links l
  join public.obligations o on o.id = case when l.a = p_obligation then l.b else l.a end
  join public.evidence ev on ev.obligation_id = o.id and ev.verified
  join public.events e on e.id = ev.event_id
  where (l.a = p_obligation or l.b = p_obligation)
    and l.verdict = 'same'
    and o.review_state <> 'rejected'
    and (
      o.access_level < p_level
      or (o.access_level = p_level
          and (p_level <> 'private'
               or (cardinality(o.private_uploaders) > 0 and o.private_uploaders <@ coalesce(p_uploaders, '{}'))))
    )
$$;

-- The trust rule. Only verified evidence counts:
--   none                                      -> gap
--   says done and says not done               -> contradicted
--   done only by inference                    -> inferred
--   two independent records agree             -> corroborated
--   otherwise                                 -> sourced
-- Independent: different messages, from different files or different named people.
create function app.trust_rule(p_obligation uuid, p_level public.access_level, p_uploaders uuid[])
returns public.trust_state
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_any boolean;
  v_done boolean;
  v_direct boolean;
  v_not_done boolean;
  v_independent boolean;
begin
  with ee as materialized (select * from app.effective_evidence(p_obligation, p_level, p_uploaders))
  select count(*) > 0,
         coalesce(bool_or(ee.relation = 'fulfils'), false),
         coalesce(bool_or(ee.relation = 'fulfils' and not ee.inferred), false),
         coalesce(bool_or(ee.relation = 'contradicts'), false),
         exists (
           select 1 from ee x join ee y on x.event_id <> y.event_id
           where not x.inferred and not y.inferred
             and (x.source_id <> y.source_id
                  or (app.person(x.author) is not null and app.person(y.author) is not null
                      and app.person(x.author) <> app.person(y.author))))
    into v_any, v_done, v_direct, v_not_done, v_independent
  from ee;

  return case
    when not v_any then 'gap'
    when v_done and v_not_done then 'contradicted'
    when v_done and not v_direct then 'inferred'
    when v_independent then 'corroborated'
    else 'sourced'
  end::public.trust_state;
end
$$;

-- The status rule of app.followup_status() (0010), over effective evidence.
create function app.status_rule(p_obligation uuid, p_level public.access_level, p_uploaders uuid[])
returns public.obligation_status
language sql stable security definer
set search_path = ''
as $$
  select case
    when done and not_done then 'contradicted'
    when direct then 'fulfilled'
    when done then 'likely_fulfilled'
    when not_done then 'open'
    else 'no_evidence'
  end::public.obligation_status
  from (
    select coalesce(bool_or(ee.relation = 'fulfils'), false) as done,
           coalesce(bool_or(ee.relation = 'fulfils' and not ee.inferred), false) as direct,
           coalesce(bool_or(ee.relation = 'contradicts'), false) as not_done
    from app.effective_evidence(p_obligation, p_level, p_uploaders) ee
  ) s
$$;

-- Same rule as before, now over the item's effective evidence (record_followup uses it).
create or replace function app.followup_status(p_obligation uuid) returns public.obligation_status
language sql stable security definer
set search_path = ''
as $$
  select app.status_rule(o.id, o.access_level, o.private_uploaders)
  from public.obligations o
  where o.id = p_obligation
$$;

-- Provenance (0005) plus the derived fields. Trust is always recomputed, so no client can
-- set it. A checked commitment's status is recomputed when its evidence or links change
-- (the derived-update path); a reviewer's direct edit of the status is left alone.
create or replace function app.obligation_provenance() returns trigger
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

  new.trust_state := app.trust_rule(new.id, new.access_level, new.private_uploaders);
  if new.kind = 'commitment' and new.fulfilment_checked_at is not null and app.flag('app.derived_update') then
    new.status := app.status_rule(new.id, new.access_level, new.private_uploaders);
  end if;
  return new;
end
$$;

----------------------------------------------------------------------------------------
-- Docket
----------------------------------------------------------------------------------------

create function app.source_label(p_type public.source_type) returns text
language sql immutable
set search_path = ''
as $$ select case p_type when 'whatsapp' then 'WhatsApp' when 'trello' then 'Trello' else 'Minutes' end $$;

-- "Trello, 16 Mar 2026: says it was done. WhatsApp, 18 Mar 2026: says it was not." Built
-- by code from the two messages' file type and date; it holds no message text.
create function app.docket_summary(p_done uuid, p_not_done uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select format('%s, %s: says it was done. %s, %s: says it was not.',
    app.source_label(sa.type), coalesce(to_char(ea.ts at time zone 'Asia/Kolkata', 'FMDD Mon YYYY'), 'undated'),
    app.source_label(sb.type), coalesce(to_char(eb.ts at time zone 'Asia/Kolkata', 'FMDD Mon YYYY'), 'undated'))
  from public.events ea join public.sources sa on sa.id = ea.source_id,
       public.events eb join public.sources sb on sb.id = eb.source_id
  where ea.id = p_done and eb.id = p_not_done
$$;

-- Keep an item's docket entry in step with its trust. A contradicted item without an entry
-- gets one: its latest stated "done" claim against its latest "not done" claim. An entry the
-- rule made is removed once the conflict is gone, unless it has been ruled on.
create function app.sync_docket(p_obligation uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_trust public.trust_state;
  v_level public.access_level;
  v_uploaders uuid[];
  v_done record;
  v_not record;
  v_reason text := coalesce(current_setting('app.audit_reason', true), '');
begin
  select o.workspace_id, o.trust_state, o.access_level, o.private_uploaders
    into v_ws, v_trust, v_level, v_uploaders
  from public.obligations o where o.id = p_obligation;
  if v_ws is null then
    return;
  end if;

  if v_trust <> 'contradicted' then
    if exists (select 1 from public.docket_entries d where d.obligation_id = p_obligation and d.origin = 'rule' and d.ruling is null) then
      perform set_config('app.audit_reason', 'The conflict no longer holds: the records no longer say both done and not done', true);
      delete from public.docket_entries d where d.obligation_id = p_obligation and d.origin = 'rule' and d.ruling is null;
      perform set_config('app.audit_reason', v_reason, true);
    end if;
    return;
  end if;

  if exists (select 1 from public.docket_entries d where d.obligation_id = p_obligation) then
    return;
  end if;
  select x.event_id, x.quote into v_done
  from app.effective_evidence(p_obligation, v_level, v_uploaders) x
  where x.relation = 'fulfils'
  order by x.inferred, x.ts desc nulls last, x.event_id
  limit 1;
  select x.event_id, x.quote into v_not
  from app.effective_evidence(p_obligation, v_level, v_uploaders) x
  where x.relation = 'contradicts'
  order by x.ts desc nulls last, x.event_id
  limit 1;
  if v_done.event_id is null or v_not.event_id is null then
    return;
  end if;

  perform set_config('app.audit_reason', 'Conflict found by the trust rule: one record says it was done, another says it was not', true);
  insert into public.docket_entries (workspace_id, obligation_id, claim_a_event, claim_b_event, quote_a, quote_b, summary, origin)
  values (v_ws, p_obligation, v_done.event_id, v_not.event_id, v_done.quote, v_not.quote,
          coalesce(app.docket_summary(v_done.event_id, v_not.event_id), 'One record says it was done; another says it was not.'), 'rule')
  on conflict on constraint docket_entries_claims_key do nothing;
  perform set_config('app.audit_reason', v_reason, true);
end
$$;

-- Recompute the derived fields of these items (in order: an item before the items that
-- borrow from it), then their docket entries. Derived updates are not audited; docket
-- changes are.
create function app.touch_obligations(p_ids uuid[]) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_prev text := coalesce(current_setting('app.derived_update', true), '');
  v_id uuid;
begin
  perform set_config('app.derived_update', 'on', true);
  foreach v_id in array coalesce(p_ids, '{}') loop
    update public.obligations set private_uploaders = private_uploaders where id = v_id;
  end loop;
  perform set_config('app.derived_update', v_prev, true);
  foreach v_id in array coalesce(p_ids, '{}') loop
    perform app.sync_docket(v_id);
  end loop;
end
$$;

-- An item and the items linked to it as the same.
create function app.with_linked(p_obligation uuid) returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select array[p_obligation] || coalesce(array_agg(case when l.a = p_obligation then l.b else l.a end order by l.created_at), '{}')
  from public.obligation_links l
  where (l.a = p_obligation or l.b = p_obligation) and l.verdict = 'same'
$$;

-- When evidence changes, recompute the item and the items that may borrow from it.
create or replace function app.evidence_touch_obligation() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.flag('app.allow_workspace_delete') then
    return null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.touch_obligations(app.with_linked(new.obligation_id));
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.obligation_id <> new.obligation_id) then
    perform app.touch_obligations(app.with_linked(old.obligation_id));
  end if;
  return null;
end
$$;

-- When a link changes, recompute both items.
create function app.link_touch_obligations() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if app.flag('app.allow_workspace_delete') then
    return null;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform app.touch_obligations(array[new.a, new.b]);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (old.a, old.b) is distinct from (new.a, new.b)) then
    perform app.touch_obligations(array[old.a, old.b]);
  end if;
  return null;
end
$$;

create trigger obligation_links_touch
  after insert or update or delete on public.obligation_links
  for each row execute function app.link_touch_obligations();

----------------------------------------------------------------------------------------
-- Audit: links, and docket entries now tied to their item
----------------------------------------------------------------------------------------

-- A link row holds ids only, but it reveals that two items are related, so it is audited at
-- the level of the more restricted item.
create function app.audit_link() returns trigger
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
    v_row.workspace_id, (select auth.uid()), lower(tg_op), 'obligation_links', v_row.id::text, v_obligation,
    nullif(current_setting('app.audit_reason', true), ''),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end,
    v_level, v_uploaders
  );
  return null;
end
$$;

create trigger audit_obligation_links after insert or update or delete on public.obligation_links
  for each row execute function app.audit_link();

-- As in 0005, with docket entries attributed to their item: reading the audit row then also
-- requires being able to read that item, and its level counts.
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

----------------------------------------------------------------------------------------
-- Linking two items (the pipeline's matching stage, and later reviewers)
----------------------------------------------------------------------------------------

-- Runs as the caller (RLS applies): both items must be readable, in this workspace, of the
-- same kind and not rejected. A 'possible' link may later be upgraded to 'same'; a link is
-- never downgraded here.
create function public.link_obligations(p_workspace uuid, p_a uuid, p_b uuid, p_verdict text, p_method text, p_score real)
returns table (link_id uuid, created boolean, verdict text)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_a uuid := least(p_a, p_b);
  v_b uuid := greatest(p_a, p_b);
  v_ka public.obligation_kind;
  v_kb public.obligation_kind;
  v_id uuid;
  v_old text;
  v_created boolean := false;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can link items' using errcode = 'insufficient_privilege';
  end if;
  if p_verdict is null or p_verdict not in ('same', 'possible') or p_method is null or p_method not in ('rule', 'model') then
    raise exception 'unknown link verdict or method' using errcode = 'check_violation';
  end if;
  if v_a is null or v_a = v_b then
    raise exception 'an item cannot be linked to itself' using errcode = 'check_violation';
  end if;
  select o.kind into v_ka from public.obligations o where o.id = v_a and o.workspace_id = p_workspace and o.review_state <> 'rejected';
  select o.kind into v_kb from public.obligations o where o.id = v_b and o.workspace_id = p_workspace and o.review_state <> 'rejected';
  if v_ka is null or v_kb is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;
  if v_ka <> v_kb then
    raise exception 'only items of the same kind can be linked' using errcode = 'check_violation';
  end if;

  select l.id, l.verdict into v_id, v_old from public.obligation_links l where l.a = v_a and l.b = v_b;
  perform set_config('app.audit_reason',
    case when p_method = 'rule' then 'Matched by rule: near-identical wording about the same people'
         else 'Matched by the language model; the verdict is the only thing it returned' end, true);
  if v_id is null then
    insert into public.obligation_links (workspace_id, a, b, verdict, method, score, created_by)
    values (p_workspace, v_a, v_b, p_verdict, p_method, p_score, (select auth.uid()))
    returning id into v_id;
    v_created := true;
    v_old := p_verdict;
  elsif v_old = 'possible' and p_verdict = 'same' then
    update public.obligation_links l set verdict = 'same', method = p_method, score = p_score where l.id = v_id;
    v_old := 'same';
  end if;
  perform set_config('app.audit_reason', '', true);
  return query select v_id, v_created, v_old;
end
$$;

revoke execute on function public.link_obligations(uuid, uuid, uuid, text, text, real) from public, anon;
grant execute on function public.link_obligations(uuid, uuid, uuid, text, text, real) to authenticated;
grant execute on all functions in schema app to anon, authenticated, service_role;

----------------------------------------------------------------------------------------
-- Existing data: tie docket entries to their item, then settle every item
----------------------------------------------------------------------------------------

select set_config('app.audit_reason', 'Docket entry tied to the item whose evidence it cites (migration 0011)', true);
update public.docket_entries d
   set obligation_id = m.obligation_id, quote_a = m.qa, quote_b = m.qb
  from (
    select distinct on (d2.id) d2.id, a.obligation_id, a.quote as qa, b.quote as qb
    from public.docket_entries d2
    join public.evidence a on a.event_id = d2.claim_a_event
    join public.evidence b on b.event_id = d2.claim_b_event and b.obligation_id = a.obligation_id
    order by d2.id, a.obligation_id
  ) m
 where m.id = d.id and d.obligation_id is null;

select set_config('app.audit_reason', 'Trust and status recomputed by the trust rule (migration 0011)', true);
select app.touch_obligations(array(select o.id from public.obligations o order by o.created_at));
select set_config('app.audit_reason', '', true);
