-- Phase 7: the order of messages within their file.
--
-- WhatsApp keeps minutes only, and a minutes file's sections share one date, so many events
-- in a file have the same ts. The evidence pane shows the messages around a quote, which
-- needs the file's own order. `seq` is an identity: rows get increasing values in insert
-- order, and import_source now inserts in file order. Adding the column numbers existing
-- rows in their stored order, which for rows inserted in one statement is their file order
-- (best effort for data imported before this migration).

alter table public.events add column seq bigint generated always as identity;
create index events_source_seq_idx on public.events (source_id, seq);

create or replace function public.import_source(
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

  -- In file order, so events.seq (an identity) follows the order of the source file.
  insert into public.events (workspace_id, source_id, author, ts, text, thread_id, access_level, meta)
  select p_workspace, v_id, e.author, e.ts, e.text, e.thread_id, p_access, coalesce(e.meta, '{}')
  from jsonb_array_elements(p_events) with ordinality as x(elem, n)
  cross join lateral jsonb_to_record(x.elem) as e(author text, ts timestamptz, text text, thread_id text, meta jsonb)
  order by x.n;

  perform set_config('app.audit_reason', '', true);
  return v_id;
end
$$;
