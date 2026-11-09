# Build status and handover notes

Read this first when resuming work. Last updated: 2026-11-09, at the end of Phase 6.

## Where things stand

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, health route, Vitest and Playwright, CI | merged |
| 1 | Schema, RLS, seed, demo login, role switcher | merged |
| 2 | Parsers (WhatsApp, Trello, minutes), IST timestamps | merged |
| 3 | `/import` (Connect), ledger timeline, demo-club protection | merged |
| 4 | LLM adapter, commitment extraction, quote verifier, job runner | merged |
| 5 | Fulfilment, cycles (recurring duties and approvals), context, staged runs | merged |
| 6 | Matching (aliases plus `pg_trgm`), trust-state rule function, docket | on branch `build/phase-6`, ready to merge |
| 7 | Ledger UI and evidence pane (quote highlighted in source) | **next** |
| 8 | `/review`: advisor approval, version diff, immutable versions, audit | later |
| 9 | `/handover`: "people waiting on you", calendar, sealed placeholders, acks | later |
| 10 | Demo mode ("Load demo club" per visitor, keep-alive cron) | later |
| 11 | Full synthetic generator (`world.yaml`, `ground_truth.yaml`) | later |
| 12 | Scoring, leak test, second scenario, end-to-end tests | later |
| 13 | Hardening and docs | later |

Tests at the end of Phase 6: 246 unit, 121 RLS integration, 20 Playwright, all passing. Lint, typecheck and build are clean.

## How the user works

- One branch per phase (`build/phase-N`), small commits. The user merges through GitHub pull requests; never push or merge yourself.
- Stop at the end of each phase with a summary. Wait for "start phase N".
- Ask before adding a dependency not named in CLAUDE.md.
- Ask before any paid model call. Show a cost estimate first.
- The user chooses the Claude Code model per phase (see the table below).

## Outstanding user tasks (for Phase 6)

1. Merge `build/phase-6`.
2. Hosted database: `pnpm db:push` applies 0011 (links, trust rule, docket). The migration recomputes trust and status for every existing item and ties existing docket entries (D1) to their item with both quotes. No re-seed is needed: this upgrade was rehearsed locally (0010 plus the old seed, then 0011) and left exactly one D1 and unchanged fixture trust states.
3. Redeploy on Vercel. There are no new environment variables.
4. Optional: on the live app, sign in as Arun, press **Build the ledger** on `/ledger`, then open the **Docket** tab. Saved answers are reused; only the new matching step calls the model (at most a few Haiku calls, well under $0.01).

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
| `/ledger` | "Build the ledger" panel (`pipeline-panel.tsx`); Commitments and Recurring tabs (`commitments.tsx`, `recurring.tsx`, shared `obligation-parts.tsx` with `LinkList`); Docket tab (`docket.tsx`, one entry per pair of claims); Timeline tab. The Gaps tab is still "coming soon". |
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

- **Phase 7:** the Gaps tab is still "coming soon" (items with trust `gap`, and no-evidence statuses). Show the docket entry inside the item, and group an item with its linked records rather than listing both.
- **Phase 8:** rulings on docket entries (`ruling`, `ruled_by`, `reason`; the advisor). A reviewer's "not the same" must be remembered (a rejected link, or a `distinct` verdict) or the next run re-links it. Unlinking is already possible through RLS (`obligation_links_delete`) and is audited.
- **Phase 8:** `approve_version()` snapshots evidence without `inferred`, and leaves out context items, links and trust. Add them to `version_items.item`, without breaking hashes of existing versions.
- **Phase 8:** the pipeline can change the status (and now the trust) of items a reviewer has already accepted. Flag such items for re-review (or show the change in the version diff).
- **Phase 9:** `release_item()` and `audit_row()` still use the obligation's private uploaders for context items. This is safe (more restrictive), but the outgoing lead cannot release or read the audit of a private note built from their own file.
- **Phase 9:** a released private item may borrow from a linked private item of the same uploader that the receiving role cannot read, so its trust can reflect a record they cannot see. The releaser sees this when releasing; consider showing "trust based on records you cannot see" to the receiver.
- **Matching:** links are not transitive (A–B and B–C do not make A borrow C's evidence). Duty pairs are scored on descriptions and approvers only. The fake's duty wording is poor, so offline runs do not link the finance copy of the HoD rule; the live probe does.
- **Phase 11/12:** run `eval:pipeline` on the year-long samples in `data/samples/` (planted items in `data/samples/README.md`) once the generator and scoring exist. Watch duty recall (the prefilter is keyword-based), and matching precision at scale (the 48-pair cap per run; `match_over_limit` counts the rest).

## Phase 7 plan (to confirm with the user before building)

| Piece | Plan |
|---|---|
| Evidence pane | Select a quote to open its full source message (and its neighbours) with the quote highlighted, using the same normalisation as the verifier. RLS-filtered; a released quote without a readable message says so. |
| Linked records | Show an item with its linked records as one card ("Also in Trello", "Also in the minutes"), each with its own level badge; possible matches as a quiet note. |
| Docket in context | A contradicted item links to its docket entry; the Docket tab links back. |
| Gaps tab | Items whose trust is `gap`, commitments with "No evidence kept", and duties with no derivable next date, each with what would close the gap. |
| Trust legend | One accessible legend for the five states instead of repeating the sentence on every card. |
| Tests | Playwright: open a quote's source, see the highlight; role switch hides a finance-level linked record; Gaps tab empty and non-empty states. |

## Claude Code model per phase (recommendation)

| Model | Phases |
|---|---|
| Opus 5.5, high | 5, 6, 8, 10, 12 |
| Sonnet 5.5, medium or high | 7, 9, 11, 13 |

Run `/code-review` on Opus before merging a Sonnet-built phase.
