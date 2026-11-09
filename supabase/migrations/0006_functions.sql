-- Inheritance: server functions callable over the API (schema public), plus views.
-- Each checks the caller's role itself, because SECURITY DEFINER bypasses RLS.

create function app.is_service_role() returns boolean
language sql stable
set search_path = ''
as $$ select coalesce((select auth.jwt()) ->> 'role', '') = 'service_role' $$;

grant execute on function app.is_service_role() to anon, authenticated, service_role;

-- Approve the current ledger as a new immutable version. Advisor only.
-- Accepted and edited obligations are snapshotted into version_items (one row each, with
-- the item's access level). versions.snapshot/diff contain ids and hashes only.
create function public.approve_version(p_workspace uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_version uuid := gen_random_uuid();
  v_number integer;
  v_prev uuid;
  v_hashes jsonb;
  v_prev_hashes jsonb := '{}';
  v_diff jsonb;
begin
  if not app.has_role(p_workspace, array['advisor']::public.app_role[]) then
    raise exception 'only the faculty advisor can approve a version' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to approve a version' using errcode = 'check_violation';
  end if;

  -- Serialise approvals per workspace.
  perform pg_advisory_xact_lock(hashtext('approve_version:' || p_workspace::text));

  select v.id, v.number into v_prev, v_number
  from public.versions v
  where v.workspace_id = p_workspace
  order by v.number desc
  limit 1;
  v_number := coalesce(v_number, 0) + 1;
  if v_prev is not null then
    select coalesce(jsonb_object_agg(vi.obligation_id::text, vi.item_hash), '{}')
      into v_prev_hashes
    from public.version_items vi where vi.version_id = v_prev;
  end if;

  -- Items first in a temp table so we can compute hashes before inserting the version row.
  create temp table _items on commit drop as
  select
    o.id as obligation_id,
    o.access_level,
    o.private_uploaders,
    jsonb_build_object(
      'obligation', to_jsonb(o) - 'private_uploaders',
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'event_id', ev.event_id, 'quote', ev.quote,
                 'relation', ev.relation, 'verified', ev.verified)
               order by ev.id)
        from public.evidence ev where ev.obligation_id = o.id
      ), '[]')
    ) as item
  from public.obligations o
  where o.workspace_id = p_workspace
    and o.review_state in ('accepted', 'edited');

  select coalesce(jsonb_object_agg(obligation_id::text, md5(item::text)), '{}')
    into v_hashes from _items;

  v_diff := jsonb_build_object(
    'previous_version', v_prev,
    'added',   coalesce((select jsonb_agg(k) from jsonb_object_keys(v_hashes) k where not v_prev_hashes ? k), '[]'),
    'removed', coalesce((select jsonb_agg(k) from jsonb_object_keys(v_prev_hashes) k where not v_hashes ? k), '[]'),
    'changed', coalesce((select jsonb_agg(k) from jsonb_object_keys(v_hashes) k
                         where v_prev_hashes ? k and v_prev_hashes ->> k <> v_hashes ->> k), '[]')
  );

  insert into public.versions (id, workspace_id, number, approved_by, snapshot, diff)
  values (
    v_version, p_workspace, v_number, (select auth.uid()),
    jsonb_build_object('obligation_count', (select count(*) from _items), 'hashes', v_hashes),
    v_diff
  );

  insert into public.version_items (version_id, workspace_id, obligation_id, access_level, private_uploaders, item, item_hash)
  select v_version, p_workspace, i.obligation_id, i.access_level, i.private_uploaders, i.item, md5(i.item::text)
  from _items i;

  insert into public.audit_log (workspace_id, actor, action, target_type, target_id, reason, before, after, access_level)
  values (p_workspace, (select auth.uid()), 'approve_version', 'versions', v_version::text, p_reason,
          null, jsonb_build_object('number', v_number, 'diff', v_diff), 'everyone');

  drop table _items;
  return v_version;
end
$$;

