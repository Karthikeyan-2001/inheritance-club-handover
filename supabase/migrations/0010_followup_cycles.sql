-- Inheritance: fulfilment, recurring duties and context items (Phase 5).
--   * evidence.inferred marks follow-up evidence that implies, rather than states, completion.
--   * A commitment's status is derived from its verified evidence by app.followup_status(),
--     mirrored by followupStatus() in src/lib/pipeline/status.ts. Keep the two in sync.
--   * Recurring duties carry their cadence, lead time and derived next-due/start-by dates.
--   * Context items cite a message and a verified quote, and inherit that message's level.
--   * A pipeline run has stages; claim_next_run_job() hands out jobs stage by stage.

alter table public.evidence
  add column inferred boolean not null default false;

alter table public.obligations
  add column fulfilment_checked_at timestamptz,
  add column period text check (period in ('semester', 'year', 'month', 'week', 'each_time', 'other')),
  add column cadence text,
  add column lead_time text,
  add column start_by date,
  add column next_due_basis text;

alter table public.context_items
  add column event_id uuid references public.events (id) on delete cascade,
  add column quote text,
  add column verified boolean not null default false,
  add column private_uploaders uuid[] not null default '{}',
  add column created_at timestamptz not null default now();
create index context_items_event_idx on public.context_items (event_id);

----------------------------------------------------------------------------------------
-- Shared checks
----------------------------------------------------------------------------------------

-- The quote check of add_extracted_commitment(), as a function.
create function app.quote_in(p_quote text, p_text text) returns boolean
language sql immutable
set search_path = ''
as $$
  select length(app.norm_quote(p_quote)) >= least(12, length(app.norm_quote(p_text)))
     and length(app.norm_quote(p_quote)) > 0
     and position(app.norm_quote(p_quote) in app.norm_quote(p_text)) > 0
$$;

-- Words such as an approver or a lead time must appear in one of the given quotes.
create function app.grounded_in(p_words text, p_quotes text[]) returns boolean
language sql immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(p_quotes) q
    where position(app.norm_quote(p_words) in app.norm_quote(q)) > 0
  )
$$;

-- Messages that may share a model prompt: same level, and same uploader for private files.
-- Mirrors visibilityKey() in src/lib/pipeline/extract.ts.
create function app.visibility_key(p_level public.access_level, p_source uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select case when p_level = 'private'
    then 'private:' || coalesce((select s.uploaded_by::text from public.sources s where s.id = p_source), 'unknown')
    else p_level::text end
$$;

create function app.try_uuid(p text) returns uuid
language plpgsql immutable
set search_path = ''
as $$
begin
  return p::uuid;
exception when others then
  return null;
end
$$;

-- When the promise behind an obligation was made: its earliest supporting message.
-- Returns a time only, never text.
create function app.obligation_since(p_obligation uuid) returns timestamptz
language sql stable security definer
set search_path = ''
as $$
  select min(e.ts)
  from public.evidence ev join public.events e on e.id = ev.event_id
  where ev.obligation_id = p_obligation and ev.relation = 'supports'
$$;

-- The status rule. Only verified evidence counts:
--   says done and says not done  -> contradicted
--   says done                    -> fulfilled
--   only implies done            -> likely_fulfilled
--   only says not done           -> open (still owed)
--   nothing                      -> no_evidence
-- SECURITY DEFINER so the result does not depend on who runs the check. It returns a status
-- only; an obligation is already raised to the level of every message it cites.
create function app.followup_status(p_obligation uuid) returns public.obligation_status
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_done boolean;
  v_direct boolean;
  v_not_done boolean;
begin
  select coalesce(bool_or(ev.relation = 'fulfils'), false),
         coalesce(bool_or(ev.relation = 'fulfils' and not ev.inferred), false),
         coalesce(bool_or(ev.relation = 'contradicts'), false)
    into v_done, v_direct, v_not_done
  from public.evidence ev
  where ev.obligation_id = p_obligation and ev.verified;

  return case
    when v_done and v_not_done then 'contradicted'
    when v_direct then 'fulfilled'
    when v_done then 'likely_fulfilled'
    when v_not_done then 'open'
    else 'no_evidence'
  end::public.obligation_status;
end
$$;

----------------------------------------------------------------------------------------
-- Context items: own level and private uploaders, from the message they cite
----------------------------------------------------------------------------------------

create function app.context_item_provenance() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_level public.access_level;
  v_uploader uuid;
begin
  if new.event_id is null then
    new.private_uploaders := '{}';
    return new;
  end if;
  select e.access_level, coalesce(s.uploaded_by, app.nobody())
    into v_level, v_uploader
  from public.events e join public.sources s on s.id = e.source_id
  where e.id = new.event_id;
  v_level := coalesce(v_level, 'private');
  new.access_level := greatest(new.access_level, v_level);
  new.private_uploaders := case when v_level = 'private' then array[coalesce(v_uploader, app.nobody())] else '{}' end;
  return new;
end
$$;

create trigger context_items_provenance
  before insert or update on public.context_items
  for each row execute function app.context_item_provenance();

-- A private context item built from one person's file uses that file's uploader, so the
-- outgoing lead can read context from their own private files (the obligation still has
-- to be readable). Otherwise the obligation's uploaders apply, as before.
create or replace function app.can_read_context_item(p_id uuid, p_obligation_id uuid, p_level public.access_level)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_read_obligation(o.id)
       and app.can_read(
             o.workspace_id, p_level,
             coalesce(
               nullif((select ci.private_uploaders from public.context_items ci where ci.id = p_id), '{}'::uuid[]),
               o.private_uploaders),
             'context_item', p_id)
    from public.obligations o
    where o.id = p_obligation_id
  ), false)
