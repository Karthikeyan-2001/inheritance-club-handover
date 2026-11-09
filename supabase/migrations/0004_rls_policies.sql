-- Inheritance: row-level security. RLS is enabled on every table.
-- Policies apply to `authenticated` only; `anon` has no policies, so it reads nothing.
-- Tables with no write policy are written only by SECURITY DEFINER functions/triggers.

-- Extra helpers that need table-specific joins.
create function app.can_read_evidence(p_obligation_id uuid, p_event_id uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  -- The quote is visible if the obligation is readable and either the cited event is
  -- readable or the obligation was explicitly released to the reader's role. A release
  -- shares the obligation and its verified quotes, not the full source message.
  select app.can_read_obligation(p_obligation_id)
     and (
       app.can_read_event(p_event_id)
       or app.is_released(
            app.obligation_workspace(p_obligation_id), 'obligation', p_obligation_id,
            app.my_role(app.obligation_workspace(p_obligation_id)))
     )
$$;

create function app.can_read_context_item(p_id uuid, p_obligation_id uuid, p_level public.access_level)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((
    select app.can_read_obligation(o.id)
       and app.can_read(o.workspace_id, p_level, o.private_uploaders, 'context_item', p_id)
    from public.obligations o
    where o.id = p_obligation_id
  ), false)
$$;

create function app.can_review(p_ws uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$ select app.has_role(p_ws, array['outgoing_lead', 'advisor']::public.app_role[]) $$;

grant execute on all functions in schema app to anon, authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.memberships enable row level security;
alter table public.sources enable row level security;
alter table public.events enable row level security;
alter table public.aliases enable row level security;
alter table public.obligations enable row level security;
alter table public.evidence enable row level security;
alter table public.context_items enable row level security;
alter table public.docket_entries enable row level security;
alter table public.sealed_items enable row level security;
alter table public.versions enable row level security;
alter table public.version_items enable row level security;
alter table public.acks enable row level security;
alter table public.releases enable row level security;
alter table public.audit_log enable row level security;
alter table public.jobs enable row level security;
alter table public.llm_cache enable row level security;

-- workspaces / memberships: members read; written by server functions and the seed only.
create policy workspaces_select on public.workspaces for select to authenticated
  using (app.is_member(id));

create policy memberships_select on public.memberships for select to authenticated
  using (app.is_member(workspace_id));

-- sources
create policy sources_select on public.sources for select to authenticated
  using (app.can_read(workspace_id, access_level, array[coalesce(uploaded_by, app.nobody())], null, null));
create policy sources_insert on public.sources for insert to authenticated
  with check (app.can_review(workspace_id) and uploaded_by = (select auth.uid()));
create policy sources_delete on public.sources for delete to authenticated
  using (
    app.can_read(workspace_id, access_level, array[coalesce(uploaded_by, app.nobody())], null, null)
    and (uploaded_by = (select auth.uid()) or app.has_role(workspace_id, array['advisor']::public.app_role[]))
  );

-- events: inserted by the uploader of their source (the import pipeline runs as that user).
create policy events_select on public.events for select to authenticated
  using (app.can_read(workspace_id, access_level, app.source_uploaders(source_id), null, null));
create policy events_insert on public.events for insert to authenticated
  with check (
    app.can_review(workspace_id)
    and app.source_uploaders(source_id) = array[(select auth.uid())]
  );

-- aliases
create policy aliases_select on public.aliases for select to authenticated
  using (app.is_member(workspace_id));
create policy aliases_insert on public.aliases for insert to authenticated
  with check (app.can_review(workspace_id));
create policy aliases_update on public.aliases for update to authenticated
  using (app.can_review(workspace_id)) with check (app.can_review(workspace_id));
create policy aliases_delete on public.aliases for delete to authenticated
  using (app.can_review(workspace_id));

-- obligations: no delete (rejection is a review_state).
create policy obligations_select on public.obligations for select to authenticated
  using (app.can_read(workspace_id, access_level, private_uploaders, 'obligation', id));
create policy obligations_insert on public.obligations for insert to authenticated
  with check (app.can_review(workspace_id));
create policy obligations_update on public.obligations for update to authenticated
  using (app.can_review(workspace_id) and app.can_read(workspace_id, access_level, private_uploaders, 'obligation', id))
  with check (app.can_review(workspace_id) and app.can_read(workspace_id, access_level, private_uploaders, 'obligation', id));

-- evidence
create policy evidence_select on public.evidence for select to authenticated
  using (app.can_read_evidence(obligation_id, event_id));
create policy evidence_insert on public.evidence for insert to authenticated
  with check (
    app.can_review(app.obligation_workspace(obligation_id))
    and app.can_read_obligation(obligation_id)
    and app.can_read_event(event_id)
  );
create policy evidence_update on public.evidence for update to authenticated
  using (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_obligation(obligation_id) and app.can_read_event(event_id))
  with check (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_obligation(obligation_id) and app.can_read_event(event_id));
create policy evidence_delete on public.evidence for delete to authenticated
  using (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_obligation(obligation_id) and app.can_read_event(event_id));

-- context_items
create policy context_items_select on public.context_items for select to authenticated
  using (app.can_read_context_item(id, obligation_id, access_level));
create policy context_items_insert on public.context_items for insert to authenticated
  with check (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_obligation(obligation_id));
create policy context_items_update on public.context_items for update to authenticated
  using (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_context_item(id, obligation_id, access_level))
  with check (app.can_review(app.obligation_workspace(obligation_id)) and app.can_read_context_item(id, obligation_id, access_level));

-- docket_entries: visible only if both conflicting claims are readable.
create policy docket_select on public.docket_entries for select to authenticated
  using (app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event));
create policy docket_insert on public.docket_entries for insert to authenticated
  with check (app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event));