-- Release a restricted item to a role.
--   advisor: may release any item.
--   outgoing_lead: may release only private items built solely from files they uploaded.
create function public.release_item(p_target_type text, p_target_id uuid, p_to_role public.app_role, p_reason text)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_level public.access_level;
  v_uploaders uuid[];
  v_role public.app_role;
  v_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to release an item' using errcode = 'check_violation';
  end if;

  if p_target_type = 'obligation' then
    select o.workspace_id, o.access_level, o.private_uploaders into v_ws, v_level, v_uploaders
    from public.obligations o where o.id = p_target_id;
  elsif p_target_type = 'context_item' then
    select o.workspace_id, greatest(c.access_level, o.access_level), o.private_uploaders
      into v_ws, v_level, v_uploaders
    from public.context_items c join public.obligations o on o.id = c.obligation_id
    where c.id = p_target_id;
  else
    raise exception 'unknown target type %', p_target_type using errcode = 'invalid_parameter_value';
  end if;

  if v_ws is null then
    raise exception 'item not found' using errcode = 'no_data_found';
  end if;

  v_role := app.my_role(v_ws);
  if v_role = 'advisor' then
    null;
  elsif v_role = 'outgoing_lead'
        and v_level = 'private'
        and cardinality(v_uploaders) > 0
        and v_uploaders <@ array[(select auth.uid())] then
    null;
  else
    raise exception 'you are not allowed to release this item' using errcode = 'insufficient_privilege';
  end if;

  insert into public.releases (workspace_id, target_type, target_id, to_role, released_by, reason)
  values (v_ws, p_target_type, p_target_id, p_to_role, (select auth.uid()), p_reason)
  on conflict (target_type, target_id, to_role) do nothing
  returning id into v_id;

  if v_id is not null then
    insert into public.audit_log (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
    values (v_ws, (select auth.uid()), 'release', p_target_type, p_target_id::text,
            case when p_target_type = 'obligation' then p_target_id
                 else (select c.obligation_id from public.context_items c where c.id = p_target_id) end,
            p_reason,
            null, jsonb_build_object('to_role', p_to_role), v_level, coalesce(v_uploaders, '{}'));
  end if;
  return v_id;
end
$$;

-- Delete a workspace and everything in it, including immutable rows.
-- Outgoing lead or advisor of that workspace (or the server's service role).
create function public.delete_workspace(p_workspace uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (app.can_review(p_workspace) or app.is_service_role()) then
    raise exception 'only the outgoing lead or advisor can delete this workspace' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'a reason is required to delete a workspace' using errcode = 'check_violation';
  end if;
  perform set_config('app.allow_workspace_delete', 'on', true);
  delete from public.workspaces where id = p_workspace;
  perform set_config('app.allow_workspace_delete', 'off', true);
end
$$;

-- Liveness check for /api/health. Returns no data.
create function public.ping()
returns boolean
language sql stable
set search_path = ''
as $$ select true $$;

-- Latest decision per (version, obligation, user). Uses the caller's RLS on acks.
create view public.latest_acks
with (security_invoker = true)
as
select distinct on (a.version_id, a.obligation_id, a.user_id)
  a.id, a.version_id, a.obligation_id, a.user_id, a.action, a.note, a.created_at
from public.acks a
order by a.version_id, a.obligation_id, a.user_id, a.seq desc;

revoke execute on function public.approve_version(uuid, text) from public, anon;
revoke execute on function public.release_item(text, uuid, public.app_role, text) from public, anon;
revoke execute on function public.delete_workspace(uuid, text) from public, anon;
grant execute on function public.approve_version(uuid, text) to authenticated;
grant execute on function public.release_item(text, uuid, public.app_role, text) to authenticated;
grant execute on function public.delete_workspace(uuid, text) to authenticated, service_role;
grant execute on function public.ping() to anon, authenticated;

revoke all on public.latest_acks from anon;
grant select on public.latest_acks to authenticated;