$$;

----------------------------------------------------------------------------------------
-- Follow-up: fulfilment evidence and context for one obligation
----------------------------------------------------------------------------------------

-- Runs as the caller (RLS applies). Every item is re-checked here: the cited message must be
-- readable, the quote must be in it, and fulfilment evidence must come from a later message
-- than the promise. Items that fail are counted, not stored. The commitment's status is then
-- recomputed from its verified evidence, and the check is recorded even when nothing is found.
create function public.record_followup(p_workspace uuid, p_obligation uuid, p_evidence jsonb, p_context jsonb)
returns table (evidence_added integer, context_added integer, duplicates integer, rejected integer, status public.obligation_status)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_kind public.obligation_kind;
  v_status public.obligation_status;
  v_since timestamptz;
  v_item jsonb;
  v_event uuid;
  v_quote text;
  v_rel text;
  v_ckind text;
  v_note text;
  v_text text;
  v_ts timestamptz;
  v_level public.access_level;
  v_added integer := 0;
  v_ctx integer := 0;
  v_dup integer := 0;
  v_rej integer := 0;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can record follow-ups' using errcode = 'insufficient_privilege';
  end if;
  select o.kind, o.status into v_kind, v_status
  from public.obligations o
  where o.id = p_obligation and o.workspace_id = p_workspace;
  if v_kind is null then
    raise exception 'obligation not found' using errcode = 'no_data_found';
  end if;
  v_since := app.obligation_since(p_obligation);

  perform set_config('app.audit_reason', 'Follow-up found by the language model; quote verified against the source message', true);

  for v_item in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) loop
    v_event := app.try_uuid(v_item ->> 'event_id');
    v_quote := trim(coalesce(v_item ->> 'quote', ''));
    v_rel := v_item ->> 'relation';
    v_text := null;
    select e.text, e.ts into v_text, v_ts
    from public.events e where e.id = v_event and e.workspace_id = p_workspace;
    if v_kind <> 'commitment'
       or v_rel is null or v_rel not in ('fulfils', 'contradicts')
       or v_text is null or not app.quote_in(v_quote, v_text)
       or v_since is null or v_ts is null or v_ts < v_since
       or exists (select 1 from public.evidence ev
                  where ev.obligation_id = p_obligation and ev.event_id = v_event and ev.relation = 'supports') then
      v_rej := v_rej + 1;
      continue;
    end if;
    if exists (select 1 from public.evidence ev
               where ev.obligation_id = p_obligation and ev.event_id = v_event
                 and app.norm_quote(ev.quote) = app.norm_quote(v_quote)) then
      v_dup := v_dup + 1;
      continue;
    end if;
    insert into public.evidence (obligation_id, event_id, quote, relation, verified, inferred)
    values (p_obligation, v_event, v_quote, v_rel::public.evidence_relation, true,
            v_rel = 'fulfils' and coalesce((v_item ->> 'inferred')::boolean, false));
    v_added := v_added + 1;
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_context, '[]'::jsonb)) loop
    v_event := app.try_uuid(v_item ->> 'event_id');
    v_quote := trim(coalesce(v_item ->> 'quote', ''));
    v_ckind := v_item ->> 'kind';
    v_note := trim(coalesce(v_item ->> 'note', ''));
    v_text := null;
    select e.text, e.access_level into v_text, v_level
    from public.events e where e.id = v_event and e.workspace_id = p_workspace;
    if v_ckind is null or v_ckind not in ('decision', 'contact', 'risk', 'dependency')
       or length(v_note) = 0 or length(v_note) > 300
       or v_text is null or not app.quote_in(v_quote, v_text) then
      v_rej := v_rej + 1;
      continue;
    end if;
    if exists (select 1 from public.context_items c
               where c.obligation_id = p_obligation and c.event_id = v_event and c.kind = v_ckind::public.context_kind
                 and app.norm_quote(c.quote) = app.norm_quote(v_quote)) then
      v_dup := v_dup + 1;
      continue;
    end if;
    insert into public.context_items (obligation_id, kind, text, access_level, event_id, quote, verified)
    values (p_obligation, v_ckind::public.context_kind, v_note, v_level, v_event, v_quote, true);
    v_ctx := v_ctx + 1;
  end loop;

  if v_kind = 'commitment' then
    v_status := app.followup_status(p_obligation);
    update public.obligations o
       set status = v_status, fulfilment_checked_at = coalesce(o.fulfilment_checked_at, now())
     where o.id = p_obligation
       and (o.status is distinct from v_status or o.fulfilment_checked_at is null);
  end if;

  perform set_config('app.audit_reason', '', true);
  return query select v_added, v_ctx, v_dup, v_rej, v_status;
