# Build status and handover notes

Read this first when resuming work. Last updated: 2026-11-09, at the end of Phase 4.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, health route, Vitest and Playwright, CI | merged |
| 1 | Schema, RLS, seed, demo login, role switcher | merged |
| 2 | Parsers (WhatsApp, Trello, minutes), IST timestamps | merged |
| 3 | `/import` (Connect), ledger timeline, demo-club protection | merged |
| 4 | LLM adapter, commitment extraction, quote verifier, job runner | on branch `build/phase-4`, ready to merge |
| 5 | Fulfilment, cycles (recurring duties and approvals), context | **next** |
| 6 | Matching (aliases plus `pg_trgm`), trust-state rule function, docket | later |
| 7 | Ledger UI and evidence pane (quote highlighted in source) | later |
| 8 | `/review`: advisor approval, version diff, immutable versions, audit | later |
| 9 | `/handover`: "people waiting on you", calendar, sealed placeholders, acks | later |
| 10 | Demo mode ("Load demo club" per visitor, keep-alive cron) | later |
| 11 | Full synthetic generator (`world.yaml`, `ground_truth.yaml`) | later |
| 12 | Scoring, leak test, second scenario, end-to-end tests | later |
| 13 | Hardening and docs | later |

Tests at the end of Phase 4: 166 unit, 98 RLS integration, 17 Playwright, all passing. Lint, typecheck and build are clean.

## How the user works

- One branch per phase (`build/phase-N`), small commits. The user merges through GitHub pull requests; never push or merge yourself.
- Stop at the end of each phase with a summary. Wait for "start phase N".
- Ask before adding a dependency not named in CLAUDE.md.
- Ask before any paid model call. Show a cost estimate first.
- The user chooses the Claude Code model per phase (see the table below).

## Outstanding user tasks (for Phases 3 and 4, if not yet done)

1. Merge `build/phase-4`.
2. Vercel env vars:
   - Mark Sensitive: `ANTHROPIC_API_KEY`, `SUPABASE_SECRET_KEY`.
   - Plain: `LLM_MODEL_FAST=claude-haiku-5-5`, `LLM_MODEL_STRONG=claude-sonnet-5-5`, `LLM_MAX_CALLS_PER_DAY=500`.
   - Already set: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DEMO_USER_PASSWORD`.
3. Hosted database: `pnpm db:push`, then `pnpm seed:hosted`. This applies 0007 and 0008 and marks the demo club `is_demo`.
4. Redeploy on Vercel.

## Environment facts

- **Live app:** `https://inheritance-club-handover.vercel.app`. Hosted Supabase project ref: `gmlsskizjxhtoxnwhywj`, already linked with the CLI.
- **Local stack:**
  - `pnpm db:start` (Docker Desktop must be running), then `pnpm db:reset && pnpm seed`.
  - `.env.local` holds local Supabase keys, `DEMO_USER_PASSWORD`, `ANTHROPIC_API_KEY` and the model names.
  - `.env.hosted.local` holds hosted values for `pnpm seed:hosted`.
  - Never print or commit either file's values.
- **npm registry:** the project `.npmrc` pins public npm. The global `~/.npmrc` points at an expired company mirror; never touch it. For corepack and `pnpm dlx`, prefix commands with `COREPACK_NPM_REGISTRY=https://registry.npmjs.org` (and `npm_config_registry` if needed), for that shell only.
- **TLS:** the user's network re-signs HTTPS. Node needs `--use-system-ca`, which is already in `pnpm dev` and `pnpm eval:extract`. Never disable certificate checks.
- **Supabase CLI 3.0:** `supabase db push` targets **local** by default. `pnpm db:push` adds `--remote`. Regenerate types with `pnpm db:types`.
- **New-style keys:** `sb_publishable_…` and `sb_secret_…` work with supabase-js. The local gateway translates a key only if it matches exactly.

## Architecture map

### Database (`supabase/migrations/`)

| Migration | What it adds |
|---|---|
| 0001–0002 | Types and tables. Additions beyond the spec: `version_items`, `releases`, `obligations.private_uploaders`, `audit_log.access_level`, `private_uploaders` and `obligation_id`. |
| 0003–0004 | RLS helpers in the non-exposed `app` schema (STABLE SECURITY DEFINER) and per-role policies on every table. |
| 0005 | Triggers: provenance (an obligation inherits the most restrictive cited event), audit, and immutability. |
| 0006 | `approve_version`, `release_item`, `delete_workspace`, the `latest_acks` view, `ping`. |
| 0007 | Import: `import_source` and `remove_source` (security invoker, audited), `event_authors`, `workspaces.is_demo` protection, `sources.read_summary` and `event_count`, `events.meta`. |
| 0008 | Extraction: `claim_next_job` (own jobs only; stale after 2 minutes), `add_extracted_commitment` (an SQL quote check through `app.norm_quote`, atomic, deduplicating), and `llm_cache.model` and `usage`. |

### Code (`src/lib/`)

