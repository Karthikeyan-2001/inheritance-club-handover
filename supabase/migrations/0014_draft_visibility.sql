-- Inheritance: the working ledger is not for the incoming lead or members (Phase 8).
-- Until a version is approved, only the outgoing lead, the advisor and the treasurer read
-- obligations, and so evidence, notes, links and conflicts (all of which are gated by
-- app.can_read_obligation). The incoming lead and members read approved version_items, which
-- keep their own policy, so releases still reach the incoming lead through a version.
-- Messages and files (the timeline) are unchanged.

create function app.sees_working_ledger(p_ws uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_role(p_ws, array['outgoing_lead', 'advisor', 'treasurer']::public.app_role[]) $$;

create or replace function app.can_read_obligation(p_obligation_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.sees_working_ledger(o.workspace_id)
       and app.can_read(o.workspace_id, o.access_level, o.private_uploaders, 'obligation', o.id)
    from public.obligations o
    where o.id = p_obligation_id
  ), false)
$$;

drop policy obligations_select on public.obligations;
create policy obligations_select on public.obligations for select to authenticated
  using (
    app.sees_working_ledger(workspace_id)
    and app.can_read(workspace_id, access_level, private_uploaders, 'obligation', id)
  );

drop policy docket_select on public.docket_entries;
create policy docket_select on public.docket_entries for select to authenticated
  using (
    app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event)
    and (case when obligation_id is null then app.sees_working_ledger(workspace_id) else app.can_read_obligation(obligation_id) end)
  );

grant execute on all functions in schema app to anon, authenticated, service_role;
