-- Inheritance: extensions and enum types.

create extension if not exists pg_trgm with schema extensions;

-- Ordered: comparisons such as level <= 'committee' follow declaration order.
create type public.access_level as enum ('everyone', 'committee', 'finance', 'private');

create type public.app_role as enum ('outgoing_lead', 'advisor', 'incoming_lead', 'treasurer', 'member');

create type public.source_type as enum ('whatsapp', 'trello', 'minutes');
create type public.alias_kind as enum ('person', 'org');
create type public.obligation_kind as enum ('commitment', 'recurring');
create type public.obligation_status as enum ('open', 'fulfilled', 'no_evidence', 'contradicted');
create type public.trust_state as enum ('corroborated', 'sourced', 'inferred', 'contradicted', 'gap');
create type public.review_state as enum ('draft', 'accepted', 'rejected', 'edited');
create type public.evidence_relation as enum ('supports', 'fulfils', 'contradicts', 'past_instance');
create type public.context_kind as enum ('decision', 'contact', 'risk', 'dependency');
create type public.ack_action as enum ('accept', 'question', 'decline');
create type public.job_status as enum ('queued', 'running', 'done', 'failed');