| Path | Contents |
|---|---|
| `parsers/` | WhatsApp, Trello and minutes parsers producing one `ParsedEvent` shape. `parseUpload(filename, bytes)`. |
| `time.ts`, `format.ts` | Everything is IST: stored as ISO with `+05:30`, displayed through `formatIst*`. |
| `llm/adapter.ts` | `generateStructured({schema, system, user, modelTier, task})`. Zod validation, one retry, cache by prompt hash, daily budget, typed errors (`llm/errors.ts`). Dependencies are injected: `provider` and `cache`. |
| `llm/provider-anthropic.ts` | Uses `messages.parse` with `output_config.format` (`zodOutputFormat`), because forced tool use returns 400 on Sonnet and Opus 5.5. |
| `llm/provider-fake.ts`, `llm/cache-memory.ts` | Test doubles. |
| `llm/cache-supabase.ts` | Secret key, server only. |
| `pipeline/verify.ts` | `normaliseForQuote` and `verifyQuote`. Mirrored by SQL `app.norm_quote`; keep the two in sync. |
| `pipeline/extract.ts` | Chunking, the prompt with `[mN]` references, and `postProcess`: verify, hedge filter, counterparty and deliverable checks, dedupe. |
| `pipeline/run-extraction.ts` | `planExtraction`, `runNextJob`, `getRunProgress`. Runs as the user, through RLS. |
| `pipeline/provider.ts` | `LLM_PROVIDER=fake` is the rule-based offline stand-in, refused in production. |

### App (`src/app/`)

| Path | Contents |
|---|---|
| `/login` | Demo logins. |
| `/import` | Connect: upload, access level per file, authorisation checkbox, what was read, files, aliases, delete workspace. |
| `/ledger` | Commitments tab with the "Find commitments" panel; Timeline tab. |
| `/api/jobs/run-next` | One job per POST (`maxDuration` 60). |
| `/api/health` | Health check. |

### Tests

- **Unit:** `src/**/*.test.ts`.
- **RLS:** `tests/rls/*.test.ts`, against local Supabase. Each file re-seeds and cleans up.
- **E2E:** `e2e/`. Its own dev server on port 3100 with `LLM_PROVIDER=fake`, so it never calls the real API.
- **Eval:** `pnpm eval:extract` (`-- --yes` calls the model). Last result: 5 of 5 commitments, 0 decoys, about $0.001.

## Gotchas learned

- **Next 16:** the session middleware is `src/proxy.ts`. `cacheComponents` is on: anything reading cookies must sit inside `<Suspense>`, and the Supabase server client calls `connection()` first.
- **Imports in `src/lib`** use explicit `.ts` extensions (`allowImportingTsExtensions`), so scripts run under Node's native TypeScript support. Modules used by tests or scripts must not import `server-only`; inject server-only dependencies instead.
- **Radix menus:** don't put native `<button>`s inside `DropdownMenuItem`. Use `onSelect` with forms outside the menu, or keyboard selection breaks.
- **Hydration:** files chosen before hydration fire no `onChange`; `import-form` picks them up on mount.
- **Fixture data:** an obligation's level is raised automatically by its evidence. The fixture's E3 was moved to a Trello comment to keep O1 visible to everyone.
- **Parsers:** whatsapp-chat-parser builds dates in local time. `localWallClockToIstIso` reads the local fields back.

## Phase 5 plan (to confirm with the user before building)

Model: Opus 5.5 at high effort for Claude Code. In the app, the strong tier is `claude-sonnet-5-5`. Measure whether Haiku is accurate enough before relying on Sonnet everywhere. Refusal fallbacks were not enabled in Phase 4; for Sonnet 5.5, check `claude-api` skill guidance on `fallbacks: "default"`.

| Piece | Plan |
|---|---|
| `pipeline/fulfilment.ts` | For each commitment, gather later events involving the same people or entities. The model answers `fulfilled`, `likely_fulfilled` or `no_evidence`, with a verified quote. **No verified quote means `no_evidence`**, never done. Store `evidence` with relation `fulfils` (or `contradicts`). Update `status`. |
| `pipeline/cycles.ts` | Declared recurrences ("every semester", "each year", "every August") and named activities that recur. Capture `approval_required` and `approver` (e.g. HoD permission before a lab booking; Dean's office for the auditorium). Create `kind = 'recurring'` obligations, with `next_due` and start-by dates where derivable. |
| Context items | Decisions, contacts, risks and dependencies attached to obligations. Each carries its own access level. |
| Jobs | Same pattern (new job kinds through `claim_next_job`). Extend the run panel. |
| Tests | Unit tests with the fake provider. RLS: no leakage into prompts; status "no_evidence" when no quote verifies. Extend `eval:extract`, or add `eval:fulfilment`, using `data/scenarios/mini/ground-truth.json`. That file already lists expected statuses, recurring duties R1 and R2, and the contradiction X1. |
| Docs | `docs/changes-from-round1.md`, `docs/ai-disclosure.md`, README. |

Live-eval extras from Phase 4 to handle later: Trello cards restating chat commitments ("Print fest posters", "Send certificates…") should merge in Phase 6. "Get HoD permission letter…" should become recurring duty R1 in Phase 5.

## Claude Code model per phase (recommendation)

| Model | Phases |
|---|---|
| Opus 5.5, high | 5, 6, 8, 10, 12 |
| Sonnet 5.5, medium or high | 7, 9, 11, 13 |

Run `/code-review` on Opus before merging a Sonnet-built phase.
