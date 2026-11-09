# Build status and handover notes

Read this first when resuming work. Last updated: 2026-11-09, at the end of Phase 7.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, health route, Vitest and Playwright, CI | merged |
| 1 | Schema, RLS, seed, demo login, role switcher | merged |
| 2 | Parsers (WhatsApp, Trello, minutes), IST timestamps | merged |
| 3 | `/import` (Connect), ledger timeline, demo-club protection | merged |
| 4 | LLM adapter, commitment extraction, quote verifier, job runner | merged |
| 5 | Fulfilment, cycles (recurring duties and approvals), context, staged runs | merged |
| 6 | Matching (aliases plus `pg_trgm`), trust-state rule function, docket | merged |
| 7 | Ledger UI and evidence pane (quote highlighted in source) | on branch `build/phase-7`, ready to merge |
| 8 | `/review`: advisor approval, version diff, immutable versions, audit | **next** |
| 9 | `/handover`: "people waiting on you", calendar, sealed placeholders, acks | later |
| 10 | Demo mode ("Load demo club" per visitor, keep-alive cron) | later |
| 11 | Full synthetic generator (`world.yaml`, `ground_truth.yaml`) | later |
| 12 | Scoring, leak test, second scenario, end-to-end tests | later |
| 13 | Hardening and docs | later |

Tests at the end of Phase 7: 264 unit, 121 RLS integration, 26 Playwright, all passing. Lint, typecheck and build are clean.

## How the user works

- One branch per phase (`build/phase-N`), small commits. The user merges through GitHub pull requests; never push or merge yourself.
- Stop at the end of each phase with a summary. Wait for "start phase N".
- Ask before adding a dependency not named in CLAUDE.md.
- Ask before any paid model call. Show a cost estimate first.
- The user chooses the Claude Code model per phase (see the table below).

## Outstanding user tasks (for Phase 7)

