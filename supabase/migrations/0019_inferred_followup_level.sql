-- Phase 13, design question P6: a quote that only *implies* a commitment was done may not come
-- from a record that some readers of the item cannot read. By the provenance rule such a quote
-- would raise the item's level, so one weak inference (from a finance chat, say) could hide a
-- committee item from the incoming lead. Quotes that say done or not done plainly still raise
-- the level, as before. Mirrors inferredMayAttach() in src/lib/pipeline/fulfilment.ts.

-- Who can read the messages an item is built from ('supports' evidence): their most restrictive
-- level and the uploaders of the private ones. Falls back to the item's own level and uploaders.
create function app.own_visibility(p_obligation uuid)
returns table (level public.access_level, uploaders uuid[])
language sql stable security definer
set search_path = ''
as $$
  select coalesce(max(e.access_level), o.access_level),
         coalesce(array_agg(distinct s.uploaded_by) filter (where e.access_level = 'private'),
                  case when bool_or(e.id is not null) then '{}'::uuid[] else o.private_uploaders end)
  from public.obligations o
  left join public.evidence ev on ev.obligation_id = o.id and ev.relation = 'supports' and ev.verified
  left join public.events e on e.id = ev.event_id
  left join public.sources s on s.id = e.source_id
  where o.id = p_obligation
  group by o.access_level, o.private_uploaders
$$;

revoke execute on function app.own_visibility(uuid) from public, anon;
grant execute on function app.own_visibility(uuid) to authenticated;

create or replace function public.record_followup(p_workspace uuid, p_obligation uuid, p_evidence jsonb, p_context jsonb)
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
  v_inferred boolean;
  v_ev_uploader uuid;
  v_own_level public.access_level;
  v_own_uploaders uuid[];
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
  select own.level, own.uploaders into v_own_level, v_own_uploaders from app.own_visibility(p_obligation) own;

  perform set_config('app.audit_reason', 'Follow-up found by the language model; quote verified against the source message', true);

  for v_item in select * from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) loop
    v_event := app.try_uuid(v_item ->> 'event_id');
    v_quote := trim(coalesce(v_item ->> 'quote', ''));
    v_rel := v_item ->> 'relation';
    v_inferred := v_rel = 'fulfils' and coalesce((v_item ->> 'inferred')::boolean, false);
    v_text := null;
    select e.text, e.ts, e.access_level, s.uploaded_by into v_text, v_ts, v_level, v_ev_uploader
    from public.events e join public.sources s on s.id = e.source_id
    where e.id = v_event and e.workspace_id = p_workspace;
    if v_kind <> 'commitment'
       or v_rel is null or v_rel not in ('fulfils', 'contradicts')
       or v_text is null or not app.quote_in(v_quote, v_text)
       or v_since is null or v_ts is null or v_ts < v_since
       or exists (select 1 from public.evidence ev
                  where ev.obligation_id = p_obligation and ev.event_id = v_event and ev.relation = 'supports')
       -- An implied completion may not come from a record some of the item's readers cannot read.
       or (v_inferred and not (
             v_level < v_own_level
             or (v_level = v_own_level and (v_own_level <> 'private' or v_ev_uploader = any(coalesce(v_own_uploaders, '{}'))))
          )) then
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
            v_inferred);
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