create policy docket_update on public.docket_entries for update to authenticated
  using (app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event))
  with check (app.can_review(workspace_id) and app.can_read_event(claim_a_event) and app.can_read_event(claim_b_event));

-- sealed_items: placeholders (holder + topic only) are visible to every member.
create policy sealed_select on public.sealed_items for select to authenticated
  using (app.is_member(workspace_id));
create policy sealed_insert on public.sealed_items for insert to authenticated
  with check (app.can_review(workspace_id));
create policy sealed_update on public.sealed_items for update to authenticated
  using (app.can_review(workspace_id)) with check (app.can_review(workspace_id));
create policy sealed_delete on public.sealed_items for delete to authenticated
  using (app.can_review(workspace_id));

-- versions: ids and hashes only, readable by members. Insert only via approve_version().
create policy versions_select on public.versions for select to authenticated
  using (app.is_member(workspace_id));

-- version_items: filtered exactly like obligations.
create policy version_items_select on public.version_items for select to authenticated
  using (app.can_read(workspace_id, access_level, private_uploaders, 'obligation', obligation_id));

-- acks: you see your own; outgoing lead and advisor see all, but only for items they can read.
create policy acks_select on public.acks for select to authenticated
  using (
    (user_id = (select auth.uid()) or app.can_review(app.version_workspace(version_id)))
    and exists (
      select 1 from public.version_items vi
      where vi.version_id = acks.version_id and vi.obligation_id = acks.obligation_id
    )
  );
create policy acks_insert on public.acks for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and app.has_role(app.version_workspace(version_id), array['incoming_lead']::public.app_role[])
    and exists (
      select 1 from public.version_items vi
      where vi.version_id = acks.version_id and vi.obligation_id = acks.obligation_id
    )
  );

-- releases: members can see what was released (not the content). Insert via release_item().
create policy releases_select on public.releases for select to authenticated
  using (app.is_member(workspace_id));

-- audit_log: advisor reads all; outgoing lead reads rows about items within their access.
create policy audit_select on public.audit_log for select to authenticated
  using (
    app.has_role(workspace_id, array['advisor']::public.app_role[])
    or (
      app.has_role(workspace_id, array['outgoing_lead']::public.app_role[])
      and app.can_read(workspace_id, access_level, private_uploaders, null, null)
      and (obligation_id is null or app.can_read_obligation(obligation_id))
    )
  );

-- jobs
create policy jobs_select on public.jobs for select to authenticated
  using (app.is_member(workspace_id));
create policy jobs_insert on public.jobs for insert to authenticated
  with check (app.can_review(workspace_id));
create policy jobs_update on public.jobs for update to authenticated
  using (app.can_review(workspace_id)) with check (app.can_review(workspace_id));

-- llm_cache: no policies. Only the service role (server-side) can use it.
