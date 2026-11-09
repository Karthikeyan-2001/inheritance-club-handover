# Inheritance: working agreements

## What this is
Inheritance is a handover system for university student clubs. It reads a club's WhatsApp exports, meeting minutes and Trello export, and builds a ledger of obligations the outgoing committee leaves behind: commitments made to people, and recurring duties (including the approvals they need). Every claim links to a verified source quote. Anything unsupported is shown as a gap. The outgoing lead and faculty advisor review and approve before the incoming lead sees anything, and each role sees only what it is allowed to.

Built solo for a hackathon (CodersInPune, Round 2). Judges must be able to open the live link and complete the full flow without help. Demo data is synthetic only.

## Non-negotiables
1. Every extracted claim carries a verbatim quote and an event id. Code (not a model) checks the quote is a normalised substring of that event's text. Claims that fail are dropped and counted.
2. Trust states are set by a deterministic rule function: corroborated, sourced, inferred, contradicted, gap. Never present an inference as fact.
3. Permissions are enforced by Postgres row-level security. Never rely on UI hiding. Role views are built by filtering first, then rendering. A model never sees rows the viewing role cannot read.
4. Sealed placeholders come from a separate `sealed_items` table that holds no source text.
5. Approved versions are immutable.
6. Every review action writes an audit_log row with actor, action, reason, before and after.
7. The service-role key is server-side only. Never expose it to the browser. Never commit secrets.
8. All demo data is synthetic and labelled as such. No real people, no real organisations.
9. Missing evidence is a first-class result ("No evidence kept"), never silently "pending" or "done".
10. LLM calls go through one adapter (`src/lib/llm/adapter.ts`), use structured output validated with Zod, and are cached by prompt hash.

## Stack
Next.js (App Router) + TypeScript, Tailwind + shadcn/ui, Supabase (Postgres, Auth, Storage, RLS), `pg_trgm`, Anthropic SDK behind the adapter, `whatsapp-chat-parser`, `mammoth`, `zod`, Vitest, Playwright. Free tiers only (Vercel Hobby, Supabase Free). Keep each serverless step short; long work runs as small steps from a `jobs` table, driven by the browser polling a "run next step" endpoint.

## Conventions
- TypeScript strict. No `any` without a comment.
- Small commits, clear messages, one concern per commit.
- Add tests with each feature. Run `pnpm test` before declaring a task done.
- Do not invent libraries or APIs. If unsure, check the docs or ask.
- Update `docs/changes-from-round1.md` and `docs/ai-disclosure.md` whenever direction or AI use changes.
- Environment variables are listed in `.env.example`; real values are never committed.

## Definition of done for any feature
Works on the deployed app, has a test, handles the empty and error states, writes to the audit log if it changes data, and respects RLS.