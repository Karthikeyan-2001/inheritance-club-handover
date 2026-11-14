-- Phase 15 (Round 3, improvement 2): gap questions for the outgoing lead.
--
-- A gap the records cannot close becomes a question: a promise with no follow-up, a duty with no
-- approver or no next date, a conflict nobody has ruled on. The outgoing lead's answer is not
-- written onto the item. It becomes a message, and the message is cited like any other record:
--   * The message sits in a "Stated by the outgoing lead" file (sources.type = 'statement'), one
--     file per access level, uploaded by the lead. Code writes it from the chosen answer and the
--     item's description, then adds the lead's own words, if any.
--   * Done and not done become 'fulfils' and 'contradicts' evidence; an approver, "no approval
--     needed" or a date become 'supports' evidence (and fill the field); "I don't know" becomes a
--     verified context note. The quote is the whole message and is checked against it.
--   * So the trust and status rules, provenance (a more restricted answer raises the item), the
--     audit log, re-review, the sign-off hash and the version diff all apply unchanged.
--   * The message names the item, so it can never be less restricted than the item.
--   * gap_answers says which question was answered and how. There are no write policies: rows
--     are written by answer_gap() only, and go when their message or item goes.
-- No model is involved anywhere here.

----------------------------------------------------------------------------------------
-- Labels
----------------------------------------------------------------------------------------

create or replace function app.source_label(p_type public.source_type) returns text
language sql immutable
set search_path = ''
as $$
  select case p_type
    when 'whatsapp' then 'WhatsApp'
    when 'trello' then 'Trello'
    when 'statement' then 'Stated by the outgoing lead'
    else 'Minutes'
  end
$$;

----------------------------------------------------------------------------------------
-- Answers
----------------------------------------------------------------------------------------

create table public.gap_answers (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  obligation_id uuid not null references public.obligations (id) on delete cascade,
  -- Set for a conflict question: the docket entry it was about.
  docket_entry_id uuid references public.docket_entries (id) on delete cascade,
  question text not null check (question in ('followup', 'conflict', 'approver', 'date')),
  answer text not null check (answer in ('done', 'not_done', 'approver', 'no_approval', 'date', 'unknown')),
  -- The message the answer became. Removing the statement file removes the answer, and the
  -- question comes back.
  event_id uuid not null references public.events (id) on delete cascade,
  answered_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check ((question = 'conflict') = (docket_entry_id is not null))
);
create index gap_answers_obligation_idx on public.gap_answers (obligation_id, question);
create index gap_answers_workspace_idx on public.gap_answers (workspace_id);
create index gap_answers_event_idx on public.gap_answers (event_id);
create index gap_answers_docket_idx on public.gap_answers (docket_entry_id);

alter table public.gap_answers enable row level security;

-- Readable by whoever can read both the item (the working ledger, so reviewers only) and the
-- message the answer became.
create policy gap_answers_select on public.gap_answers for select to authenticated
  using (app.can_read_obligation(obligation_id) and app.can_read_event(event_id));

