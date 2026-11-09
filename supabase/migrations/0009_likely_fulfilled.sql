-- Inheritance: a status for commitments whose only follow-up evidence implies, but does not
-- state, that they were done (Phase 5). Kept in its own migration because a new enum value
-- cannot be used in the transaction that adds it.

alter type public.obligation_status add value if not exists 'likely_fulfilled' after 'fulfilled';
