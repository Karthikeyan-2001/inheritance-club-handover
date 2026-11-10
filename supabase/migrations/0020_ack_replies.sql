-- Inheritance: replies to the incoming lead's questions (Phase 13).
-- The Round 1 workflow says the incoming lead's questions "go back to Arun". Until now the
-- outgoing lead and the advisor could read a question but not answer it. A reply is an
-- immutable row tied to the acknowledgement it answers:
--   - readable by whoever can read that acknowledgement (its author, and the outgoing lead and
--     advisor where they can read the item; see acks_select);
--   - written only by the outgoing lead or the advisor, as themselves, to a question or a
--     decline they can read;
--   - audited, with the item's access level and uploaders, like the acknowledgement itself.
-- The text is the reviewer's own words; nothing here copies source text.

create table public.ack_replies (
  id uuid primary key default gen_random_uuid(),
  ack_id uuid not null references public.acks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (length(trim(text)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index ack_replies_ack_idx on public.ack_replies (ack_id, created_at);

alter table public.ack_replies enable row level security;

-- Runs under the caller's RLS on acks, so a reply is visible exactly when its question is.
create policy ack_replies_select on public.ack_replies for select to authenticated
  using (exists (select 1 from public.acks a where a.id = ack_replies.ack_id));

create policy ack_replies_insert on public.ack_replies for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.acks a
      where a.id = ack_replies.ack_id
        and a.action in ('question', 'decline')
        and app.can_review(app.version_workspace(a.version_id))
    )
  );

revoke all on public.ack_replies from anon;
grant select, insert on public.ack_replies to authenticated;

create function app.audit_ack_reply() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_obligation uuid;
  v_version uuid;
  v_level public.access_level;
  v_uploaders uuid[];
begin
  select a.obligation_id, a.version_id into v_obligation, v_version from public.acks a where a.id = new.ack_id;
  select vi.workspace_id, vi.access_level, vi.private_uploaders into v_ws, v_level, v_uploaders
  from public.version_items vi
  where vi.version_id = v_version and vi.obligation_id = v_obligation;

  insert into public.audit_log (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
  values (v_ws, new.user_id, 'ack_reply', 'ack_replies', new.id::text, v_obligation, new.text, null,
          jsonb_build_object('ack_id', new.ack_id, 'version_id', v_version), v_level, v_uploaders);
  return new;
end
$$;

create trigger ack_replies_z_audit after insert on public.ack_replies
  for each row execute function app.audit_ack_reply();
create trigger ack_replies_immutable before update or delete on public.ack_replies
  for each row execute function app.forbid_mutation();
create trigger ack_replies_no_truncate before truncate on public.ack_replies
  for each statement execute function app.forbid_mutation();

grant execute on all functions in schema app to anon, authenticated, service_role;