end
$$;

----------------------------------------------------------------------------------------
-- Recurring duties
----------------------------------------------------------------------------------------

-- Runs as the caller. p_quotes: [{event_id, quote, relation: 'supports' | 'past_instance'}].
-- Every quote must be verbatim in a readable message, at least one must state the duty, and
-- the cadence, approver and lead-time words must appear in those quotes. All quotes must come
-- from records with the same access (level, and uploader for private files): the description
-- was written from them, so it must not carry text from a more restricted record.
-- A duty that matches one already stored at the same level (a shared quote, or a similar
-- description) is merged: new quotes are added and only empty fields are filled. A duty that
-- matches one stored at a less restricted level is not stored again.
create function public.add_recurring_duty(
  p_workspace uuid,
  p_description text,
  p_period text,
  p_cadence text,
  p_approval text,
  p_approver text,
  p_lead_time text,
  p_owed_by text,
  p_next_due date,
  p_start_by date,
  p_next_due_basis text,
  p_quotes jsonb
) returns table (obligation_id uuid, created boolean, quotes_added integer)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_item jsonb;
  v_event uuid;
  v_quote text;
  v_rel text;
  v_text text;
  v_level public.access_level;
  v_max public.access_level;
  v_quotes text[] := '{}';
  v_events uuid[] := '{}';
  v_rels text[] := '{}';
  v_levels public.access_level[] := '{}';
  v_has_rule boolean := false;
  v_key text;
  v_first_key text;
  v_id uuid;
  v_created boolean := false;
  v_added integer := 0;
  i integer;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can add recurring duties' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'a recurring duty needs a description' using errcode = 'check_violation';
  end if;
  if p_period is null or p_period not in ('semester', 'year', 'month', 'week', 'each_time', 'other') then
    raise exception 'unknown period' using errcode = 'check_violation';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_quotes, '[]'::jsonb)) loop
    v_event := app.try_uuid(v_item ->> 'event_id');
    v_quote := trim(coalesce(v_item ->> 'quote', ''));
    v_rel := v_item ->> 'relation';
    v_text := null;
    select e.text, e.access_level, app.visibility_key(e.access_level, e.source_id) into v_text, v_level, v_key
    from public.events e where e.id = v_event and e.workspace_id = p_workspace;
    if v_text is null then
      raise exception 'cited message not found' using errcode = 'no_data_found';
    end if;
    if v_first_key is null then
      v_first_key := v_key;
    elsif v_key <> v_first_key then
      raise exception 'a recurring duty''s quotes must all come from records with the same access' using errcode = 'check_violation';
    end if;
    if not app.quote_in(v_quote, v_text) then
      raise exception 'quote is not a verbatim part of the cited message' using errcode = 'check_violation';
    end if;
    if v_rel is null or v_rel not in ('supports', 'past_instance') then
      raise exception 'unknown quote relation' using errcode = 'check_violation';
    end if;
    v_has_rule := v_has_rule or v_rel = 'supports';
    v_quotes := v_quotes || v_quote;
    v_events := v_events || v_event;
    v_rels := v_rels || v_rel;
    v_levels := v_levels || v_level;
    v_max := greatest(v_max, v_level);
  end loop;

  if not v_has_rule then
    raise exception 'a recurring duty needs a quote that states it' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_cadence), '') = '' or not app.grounded_in(p_cadence, v_quotes) then
    raise exception 'the cadence must appear in the quotes' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_approver, '')), '') is not null and not app.grounded_in(p_approver, v_quotes) then
    raise exception 'the approver must appear in the quotes' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_lead_time, '')), '') is not null and not app.grounded_in(p_lead_time, v_quotes) then
    raise exception 'the lead time must appear in the quotes' using errcode = 'check_violation';
  end if;

  -- Same duty already stored at this level? A shared quote, or a similar description.
  select o.id into v_id
  from public.obligations o
  where o.workspace_id = p_workspace
    and o.kind = 'recurring'
    and o.review_state <> 'rejected'
    and o.access_level = v_max
    and (
      exists (select 1 from public.evidence ev, unnest(v_events, v_quotes) as q(event_id, quote)
              where ev.obligation_id = o.id and ev.event_id = q.event_id
                and app.norm_quote(ev.quote) = app.norm_quote(q.quote))
      or app.norm_quote(o.description) = app.norm_quote(p_description)
      or extensions.similarity(lower(o.description), lower(p_description)) >= 0.55
    )
  order by extensions.similarity(lower(o.description), lower(p_description)) desc, o.created_at
  limit 1;

  -- Already known from less restricted records? Then it is not stored again at this level.
  if v_id is null then
    select o.id into v_id
    from public.obligations o
    where o.workspace_id = p_workspace
      and o.kind = 'recurring'
      and o.review_state <> 'rejected'
      and o.access_level < v_max
      and (app.norm_quote(o.description) = app.norm_quote(p_description)
           or extensions.similarity(lower(o.description), lower(p_description)) >= 0.55)
    order by extensions.similarity(lower(o.description), lower(p_description)) desc, o.created_at
    limit 1;
    if v_id is not null then
      return query select v_id, false, 0;
      return;
    end if;
  end if;

  perform set_config('app.audit_reason', 'Recurring duty found by the language model; quotes verified against the source messages', true);

  if v_id is null then
    insert into public.obligations
      (workspace_id, kind, description, owed_by, approval_required, approver, period, cadence, lead_time,
       next_due, start_by, next_due_basis, status, trust_state, access_level, review_state)
    values
      (p_workspace, 'recurring', trim(p_description), nullif(trim(coalesce(p_owed_by, '')), ''),
       nullif(trim(coalesce(p_approval, '')), ''), nullif(trim(coalesce(p_approver, '')), ''),
       p_period, trim(p_cadence), nullif(trim(coalesce(p_lead_time, '')), ''),
       p_next_due, p_start_by, nullif(trim(coalesce(p_next_due_basis, '')), ''),
       'open', 'sourced', v_max, 'draft')
    returning id into v_id;
    v_created := true;
  else
    update public.obligations o set
      owed_by = coalesce(o.owed_by, nullif(trim(coalesce(p_owed_by, '')), '')),
      approval_required = coalesce(o.approval_required, nullif(trim(coalesce(p_approval, '')), '')),
      approver = coalesce(o.approver, nullif(trim(coalesce(p_approver, '')), '')),
      period = coalesce(o.period, p_period),
      cadence = coalesce(o.cadence, trim(p_cadence)),
      lead_time = coalesce(o.lead_time, nullif(trim(coalesce(p_lead_time, '')), '')),
      next_due = coalesce(o.next_due, p_next_due),
      start_by = coalesce(o.start_by, p_start_by),
      next_due_basis = coalesce(o.next_due_basis, nullif(trim(coalesce(p_next_due_basis, '')), ''))
    where o.id = v_id;
  end if;

  for i in 1 .. coalesce(array_length(v_quotes, 1), 0) loop
    if not exists (select 1 from public.evidence ev
                   where ev.obligation_id = v_id and ev.event_id = v_events[i]
                     and app.norm_quote(ev.quote) = app.norm_quote(v_quotes[i])) then
      insert into public.evidence (obligation_id, event_id, quote, relation, verified)
      values (v_id, v_events[i], v_quotes[i], v_rels[i]::public.evidence_relation, true);
      v_added := v_added + 1;
    end if;
  end loop;

  perform set_config('app.audit_reason', '', true);
  return query select v_id, v_created, v_added;
