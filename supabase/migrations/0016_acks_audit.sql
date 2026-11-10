-- Inheritance: acknowledgements of approved items (Phase 9).
-- An acknowledgement is an immutable row; the latest per (version, item, user) wins. Every one
-- is audited. Asking a question or declining an item needs a note, so the outgoing team can
-- answer. The audit row carries the item's access level and uploaders so RLS filters it the
-- same way as the item. The note is the incoming lead's own words and holds no source text.

create function app.audit_ack() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ws uuid;
  v_level public.access_level;
  v_uploaders uuid[];
begin
  select vi.workspace_id, vi.access_level, vi.private_uploaders into v_ws, v_level, v_uploaders
  from public.version_items vi
  where vi.version_id = new.version_id and vi.obligation_id = new.obligation_id;

  insert into public.audit_log (workspace_id, actor, action, target_type, target_id, obligation_id, reason, before, after, access_level, private_uploaders)
  values (v_ws, new.user_id, 'ack_' || new.action::text, 'acks', new.id::text, new.obligation_id, new.note, null,
          jsonb_build_object('version_id', new.version_id, 'action', new.action), v_level, v_uploaders);
  return new;
end
$$;

create function app.ack_needs_note() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.action in ('question', 'decline') and coalesce(trim(new.note), '') = '' then
    raise exception 'a note is required to ask a question or decline an item' using errcode = 'check_violation';
  end if;
  return new;
end
$$;

create trigger acks_a_note before insert on public.acks
  for each row execute function app.ack_needs_note();
create trigger acks_z_audit after insert on public.acks
  for each row execute function app.audit_ack();

grant execute on all functions in schema app to anon, authenticated, service_role;