1. Merge `build/phase-7`.
2. Redeploy on Vercel. No migration, no new environment variables, no paid model calls.
3. Optional: on the live app, open any quote's **Open source message** link, then the **Gaps** tab.

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
| 0009 | The `likely_fulfilled` status, in its own migration (a new enum value cannot be used in the transaction that adds it). |
| 0010 | `evidence.inferred`; obligations `fulfilment_checked_at`, `period`, `cadence`, `lead_time`, `start_by`, `next_due_basis`; `context_items.event_id`, `quote`, `verified`, `private_uploaders` (trigger `context_item_provenance`, and `app.can_read_context_item` uses the item's own uploaders). `app.followup_status()` (the status rule), `record_followup()`, `add_recurring_duty()` (one visibility per duty; same-level merge; skips a duty already known at a lower level), `claim_next_run_job()` (stage by stage). Helpers: `app.quote_in`, `app.grounded_in`, `app.visibility_key`, `app.obligation_since`, `app.try_uuid`. |
| 0011 | Matching, trust, docket. `obligation_links` (a < b, `same` or `possible`, `rule` or `model`; readable only if both items are; audited at the more restricted item's level by `app.audit_link`). `app.effective_evidence()` (own verified evidence plus that of `same`-linked items at the same or a less restricted level; private only from the same uploaders). `app.trust_rule()` and `app.status_rule()` over it; `app.followup_status()` now uses it. `app.obligation_provenance()` sets trust on every write, and status of checked commitments on derived updates. `app.touch_obligations()`, `app.with_linked()`, `app.sync_docket()` (opens and closes rule-made entries), `app.docket_summary()`, `app.person()`. `docket_entries.obligation_id`, `quote_a`, `quote_b`, `origin`, unique (obligation, claims); docket RLS also requires the item. `link_obligations()` (security invoker; upgrades possible to same, never downgrades). `audit_row()` attributes docket rows to their item. |

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
| `pipeline/extract.ts` | `visibilityKey`, chunking (never mixes visibility), `recordLine` and the prompt with `[mN]` references, and `postProcess`: verify, hedge filter, counterparty and deliverable checks, dedupe. |
| `pipeline/cycles.ts` | Duty prefilter (`DUTY_CUE`), `batchDutyEvents` (one visibility per batch, least restricted first), the duty prompt, `postProcessDuties` (verify, recurrence and grounding checks, quoting the cadence sentence if the model did not), `schedule` (next due and start-by), `monthIn`, `parseLeadTime`. |
| `pipeline/fulfilment.ts` | The follow-up and duty-context prompts, `postProcessFollowup` (verify, after the promise, not the promise, hedge and question filters), `noteGrounded`, `contextRelated`. |
| `pipeline/related.ts` | `buildIdf` and `relatedEvents`: rare shared words, the same Trello card, a cap of 24. |
| `pipeline/status.ts` | `followupStatus`, the TypeScript mirror of `app.followup_status()`. |
| `pipeline/trust.ts` | `trustState`, `independent`, `canBorrow`: the TypeScript mirror of `app.trust_rule()` and of the borrowing rule in `app.effective_evidence()`. |
| `pipeline/match.ts` | `partyTokens` (aliases), `scorePair`, `decide` (rule / ask / skip), `planMatches` (deterministic, best first, capped at 48), `batchPairs` (8), the match prompt, `postProcessMatches`. |
| `pipeline/text.ts` | `contentTokens`, `stem`, `sentences`, `sentenceContaining`, `trigramSimilarity` (the TypeScript stand-in for `pg_trgm`). |
| `pipeline/verify.ts` | Also `noteGrounded` (used for context notes and, through `deliverableGrounded` in `extract.ts`, commitment descriptions). |
| `pipeline/run-pipeline.ts` | `planRun`, `runNextStep` (dispatches by job kind), `getRunProgress`. Stages 5 and 6 (`plan_matches`, `match_items`) link items; payloads hold ids and scores only. Runs as the user, through RLS. Stages are in `tasks.ts`; progress shapes are in `progress.ts`, which is pure so the browser can import it. |
| `pipeline/run-memory.ts` | The whole pipeline in memory, for the eval and unit tests. It mirrors the SQL storage rules (now including provenance, matching and the trust and status rules over effective evidence), so keep it in step with them. |
| `pipeline/provider.ts`, `fake-extract.ts`, `fake-pipeline.ts` | `LLM_PROVIDER=fake` is the rule-based offline stand-in, refused in production. `fakeHandlers()` covers every task. |

### App (`src/app/`)

| Path | Contents |
|---|---|
| `/login` | Demo logins. |
| `/import` | Connect: upload, access level per file, authorisation checkbox, what was read, files, aliases, delete workspace. |
| `/ledger` | "Build the ledger" panel (`pipeline-panel.tsx`); Commitments and Recurring tabs (`commitments.tsx`, `recurring.tsx`; shared `obligation-parts.tsx` with `AlsoRecorded`, `PossibleMatches`, `DocketLink`; `link-data.ts` loads links and docket ids; grouping in `src/lib/ledger-view.ts`); Docket tab (`docket.tsx`, one entry per pair of claims, anchors `#docket-<id>`); Gaps tab (`gaps.tsx`, `findGaps`); Timeline tab; `trust-legend.tsx`. Item cards have anchors `#item-<id>`. |
| `/ledger/evidence/[id]` | The source message for one quote (`?kind=context` for a context note), highlighted with `src/lib/pipeline/locate.ts` and shown with two neighbours either side. All reads go through RLS. |
| `/api/jobs/run-next` | One job per POST (`maxDuration` 60). Returns `done` and `waiting` (an earlier stage still running elsewhere). |
| `/api/health` | Health check. |

### Tests

- **Unit:** `src/**/*.test.ts`.
- **RLS:** `tests/rls/*.test.ts`, against local Supabase. Each file re-seeds and cleans up.
- **E2E:** `e2e/`. Its own dev server on port 3100 with `LLM_PROVIDER=fake`, so it never calls the real API. Global setup re-seeds and clears `llm_cache` rows whose model is `fake:%`.
- **Eval:** `pnpm eval:extract` and `pnpm eval:pipeline` (`-- --yes` calls the model; `--model <id>` overrides the fast model). Shared loader: `scripts/mini-scenario.ts`.
  - Last `eval:pipeline` result (Haiku, 9 Nov 2026): 5 of 5 commitments, 0 decoys, 5 of 5 statuses, 5 of 5 expected follow-up quotes, X1 detected, R1 and R2 found with the right approvers. 12 calls, about $0.005.
  - Phase 6 run (Haiku, 9 Nov 2026): the same 5/5, 0 decoys, 5/5 statuses, 5/5 follow-up quotes, X1 detected, R1 and R2 found; trust right for 5/5 commitments and 2/2 duties; context notes now on topic. 12 calls, about $0.0045. Haiku made no duplicate items on the mini data, so no pair reached the matching prompt.
  - Matching probe (`-- --yes --match-probe-only`, 9 Nov 2026): 8/8 planted pairs right (3 same, 5 different), 0 false "same". 1 call, about $0.0003.

## Gotchas learned

- **Next 16:** the session middleware is `src/proxy.ts`. `cacheComponents` is on: anything reading cookies must sit inside `<Suspense>`, and the Supabase server client calls `connection()` first.
- **Imports in `src/lib`** use explicit `.ts` extensions (`allowImportingTsExtensions`), so scripts run under Node's native TypeScript support. Modules used by tests or scripts must not import `server-only`; inject server-only dependencies instead.
- **Radix menus:** don't put native `<button>`s inside `DropdownMenuItem`. Use `onSelect` with forms outside the menu, or keyboard selection breaks.
- **Hydration:** files chosen before hydration fire no `onChange`; `import-form` picks them up on mount.
- **Fixture data:** an obligation's level is raised automatically by its evidence. The fixture's E3 was moved to a Trello comment to keep O1 visible to everyone.
- **Parsers:** whatsapp-chat-parser builds dates in local time. `localWallClockToIstIso` reads the local fields back.
- **The LLM cache is keyed by prompt, not by code.** Changing a fake handler or a post-processing rule does not invalidate saved answers. Changing a system prompt or record format does (and costs a fresh run). e2e clears the fake's entries; for live runs, saved answers are reused until the prompt changes.
- **Enum values:** add a new enum value in its own migration file; Postgres refuses to use it in the same transaction.
- **Staging:** `git mv` stages a rename at once, so `git add <files> && git commit` also commits earlier `git mv`s. Commit with explicit paths, or rename just before the commit that needs it.
- **Fixture overlap:** the demo fixture also mentions the HoD permission letter (at level everyone), so in RLS tests the mini scenario's committee copy may be skipped as "already known at a lower level", or kept as a near-duplicate when the fake's wording differs.
- **Trust is derived; never write it.** `app.obligation_provenance()` overwrites `trust_state` on every insert and update. An obligation is `gap` for the instant between its insert and its first evidence row.
- **Derived updates are not audited.** `app.touch_obligations()` sets `app.derived_update`, so trust, status and level recomputations write no audit rows. Docket entries opened or closed by `app.sync_docket()` are audited (it runs after the flag is restored).
- **Docket entries cascade with their messages.** Removing a file deletes the entries citing its messages, with the removal's reason in the audit. `sync_docket()` closes the rest when a conflict goes.
- **Seeding the docket.** The trust rule opens O2's entry as soon as its evidence is inserted; the seed then upserts D1 (on obligation and claims) to give it the fixture id and summary.
- **Matching does not skip linked pairs.** Every run re-proposes the same pairs in the same order, so match batches hit the cache; `link_obligations()` is idempotent. A link a reviewer deletes will come back on the next run until Phase 8 records "not the same".
- **Match prompts may show two levels.** By design (a committee duty and its finance copy). The model returns only a verdict per pair; the in-memory test that prompts never mix levels excludes `match_items`, like follow-up checks.

## Phase 5 decisions (confirmed with the user)

- "Likely done" is a fifth status, `likely_fulfilled`, from evidence marked `inferred`.
- One staged run ("Build the ledger"), not separate buttons.
- Follow-up evidence from a more restricted record raises the item (the provenance rule is kept).
- The fast tier (Haiku 5.5, low effort) for every task. The eval showed no need for Sonnet, so refusal fallbacks are still off (Haiku has no server-side fallback anyway).
- Found while building: prompts must never mix access levels, or model-written text (descriptions, notes) can carry restricted facts into a more open row. Chunks and batches are now split by `visibilityKey`.

## Phase 6 decisions (confirmed with the user)

- **Corroborated means independent:** at least two verified messages that agree, from different files or from different named people. One person's word stays sourced (C3 in the mini ground truth was changed to `sourced`). Unknown authors and inferred quotes never corroborate.
- Trust and the status of checked commitments are computed in the database trigger, over effective evidence. No `settle_trust` stage was needed.
- Evidence is borrowed only from linked items at the same or a less restricted level (private: same uploaders).
- One docket entry per contradicted item; the Docket tab shows a shared conflict once.
- Two paid runs were approved and made: `eval:pipeline` (about $0.0045) and the matching probe (about $0.0003).

## Known gaps to pick up later

- **Phase 7 (left):** the Gaps tab lists linked records separately (only the Commitments and Recurring tabs fold them into one card).
- **Phase 8:** rulings on docket entries (`ruling`, `ruled_by`, `reason`; the advisor). A reviewer's "not the same" must be remembered (a rejected link, or a `distinct` verdict) or the next run re-links it. Unlinking is already possible through RLS (`obligation_links_delete`) and is audited.
- **Phase 8:** `approve_version()` snapshots evidence without `inferred`, and leaves out context items, links and trust. Add them to `version_items.item`, without breaking hashes of existing versions.
- **Phase 8:** the pipeline can change the status (and now the trust) of items a reviewer has already accepted. Flag such items for re-review (or show the change in the version diff).
- **Phase 9:** `release_item()` and `audit_row()` still use the obligation's private uploaders for context items. This is safe (more restrictive), but the outgoing lead cannot release or read the audit of a private note built from their own file.
- **Phase 9:** a released private item may borrow from a linked private item of the same uploader that the receiving role cannot read, so its trust can reflect a record they cannot see. The releaser sees this when releasing; consider showing "trust based on records you cannot see" to the receiver.
- **Matching:** links are not transitive (A–B and B–C do not make A borrow C's evidence). Duty pairs are scored on descriptions and approvers only. The fake's duty wording is poor, so offline runs do not link the finance copy of the HoD rule; the live probe does.
- **Phase 11/12:** run `eval:pipeline` on the year-long samples in `data/samples/` (planted items in `data/samples/README.md`) once the generator and scoring exist. Watch duty recall (the prefilter is keyword-based), and matching precision at scale (the 48-pair cap per run; `match_over_limit` counts the rest).

## Phase 7 decisions

- The evidence pane is a page (`/ledger/evidence/[id]`), not a dialog, so it has a URL, works without JavaScript and is easy to test under RLS.
- Linked records fold into the earliest item's card by direct `same` links only.
- The header's step indicator is now inside `<Suspense>`: dynamic routes failed prerender checks without it.
- The Gaps empty state ("No gaps among the N items you can read") is covered by unit tests of `findGaps`, not Playwright, because the e2e workspace always has gaps.

## Claude Code model per phase (recommendation)

| Model | Phases |
|---|---|
| Opus 5.5, high | 5, 6, 8, 10, 12 |
| Sonnet 5.5, medium or high | 7, 9, 11, 13 |

Run `/code-review` on Opus before merging a Sonnet-built phase.