end
$$;

----------------------------------------------------------------------------------------
-- Staged runs
----------------------------------------------------------------------------------------

-- Claim the caller's next job in a run: lowest stage first, and never a job while an earlier
-- stage of the same run still has work queued or running. Jobs without a stage are stage 1.
create function public.claim_next_run_job(p_workspace uuid, p_run text)
returns setof public.jobs
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select j.id into v_id
  from public.jobs j
  where j.workspace_id = p_workspace
    and j.payload ->> 'run_id' = p_run
    and j.payload ->> 'requested_by' = (select auth.uid())::text
    and (j.status = 'queued' or (j.status = 'running' and j.started_at < now() - interval '2 minutes'))
    and not exists (
      select 1 from public.jobs b
      where b.workspace_id = p_workspace
        and b.payload ->> 'run_id' = p_run
        and coalesce((b.payload ->> 'stage')::int, 1) < coalesce((j.payload ->> 'stage')::int, 1)
        and b.status in ('queued', 'running'))
  order by coalesce((j.payload ->> 'stage')::int, 1), coalesce((j.payload ->> 'chunk')::int, 0), j.created_at
  for update skip locked
  limit 1;

  if v_id is null then
    return;
  end if;

  return query
  update public.jobs
     set status = 'running', attempts = attempts + 1, started_at = now()
   where id = v_id
  returning *;
end
$$;

revoke execute on function public.record_followup(uuid, uuid, jsonb, jsonb) from public, anon;
revoke execute on function public.add_recurring_duty(uuid, text, text, text, text, text, text, text, date, date, text, jsonb) from public, anon;
revoke execute on function public.claim_next_run_job(uuid, text) from public, anon;
grant execute on function public.record_followup(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.add_recurring_duty(uuid, text, text, text, text, text, text, text, date, date, text, jsonb) to authenticated;
grant execute on function public.claim_next_run_job(uuid, text) to authenticated;

grant execute on all functions in schema app to anon, authenticated, service_role;
