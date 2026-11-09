-- Inheritance: extraction jobs and verified commitments (Phase 4).
--   * jobs are claimed one at a time by the user who requested them (browser-driven runner).
--   * llm_cache records model and usage for cost reporting (still service-role only).
--   * add_extracted_commitment() writes an obligation and its evidence atomically, as the
--     caller (RLS applies), and re-checks the quote in SQL: a claim whose quote is not in the
--     cited message cannot be stored, whatever the application code does.

alter table public.jobs
  add column started_at timestamptz,
  add column finished_at timestamptz;
create index jobs_run_idx on public.jobs (workspace_id, (payload ->> 'run_id'));

alter table public.llm_cache
  add column model text,
  add column usage jsonb not null default '{}';
create index llm_cache_created_idx on public.llm_cache (created_at);

----------------------------------------------------------------------------------------
-- Quote normalisation. Must match normaliseForQuote() in src/lib/pipeline/verify.ts:
-- Unicode NFKC, typographic quotes and dashes to ASCII, lower case, whitespace collapsed.
----------------------------------------------------------------------------------------

create function app.norm_quote(p text) returns text
language sql immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    lower(translate(normalize(coalesce(p, ''), NFKC), '‘’‚‛“”„‟–—−', '''''''''""""---')),
    '\s+', ' ', 'g'))
$$;

grant execute on function app.norm_quote(text) to anon, authenticated, service_role;

----------------------------------------------------------------------------------------
-- Job claiming
----------------------------------------------------------------------------------------

-- Claim the oldest queued job of this kind that the caller requested. A job left "running"
-- for more than two minutes (e.g. the browser tab closed mid-step) can be claimed again.
create function public.claim_next_job(p_workspace uuid, p_kind text, p_run text)
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
    and j.kind = p_kind
    and j.payload ->> 'run_id' = p_run
    and j.payload ->> 'requested_by' = (select auth.uid())::text
    and (j.status = 'queued' or (j.status = 'running' and j.started_at < now() - interval '2 minutes'))
  order by (j.payload ->> 'chunk')::int, j.created_at
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

----------------------------------------------------------------------------------------
-- Store one extracted commitment with its verified quote
----------------------------------------------------------------------------------------

create function public.add_extracted_commitment(
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
  v_existing uuid;
  v_id uuid;
begin
  if not app.can_review(p_workspace) then
    raise exception 'only the outgoing lead or the advisor can add commitments' using errcode = 'insufficient_privilege';
  end if;

  -- Read the cited message as the caller: an unreadable message counts as not found.
  select e.text, e.access_level into v_text, v_level
  from public.events e
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
    (workspace_id, kind, description, owed_by, owed_to, due_text, status, trust_state, access_level, review_state)
  values
    (p_workspace, 'commitment', trim(p_deliverable), nullif(trim(p_owed_by), ''), trim(p_owed_to),
     nullif(trim(coalesce(p_due_text, '')), ''), 'open', 'sourced', v_level, 'draft')
  returning id into v_id;

  insert into public.evidence (obligation_id, event_id, quote, relation, verified)
  values (v_id, p_event, trim(p_quote), 'supports', true);

  perform set_config('app.audit_reason', '', true);
  return query select v_id, true;
end
$$;

revoke execute on function public.claim_next_job(uuid, text, text) from public, anon;
revoke execute on function public.add_extracted_commitment(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.claim_next_job(uuid, text, text) to authenticated;
grant execute on function public.add_extracted_commitment(uuid, uuid, text, text, text, text, text) to authenticated;