-- Records the answer, bumps the statement file's message count and writes the audit row.
-- Called only by answer_gap(), after the message and its evidence are stored as the caller.
create function app.record_gap_answer(
  p_obligation uuid,
  p_entry uuid,
  p_question text,
  p_answer text,
  p_event uuid,
  p_reason text,
  p_before jsonb
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_ws uuid;
  v_source uuid;
  v_event_level public.access_level;
  v_uploader uuid;
  v_level public.access_level;
  v_uploaders uuid[];
  v_after jsonb;
begin
  select e.workspace_id, e.source_id, e.access_level, s.uploaded_by
    into v_ws, v_source, v_event_level, v_uploader
  from public.events e join public.sources s on s.id = e.source_id
  where e.id = p_event and s.type = 'statement';
  if v_ws is null or v_uploader is distinct from (select auth.uid()) then
    raise exception 'that message is not your own statement' using errcode = 'insufficient_privilege';
  end if;
  if exists (
    select 1 from public.gap_answers g
    where g.obligation_id = p_obligation and g.question = p_question
      and g.docket_entry_id is not distinct from p_entry
      and (g.answer <> 'unknown' or p_answer = 'unknown')
  ) then
    raise exception 'this question is already answered' using errcode = 'unique_violation';
  end if;

  insert into public.gap_answers (workspace_id, obligation_id, docket_entry_id, question, answer, event_id, answered_by)
  values (v_ws, p_obligation, p_entry, p_question, p_answer, p_event, (select auth.uid()))
  returning id into v_id;

  update public.sources s set event_count = s.event_count + 1 where s.id = v_source;

  select o.access_level, o.private_uploaders,
         jsonb_build_object('status', o.status, 'trust_state', o.trust_state, 'approver', o.approver,
                            'next_due', o.next_due, 'start_by', o.start_by, 'access_level', o.access_level,
                            'question', p_question, 'answer', p_answer, 'event_id', p_event)
    into v_level, v_uploaders, v_after
  from public.obligations o where o.id = p_obligation;
  -- The row cites the message, so it is at least as restricted as the message.
  v_level := greatest(v_level, v_event_level);
  if v_event_level = 'private' then
    v_uploaders := array(select distinct u from unnest(coalesce(v_uploaders, '{}') || v_uploader) u);
  end if;

  insert into public.audit_log
    (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
  values (v_ws, (select auth.uid()), 'answer_gap', 'gap_answers', v_id::text, p_obligation,
          p_reason, p_before, v_after, v_level,
          case when v_level = 'private' then coalesce(v_uploaders, '{}') else '{}' end);
  return v_id;
end
$$;

-- The outgoing lead answers one gap question. Runs as the caller, so RLS decides which items,
-- conflicts and files can be touched; every row is written through the usual policies and
-- triggers. Returns the id of the message the answer became.
--   p_question: followup (a promise with no follow-up) | conflict (an unruled conflict, p_entry)
--               | approver (a duty with no approver) | date (a duty with no next date)
--   p_answer:   done | not_done | unknown            for followup and conflict
--               approver (p_approver) | no_approval | unknown   for approver
--               date (p_next_due, optional p_start_by) | unknown for date
--   p_level:    the access level of the message; at least the item's own level.
--   p_detail:   the lead's own words, appended to the message (optional, up to 500 characters).
create function public.answer_gap(
  p_obligation uuid,
  p_question text,
  p_answer text,
  p_level public.access_level,
  p_detail text default null,
  p_approver text default null,
  p_next_due date default null,
  p_start_by date default null,
  p_entry uuid default null
) returns uuid
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
  v_kind public.obligation_kind;
  v_desc text;
  v_level public.access_level;
  v_status public.obligation_status;
  v_approver text;
  v_next_due date;
  v_before jsonb;
  v_detail text := nullif(trim(regexp_replace(coalesce(p_detail, ''), '\s+', ' ', 'g')), '');
  v_who text := nullif(trim(regexp_replace(coalesce(p_approver, ''), '\s+', ' ', 'g')), '');
  v_name text;
  v_subject text;
  v_text text;
  v_note text;
  v_sha text;
  v_source uuid;
  v_event uuid;
  v_stored text;
  v_reason text;
  v_holds boolean;
begin
  if p_question is null or p_question not in ('followup', 'conflict', 'approver', 'date') then
    raise exception 'unknown question' using errcode = 'invalid_parameter_value';
  end if;
  if p_answer is null or not (
       (p_question in ('followup', 'conflict') and p_answer in ('done', 'not_done', 'unknown'))
    or (p_question = 'approver' and p_answer in ('approver', 'no_approval', 'unknown'))
    or (p_question = 'date' and p_answer in ('date', 'unknown'))) then
    raise exception 'that answer does not fit the question' using errcode = 'invalid_parameter_value';
  end if;
  if p_level is null then
    raise exception 'choose who may read the answer' using errcode = 'invalid_parameter_value';
  end if;
  if length(coalesce(v_detail, '')) > 500 then
    raise exception 'keep your own words under 500 characters' using errcode = 'check_violation';
  end if;
  if p_answer = 'approver' and (v_who is null or length(v_who) > 120) then
    raise exception 'name who gives the approval (up to 120 characters)' using errcode = 'check_violation';
  end if;
  if p_answer = 'date' and p_next_due is null then
    raise exception 'give the next due date' using errcode = 'check_violation';
  end if;
  if p_answer = 'date' and p_start_by is not null and p_start_by > p_next_due then
    raise exception 'the start date must be on or before the due date' using errcode = 'check_violation';
  end if;
  if (p_question = 'conflict') <> (p_entry is not null) then
    raise exception 'a conflict question names its conflict, and only a conflict question does' using errcode = 'invalid_parameter_value';
  end if;

  -- Read as the caller: an item they cannot read is "not found".
  select o.workspace_id, o.kind, o.description, o.access_level, o.status, o.approver, o.next_due,
         jsonb_build_object('status', o.status, 'trust_state', o.trust_state, 'approver', o.approver,
                            'next_due', o.next_due, 'start_by', o.start_by, 'access_level', o.access_level)
    into v_ws, v_kind, v_desc, v_level, v_status, v_approver, v_next_due, v_before
  from public.obligations o
  where o.id = p_obligation and o.review_state <> 'rejected';
  if v_ws is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;
  if not app.has_role(v_ws, array['outgoing_lead']::public.app_role[]) then
    raise exception 'only the outgoing lead answers gap questions' using errcode = 'insufficient_privilege';
  end if;

  -- One answer at a time per item, so a double submit cannot answer twice.
  perform pg_advisory_xact_lock(hashtext('answer_gap:' || p_obligation::text));

  -- The gap must still be there.
  -- (In a variable: PL/pgSQL would read the first "then" of a case as the if's own.)
  v_holds := case p_question
      when 'followup' then v_kind = 'commitment' and v_status = 'no_evidence'
      when 'conflict' then exists (
        select 1 from public.docket_entries d
        where d.id = p_entry and d.obligation_id = p_obligation and d.ruling is null)
      when 'approver' then v_kind = 'recurring' and v_approver is null
      else v_kind = 'recurring' and v_next_due is null
    end;
  if not coalesce(v_holds, false) then
    raise exception 'this question no longer applies: the records or a ruling have settled it' using errcode = 'check_violation';
  end if;
  if p_level < v_level then
    raise exception 'the answer names the item, so it cannot be readable by more people than the item (%)', v_level
      using errcode = 'check_violation';
  end if;

  -- The message, written by code from the answer; the lead's own words follow.
  v_name := coalesce(nullif(trim((select auth.jwt()) -> 'user_metadata' ->> 'name'), ''), 'The outgoing lead');
  v_subject := regexp_replace(trim(v_desc), '[\s.]+$', '');
  v_text := case p_answer
      when 'done' then 'Done: ' || v_subject || '.'
      when 'not_done' then 'Not done: ' || v_subject || '.'
      when 'approver' then 'Needs approval from ' || v_who || ': ' || v_subject || '.'
      when 'no_approval' then 'No approval is needed: ' || v_subject || '.'
      when 'date' then 'Next due on ' || to_char(p_next_due, 'FMDD Mon YYYY') || ': ' || v_subject || '.'
      else case p_question
        when 'approver' then 'Not known who approves it: '
        when 'date' then 'Not known when it is next due: '
        else 'Not known whether it was done: '
      end || v_subject || '.'
    end || coalesce(' ' || v_detail, '');

  -- The lead's statement file at this level: found, or made once.
  perform pg_advisory_xact_lock(hashtext('statement_source:' || v_ws::text));
  v_sha := encode(sha256(convert_to('statement:' || v_ws::text || ':' || p_level::text || ':' || (select auth.uid())::text, 'UTF8')), 'hex');
  select s.id into v_source from public.sources s where s.workspace_id = v_ws and s.sha256 = v_sha;
  if v_source is null then
    perform set_config('app.audit_reason', 'Answers the outgoing lead gives to gap questions', true);
    insert into public.sources (workspace_id, type, filename, access_level, uploaded_by, sha256, read_summary, event_count)
    values (v_ws, 'statement', 'Answers to gap questions (' || initcap(p_level::text) || ')', p_level,
            (select auth.uid()), v_sha, '{}', 0)
    returning id into v_source;
  end if;

  insert into public.events (workspace_id, source_id, author, ts, text, thread_id, access_level, meta)
  values (v_ws, v_source, v_name, now(), v_text, null, p_level,
          jsonb_build_object('gap_question', p_question, 'gap_answer', p_answer))
  returning id, text into v_event, v_stored;

  -- The same quote check as every other claim: the quote must be in the stored message.
  if not app.quote_in(v_text, v_stored) then
    raise exception 'the answer could not be checked against its message' using errcode = 'check_violation';
  end if;

  v_reason := coalesce(v_detail, 'Answered on the gap questions page');
  perform set_config('app.audit_reason', 'Gap question answered by the outgoing lead: ' || v_reason, true);

  if p_answer = 'unknown' then
    v_note := v_name || case p_question
        when 'approver' then ' does not know who approves it.'
        when 'date' then ' does not know when it is next due.'
        else ' does not know whether it was done.'
      end;
    insert into public.context_items (obligation_id, kind, text, access_level, event_id, quote, verified)
    values (p_obligation, 'risk', v_note, p_level, v_event, v_text, true);
  else
    insert into public.evidence (obligation_id, event_id, quote, relation, verified, inferred)
    values (p_obligation, v_event, v_text,
            (case p_answer when 'done' then 'fulfils' when 'not_done' then 'contradicts' else 'supports' end)::public.evidence_relation,
            true, false);
  end if;

  if p_answer = 'approver' then
    update public.obligations o
       set approver = v_who, approval_required = coalesce(o.approval_required, 'Approval')
     where o.id = p_obligation;
  elsif p_answer = 'date' then
    update public.obligations o
       set next_due = p_next_due, start_by = coalesce(p_start_by, o.start_by), next_due_basis = 'Stated by the outgoing lead'
     where o.id = p_obligation;
  elsif p_answer in ('done', 'not_done') and v_kind = 'commitment' then
    -- As record_followup(): the status follows the evidence, and the item counts as checked.
    update public.obligations o
       set status = app.followup_status(o.id), fulfilment_checked_at = coalesce(o.fulfilment_checked_at, now())
     where o.id = p_obligation
       and (o.status is distinct from app.followup_status(o.id) or o.fulfilment_checked_at is null);
  end if;

  perform app.record_gap_answer(p_obligation, p_entry, p_question, p_answer, v_event, v_reason, v_before);
  perform set_config('app.audit_reason', '', true);
  return v_event;
end
$$;

revoke execute on function public.answer_gap(uuid, text, text, public.access_level, text, text, date, date, uuid) from public, anon;
grant execute on function public.answer_gap(uuid, text, text, public.access_level, text, text, date, date, uuid) to authenticated;
revoke execute on function app.record_gap_answer(uuid, uuid, text, text, uuid, text, jsonb) from public, anon;
grant execute on function app.record_gap_answer(uuid, uuid, text, text, uuid, text, jsonb) to authenticated;
