# Inheritance: working agreements

## What this is
Inheritance is a handover system for university student clubs. It reads a club's WhatsApp exports, meeting minutes and Trello export, and builds a ledger of obligations the outgoing committee leaves behind: commitments made to people, and recurring duties (including the approvals they need). Every claim links to a verified source quote. Anything unsupported is shown as a gap. The outgoing lead and faculty advisor review and approve before the incoming lead sees anything, and each role sees only what it is allowed to.

Built solo for a hackathon (CodersInPune). Now in the Round 3 finale, which closes **16 Nov 2026, 11:59 pm, with no late window**. Round 3 is judged on delivering exactly the three improvements committed in Round 2 (see `docs/status.md`). Judges open the live link and complete the full flow alone, with no walkthrough, so the UI itself must guide them. Demo data is synthetic only.

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

## Resuming work (on any machine)
Read `docs/status.md` first. It has the current phase, outstanding user tasks, environment facts and the plan for the next phase. Update it at the end of every phase. Setting up a new computer: `docs/dev-setup.md`. Other docs: `docs/architecture.md` (where things live), `docs/decisions.md` (why), `docs/gotchas.md` (read before touching the database, pipeline, demo copies or tests), `docs/known-gaps.md`, `docs/deploy.md`.

Claude Code's memory does not travel between machines. Put anything worth keeping in these files, not in memory.

Working rules:
- One branch per phase (`build/phase-N`). Stop and summarise at the end of each phase; wait for "start phase N".
- Never push or merge; the user merges through GitHub pull requests and deploys after every phase (`docs/deploy.md`, "After every phase").
- Show a cost estimate and ask before any paid model call.
- Ask before adding a dependency not named under Stack.
- Prove a new test can fail (a deliberate one-off mutation, then restore).
- Chain checks with `&&`, never `;`, so a failing check stops the commit.

Environment rules:
- Packages come from public npm only. The project `.npmrc` holds just `registry=https://registry.npmjs.org/`. Never edit a global `~/.npmrc`, and never add a registry token or company mirror to the project. For corepack or `pnpm dlx`, set `COREPACK_NPM_REGISTRY=https://registry.npmjs.org` for that shell only. Before committing a lockfile, check it has no `codeartifact` or `_authToken`.
- Some networks re-sign HTTPS. Node scripts that call external HTTPS use `--use-system-ca` (already in `pnpm dev`, `eval:*`, `demo:freeze`). Never disable certificate checks.
- Never print or commit `.env.local` or `.env.hosted.local`.

## Definition of done for any feature
Works on the deployed app, has a test, handles the empty and error states, writes to the audit log if it changes data, and respects RLS. 