-- Phase 15 (Round 3, improvement 2): a source type for what the outgoing lead states when
-- answering a gap question. On its own: Postgres refuses to use a new enum value in the
-- transaction that adds it (0022 uses it).

alter type public.source_type add value if not exists 'statement';
