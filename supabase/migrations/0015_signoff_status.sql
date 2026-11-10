-- Inheritance: whether the outgoing lead's "ready for the advisor" mark still matches (Phase 8).
-- The hash of the pending items covers items a reader may not be able to see, so the UI gets
-- only the answer, never the hash. Reviewers only.

create function public.signoff_status(p_workspace uuid)
returns table (marked_at timestamptz, marked_by uuid, item_count integer, reason text, is_current boolean)
language sql stable security definer
set search_path = ''
as $$
  select s.created_at, s.signed_by, s.item_count, s.reason, s.pending_hash = app.pending_hash(p_workspace)
  from public.review_signoffs s
  where s.workspace_id = p_workspace and app.can_review(p_workspace)
  order by s.seq desc
  limit 1
$$;

revoke execute on function public.signoff_status(uuid) from public, anon;
grant execute on function public.signoff_status(uuid) to authenticated;
