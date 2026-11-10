-- Phase 12: the outgoing lead can build items from his own private files.
--
-- Found by the end-to-end test of the second synthetic scenario: when the outgoing lead ran the
-- pipeline, every commitment or duty from his own private chat was refused ("new row violates
-- row-level security policy"). The storing functions run as the caller and insert the item
-- before its first quote; at that moment the provenance trigger computed no private uploaders,
-- so only the advisor could read the new row or cite a message into it.
--
-- Now the storing functions pass the cited file's uploader for a private item, and the trigger
-- keeps it until the first quote is attached; from then on, uploaders come from the evidence,
-- as before. A reviewer inserting an item directly can only narrow who reads their own text.

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

  if v_max is null and tg_op = 'INSERT' then
    -- Nothing cited yet: the storing function attaches the first quote next. Keep the
    -- uploaders it gave for a private item, so the caller can read (and cite into) the row it
    -- is creating. From the first quote on, uploaders come from the evidence as before.
    new.private_uploaders := case when new.access_level = 'private' then coalesce(new.private_uploaders, '{}') else '{}' end;
  else
    new.private_uploaders := coalesce(v_uploaders, '{}');
  end if;
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

create or replace function public.add_extracted_commitment(
  p_workspace uuid,
  p_event uuid,
  p_quote text,
  p_owed_by text,
  p_owed_to text,
  p_deliverable text,
  p_due_text text
) returns table (obligation_id uuid, created boolean)
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_text text;
  v_level public.access_level;
  v_uploader uuid;
  v_existing uuid;
  v_id uuid;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can add commitments' using errcode = 'insufficient_privilege';
  end if;

  -- Read the cited message as the caller: an unreadable message counts as not found.
  select e.text, e.access_level, s.uploaded_by into v_text, v_level, v_uploader
  from public.events e
  left join public.sources s on s.id = e.source_id
  where e.id = p_event and e.workspace_id = p_workspace;
  if v_text is null then
    raise exception 'cited message not found' using errcode = 'no_data_found';
  end if;

  if length(app.norm_quote(p_quote)) < least(12, length(app.norm_quote(v_text)))
     or position(app.norm_quote(p_quote) in app.norm_quote(v_text)) = 0 then
    raise exception 'quote is not a verbatim part of the cited message' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_owed_to), '') = '' or coalesce(trim(p_deliverable), '') = '' then
    raise exception 'a commitment needs a counterparty and a deliverable' using errcode = 'check_violation';
  end if;

  -- The same quote from the same message is the same commitment: do not add it twice.
  select ev.obligation_id into v_existing
  from public.evidence ev
  where ev.event_id = p_event and app.norm_quote(ev.quote) = app.norm_quote(p_quote)
  limit 1;
  if v_existing is not null then
    return query select v_existing, false;
    return;
  end if;

  perform set_config('app.audit_reason', 'Extracted by the language model; quote verified against the source message', true);

  insert into public.obligations
    (workspace_id, kind, description, owed_by, owed_to, due_text, status, trust_state, access_level, private_uploaders, review_state)
  values
    (p_workspace, 'commitment', trim(p_deliverable), nullif(trim(p_owed_by), ''), trim(p_owed_to),
     nullif(trim(coalesce(p_due_text, '')), ''), 'open', 'sourced', v_level,
     case when v_level = 'private' then array[coalesce(v_uploader, app.nobody())] else '{}'::uuid[] end, 'draft')
  returning id into v_id;

  insert into public.evidence (obligation_id, event_id, quote, relation, verified)
  values (v_id, p_event, trim(p_quote), 'supports', true);

  perform set_config('app.audit_reason', '', true);
  return query select v_id, true;
end
$$;

create or replace function public.add_recurring_duty(
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
  v_uploader uuid;
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
    select e.text, e.access_level, app.visibility_key(e.access_level, e.source_id), s.uploaded_by into v_text, v_level, v_key, v_uploader
    from public.events e left join public.sources s on s.id = e.source_id
    where e.id = v_event and e.workspace_id = p_workspace;
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
       next_due, start_by, next_due_basis, status, trust_state, access_level, private_uploaders, review_state)
    values
      (p_workspace, 'recurring', trim(p_description), nullif(trim(coalesce(p_owed_by, '')), ''),
       nullif(trim(coalesce(p_approval, '')), ''), nullif(trim(coalesce(p_approver, '')), ''),
       p_period, trim(p_cadence), nullif(trim(coalesce(p_lead_time, '')), ''),
       p_next_due, p_start_by, nullif(trim(coalesce(p_next_due_basis, '')), ''),
       'open', 'sourced', v_max,
       -- One visibility per duty (checked above), so a private duty's quotes share one file and uploader.
       case when v_max = 'private' then array[coalesce(v_uploader, app.nobody())] else '{}'::uuid[] end, 'draft')
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
