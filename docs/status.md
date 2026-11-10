# Build status and handover notes

Read this first when resuming work. Last updated: 2026-11-10, at the end of Phase 13.

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
| 7 | Ledger UI and evidence pane (quote highlighted in source) | merged |
| 8 | `/review`: two-step sign-off, rulings, version diff, immutable versions, audit | merged |
| 9 | `/handover`: "people waiting on you", calendar, sealed placeholders, acks | merged |
| 10 | Demo mode ("Load demo club" per visitor, keep-alive cron) | merged |
| 11 | Synthetic generator (`world.yaml`, `ground_truth.yaml`, offline renderer) | merged |
| 12 | Scoring, leak tests, second scenario, end-to-end tests | merged |
| 13 | P6 rule, Trello precision, built year club and empty club in demo copies, replies, walkthrough, Round 2 docs | on branch `build/phase-13`, ready to merge |
| 14+ | Round 3: the three committed improvements (see the plan at the end) | later |

Tests at the end of Phase 13: 395 unit, 185 RLS integration, 48 Playwright, all passing; lint, typecheck and production build clean. Tests at the end of Phase 12: 379 unit, 175 RLS integration, 45 Playwright, all passing. Lint, typecheck clean. Tests at the end of Phase 11: 338 unit (10 new in `src/lib/synth`), RLS and Playwright unchanged from Phase 10 (not re-run: no database or app code changed). Tests at the end of Phase 10: 328 unit, 162 RLS integration, 39 Playwright, all passing. Lint, typecheck and build are clean. (The Phase 9 line said "456 unit"; that was unit plus RLS: 304 + 152.)

## How the user works

- One branch per phase (`build/phase-N`), small commits. The user merges through GitHub pull requests; never push or merge yourself.
- Stop at the end of each phase with a summary. Wait for "start phase N".
- Ask before adding a dependency not named in CLAUDE.md.
- Ask before any paid model call. Show a cost estimate first.
- The user chooses the Claude Code model per phase (see the table below).

## Outstanding user tasks (for Phase 13, before submitting Round 2)

1. Review and merge `build/phase-13`.
2. **Apply migrations 0018, 0019 and 0020 to the hosted database:** `pnpm db:push`. The live app was still on the Phase 10 deployment on 10 Nov 2026 (`/api/health` reported commit `3146723`), so 0018 was never applied either. Without 0020, the handover page fails for every role (it reads `ack_replies`).
3. **Redeploy `main` on Vercel** (deploys are not automatic for this project; see `docs/deploy.md`). Then check `/api/health` reports the new commit.
4. **Pre-load the saved model answers:** `pnpm cache:warm` (reads `.env.hosted.local`). Building from the sample files, or rebuilding the year club, then costs nothing and is fast.
5. In a private window, on the live link: Sign in → "Explore a built handover" (it must finish within the 60-second limit on the hosted database; locally it takes a few seconds), then "Start from your own files" → import the four photography files → Build the ledger → Review → Approve → Handover → reply to a question. Then submit the form and upload the project PDF to Drive ("Anyone with the link: Viewer"). The form answers and the PDF are kept locally, not in git (`docs/round2-submission.md` and `docs/Inheritance_Round2_Project.pdf`, both ignored); `node scripts/render-report.ts` regenerates the PDF from `docs/round2-report/report.html`.
6. Paid model calls this phase, all approved in advance, synthetic data only (Claude Haiku 5.5): the year build about $0.053, the photography build about $0.013, the mini build about $0.004. Total about $0.070 of the $0.25 approved. The separate in-memory eval re-runs were skipped: the three database-path builds are scored by the same scorer.
7. The Round 1 user interviews were not done. The docs say so. Do not add interview answers unless real people gave them.

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
| 0012 | `events.seq` (identity, the order within its file; index on `source_id, seq`). `import_source` now inserts in file order (`jsonb_array_elements … with ordinality`; `jsonb_to_recordset` cannot take ordinality with a column list). |

| 0013 | Review (Phase 8). `obligations.reviewed_status`, `reviewed_trust` (what an item was accepted with); `app.needs_rereview()`; guard triggers `obligations_zz_review_guard` (a signed-in user's update needs `app.audit_reason`; `review_state` and `reviewed_*` change only under `app.review_action`; inserts by users are always drafts) and `docket_entries_review_guard` (rulings only through `rule_conflict`). `review_obligation()` (accept, edit, reject, reopen; whitelisted fields; invoker), `rule_conflict()` (advisor), `set_link_verdict()` (`same` or `distinct`, method `reviewer`). `app.version_item()` (format 2: obligation, evidence with `inferred`, `linked_same`, `conflicts` with rulings), `app.item_core()` (format-independent comparison), `version_context_items` (own table, own RLS, immutable), `version_items.item_format`. `review_signoffs` (immutable), `app.pending_hash()`, `mark_ready()`, a new `approve_version()` (advisor, needs a current mark, refused while any item needs re-review), `pending_review()`. `app.audit_row()` and `app.audit_link()` write `app.audit_action` as the action name; `audit_row` skips a server-only change of `reviewed_*`. |
| 0014 | `app.sees_working_ledger()` (outgoing lead, advisor, treasurer). `app.can_read_obligation()`, `obligations_select` and `docket_select` require it, so the incoming lead and members read approved `version_items` only. |
| 0015 | `signoff_status()`: whether the lead's mark still matches, without exposing the hash. |

| 0016 | `acks`: a before-insert trigger needs a note for `question` and `decline`; an after-insert trigger (`app.audit_ack`) writes an audit row (`ack_<action>`) with the item's level and uploaders. |
| 0018 | Private items by their uploader (Phase 12). `app.obligation_provenance()` keeps the given `private_uploaders` on an insert with no evidence yet (only for a private item); `add_extracted_commitment()` and `add_recurring_duty()` pass the cited file's uploader. Before this, a new private item was unreadable to the outgoing lead for the moment before its first quote, so his own private chats yielded nothing. |
| 0019 | P6 (Phase 13). `app.own_visibility(obligation)`: level and private uploaders of an item's own 'supports' messages. `record_followup()` refuses a `fulfils` quote marked `inferred` from a message more restricted than that (another uploader's private file counts as more restricted). |
| 0020 | Replies (Phase 13). `ack_replies` (ack_id, user_id, text 1–1000, created_at): select when the ack is readable (under the caller's RLS on acks); insert only by the outgoing lead or advisor, as themselves, to a question or decline; immutable; audited as `ack_reply` at the item's level (`app.audit_ack_reply`). |
| 0017 | Demo copies. `workspaces.sandbox_expires_at` (set by the server only; members have no update policy). `demo_sandboxes` (id = the copy's workspace id, `workspace_id` set null when the workspace is deleted, `user_ids`, `created_at`, `expires_at`; RLS on, no policies, service role only). |

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
| `review/` | Pure, tested: `fields.ts` (editable fields per kind, `changedFields`), `diff.ts` (`diffVersions` over readable rows, format-1 aware), `readiness.ts` (why mark-ready or approval is blocked, in words), `rereview.ts` (`needsRereview`, mirror of the SQL), `history.ts` and `labels.ts` (audit rows and rulings in words). |
| `pipeline/match.ts` | Also `pairKey` and the `skip` set of `planMatches`: a pair a reviewer ruled on is never scored or asked about again. |
| `handover/handover.ts` | Pure: `toHandoverItem`, `peopleWaiting`, `dutyCalendar` and `dutyTiming` (today is an IST day), `latestAckByItem`, `ackSummary`. `istToday()` is in `time.ts`. |
| `demo/load-club.ts` | `insertClub` (workspace, memberships and every fixture row, as the service role, through the usual triggers), `finishClub` (releases, and optionally mark ready and approve version 1, as the club's own users), `fixtureIds` / `freshIds` (a copy gets new ids for every row), `memoSignIn`. Used by `scripts/seed.ts` and by demo copies. |
| `demo/frozen-club.ts` | Phase 13. `FrozenClub` (keyed rows: sources with their events in file order, obligations, evidence, context, links, docket summaries, aliases, sealed), `insertFrozenClub` (fresh ids; events in batches of 500 in file order so `seq` follows the file; links sorted a < b; reviewed baseline for accepted items), `insertEmptyClub`, `parseRef`, `eventText`. Data: `demo/year-club.json`, written by `scripts/freeze-demo.ts`. |
| `demo/sandbox.ts` | `ClubKind` (`year`, `empty`, `toy`; the action allows the first two, tests use `toy`), `CLUB_NAMES`, `yearClub()` (lazy JSON import). Pure plus injected clients: `sandboxEmail` (`<key>+<workspace id>@example.com`), `sandboxPassword` (HMAC of the email under the secret key), `signSandboxCookie` / `readSandboxCookie`, `capacityProblem`, `createSandbox`, `purgeOne`, `purgeSandboxes`, `demoKeyFromMetadata`. Limits: 7 days, 300 active, 60 per hour, 10-minute grace for a row without a workspace. |
| `demo/sandbox-server.ts` | `server-only`: `sandboxConfig` (reads `SUPABASE_SECRET_KEY`), `serviceClient`, `ephemeralSignIn`, `sandboxCookieOptions`, `forgetDeletedCopy` (not a server action on purpose: it takes a workspace id). |
| `eval/scenario.ts`, `eval/score.ts` | Phase 12. `loadScenario(name)` (mini JSON or generated YAML truth; events at their file's level, private ones with their uploader), `eventFor`. `scoreRun(result, scenario)` → a `Scorecard` (found, precision, status, trust, level, evidence, contradictions, duties and approvers, links, leaks); `findLeaks`; `formatScorecard`, `summary`. Matching is by message **and** overlapping quote (one minutes entry holds several items); truth may list `alternates` for a promise stated twice. |
| `synth/docx.ts` | `renderDocx` (Heading styles, as the minutes parser reads them) over `zipStore` (stored zip, fixed timestamp, CRC from `node:zlib`). No dependency. |
| `synth/world.ts`, `rng.ts`, `generate.ts`, `truth.ts` | The scenario generator. Phase 12: chats can be `kind: direct` (one-to-one); each file has an `uploader` (a demo account key); Trello is optional; minutes are `.md` or `.docx` with `dates: iso` or `words`; `generateScenario` returns text or bytes (`fileBytes`). `loadWorld` (Zod, checks people and lists), `generateScenario(world)` (two WhatsApp chats, a Trello board, minutes; pure and seeded), `loadTruth`, `checkTruth` (every quote is in its file; restricted amounts stay at their level). Script: `pnpm gen:scenario` (`-- --check` compares). Data: `data/scenarios/year/`. |
| `cron.ts` | `cronAuthorised` (constant-time bearer check; refuses when `CRON_SECRET` is unset or short). |
| `pipeline/provider.ts`, `fake-extract.ts`, `fake-pipeline.ts` | `LLM_PROVIDER=fake` is the rule-based offline stand-in, refused in production. `fakeHandlers()` covers every task. |

### App (`src/app/`)

| Path | Contents |
|---|---|
| `/login` | "Your own demo club" card with two forms posting `club=year` ("Explore a built handover") or `club=empty` ("Start from your own files"; lands on `/import?welcome=empty`) (and Return to your demo club, from the signed cookie; Start a fresh copy) and the shared demo accounts below. `maxDuration` 60 for the load action. Actions in `src/app/actions/demo-club.ts` (`loadDemoClub`, `returnToDemoClub`) and `auth.ts` (`signInAsDemo` with `club=shared` or `club=mine`). |
| `/import` | Connect: upload, access level per file, authorisation checkbox, what was read, files, aliases, delete workspace. |
| `/ledger` | "Build the ledger" panel (`pipeline-panel.tsx`); Commitments and Recurring tabs (`commitments.tsx`, `recurring.tsx`; shared `obligation-parts.tsx` with `AlsoRecorded`, `PossibleMatches`, `DocketLink`; `link-data.ts` loads links and docket ids; grouping in `src/lib/ledger-view.ts`); Docket tab (`docket.tsx`, one entry per pair of claims, anchors `#docket-<id>`); Gaps tab (`gaps.tsx`, `findGaps`); Timeline tab; `trust-legend.tsx`. Item cards have anchors `#item-<id>`. |
| `/ledger/evidence/[id]` | The source message for one quote (`?kind=context` for a context note), highlighted with `src/lib/pipeline/locate.ts` and shown with two neighbours either side in file order (`seq`). All reads go through RLS; a query error is shown as an error, never as "not visible to your role". |
| `/review` | Tabs by role. **Draft** (outgoing lead, advisor): sign-off panel, the pending diff against the last version, items grouped Changed since accepted, Draft, Accepted, Rejected, each with accept, edit, reject or back to draft and "Same item" or "Not the same" on linked records. **Conflicts** (advisor rules; the treasurer reads). **Versions** (everyone). **History** (reviewers). Components in `src/components/review/`, actions in `src/app/review/actions.ts`. |
| `/review/versions/[number]` | One version as the viewer's role may read it, with the diff from the version before. Built from `version_items` and `version_context_items` through RLS. |
| `/ledger` | For the incoming lead and members the working-ledger tabs show a notice pointing to Review; the Timeline is unchanged. |
| `/handover` | The latest approved version as the role reads it: People waiting, Calendar, Sealed items. Incoming lead answers items (`AckForm`, action `acknowledge`); reviewers see answers, reply to questions and declines (`ReplyForm`, action `replyToAck`) and can add a placeholder (`sealPlaceholder`). Components in `src/components/handover/`. |
| `/guide` | Phase 13. Static walkthrough for first-time visitors (both demo paths). Linked from the header ("Walkthrough") and the sign-in page. |
| `/api/jobs/run-next` | One job per POST (`maxDuration` 60). Returns `done` and `waiting` (an earlier stage still running elsewhere). |
| `/api/health` | Health check. |
| `/api/cron/daily` | Daily Vercel cron (`vercel.json`, 21:30 UTC). Needs `Authorization: Bearer $CRON_SECRET`. Queries the database (keep-alive) and purges up to 25 expired or deleted copies. Excluded from `proxy.ts`. |

### Tests

- **Unit:** `src/**/*.test.ts`.
- **RLS:** `tests/rls/*.test.ts`, against local Supabase. Each file re-seeds and cleans up.
- **E2E:** `e2e/`. Its own dev server on port 3100 with `LLM_PROVIDER=fake`, so it never calls the real API. Global setup re-seeds and clears `llm_cache` rows whose model is `fake:%`. `full-flow.spec.ts` (Phase 12) runs the whole flow on the photo club in a visitor's copy, then a per-role leak sweep of every page and of every source-message URL.
- **Leak tests (Phase 12):** `src/lib/eval/eval.test.ts` (in memory, every scenario), `tests/rls/leak.test.ts` (both generated scenarios, every readable row per role), `tests/rls/private-items.test.ts` (migration 0018), and the e2e sweep. Each also proves the restricted text is readable by someone allowed.
- **Frozen club (Phase 13):** `src/lib/demo/frozen-club.test.ts` (every quote verifies, messages equal the scenario files, provenance, restricted text), `tests/rls/sandbox-clubs.test.ts` (year and empty copies through the real triggers; file order; statuses and levels equal the build; version 1; per-role reads; build time under 20 s locally).
- **Eval:** `pnpm eval:extract` and `pnpm eval:pipeline` (`-- --yes` calls the model; `--model <id>` overrides the fast model). Shared loader: `scripts/mini-scenario.ts`.
  - Last `eval:pipeline` result (Haiku, 9 Nov 2026): 5 of 5 commitments, 0 decoys, 5 of 5 statuses, 5 of 5 expected follow-up quotes, X1 detected, R1 and R2 found with the right approvers. 12 calls, about $0.005.
  - Phase 6 run (Haiku, 9 Nov 2026): the same 5/5, 0 decoys, 5/5 statuses, 5/5 follow-up quotes, X1 detected, R1 and R2 found; trust right for 5/5 commitments and 2/2 duties; context notes now on topic. 12 calls, about $0.0045. Haiku made no duplicate items on the mini data, so no pair reached the matching prompt.
  - Matching probe (`-- --yes --match-probe-only`, 9 Nov 2026): 8/8 planted pairs right (3 same, 5 different), 0 false "same". 1 call, about $0.0003.
  - Phase 12 (Haiku, 10 Nov 2026), `--scenario photo`: 9/9 commitments, 8/9 statuses, 8/9 trust, 2/2 levels, 9/9 follow-up quotes, 1/1 contradiction, 4/4 duties with 4/4 approvers, 0 decoys, 0 leaks, precision 90%. 27 calls, about $0.013.
  - Phase 12 (Haiku, 10 Nov 2026), `--scenario year`: 19/19 commitments, 17/19 statuses (18/19 against the corrected C18), 15/16 trust, 2/2 levels, 24/24 follow-up quotes, 2/2 contradictions, 3/4 duties with 3/3 approvers, 0 decoys, 0 leaks, precision 79%, 1 wrong link (now fixed). 86 calls, about $0.053.

## Gotchas learned

- **The database reads messages in time order; the in-memory runner reads file by file.** `chunkEvents` now packs threads per group (visibility and source type), so both give the same chunks. Before Phase 12 the database path made a chunk per chat-day when two chats interleaved.
- **`pending_review()` lists accepted items only.** Drafts come from `obligations` with `review_state = 'draft'`. After any new run, the demo fixture's accepted items are re-checked, their status moves, and they need "Accept again" before marking ready.
- **Playwright gives each test a fresh browser context.** A serial flow that needs one session (a visitor's copy) shares a page created in `beforeAll`.
- **The timeline echoes its search term** (search box, paging links). A leak check of a search page reads the results list (`data-testid="timeline"`) only.
- **A truth quote can share its message with another item** (minutes). Score by message and quote, never message alone.
- **Shell: chain checks with `&&`.** A `;` after `tsc` once let a commit through with a type error.

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
- **Matching skips pairs a reviewer ruled on, and no others.** Every run re-proposes the other pairs in the same order, so match batches hit the cache; `link_obligations()` is idempotent and never changes a reviewer's verdict. A link a reviewer *deletes* (rather than marking "not the same") still comes back on the next run.
- **Direct updates of obligations are refused.** A signed-in user's UPDATE fails with "a reason is required" unless a SECURITY DEFINER or invoker function set `app.audit_reason` first (the pipeline functions and `review_obligation` do). Tests and scripts that change an item as a user must use `review_obligation`; the service role (no `auth.uid()`) is exempt, so seeds and fixtures still work.
- **Baseline for re-review.** An accepted item inserted by the service role has no `reviewed_*` and so counts as changed. After inserting evidence (which settles trust), set `reviewed_status` and `reviewed_trust` from the row, as `scripts/seed.ts` and the delete-workspace test do.
- **Approving needs a mark.** `approve_version()` fails without a current `mark_ready()`. RLS tests that approve call `mark_ready` as Arun first; any change to an accepted item or note in between needs a new mark.
- **The seed approves version 1** only with `seed(env, log, { approveFirst: true })` (the CLI and the e2e global setup). `resetDemo()` in the RLS tests does not, so version numbers there start at 1 in the test.
- **A copy's accounts are derived, not stored.** Their passwords come from `SUPABASE_SECRET_KEY`. Rotating that key makes existing copies unreachable (they are purged on expiry as usual) and invalidates the return cookie.
- **Never export a helper that takes a workspace id from a `"use server"` file.** Every export there is callable from the browser. `forgetDeletedCopy` lives in `sandbox-server.ts` for that reason.
- **Copy sign-ins are server-side**, so on Vercel they all come from Vercel's IPs and share Supabase's per-IP sign-in limit. A new copy costs two sign-ins (Arun in the visitor's cookie session, Dr. Meena in a throwaway one); each role switch costs one.
- **e2e and RLS tests create copies locally.** The e2e global setup purges every copy before a run; `tests/rls/sandbox.test.ts` purges its own.
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

- **Phase 7 (left):** the Gaps tab lists linked records separately (only the Commitments and Recurring tabs fold them into one card); each gap names its linked twins and why their evidence does not count.
- **Phase 8 (left):** a reviewer who *deletes* a link (instead of "Not the same") is not remembered. The Draft tab only offers the two verdicts, so this is reachable only through the API.
- **Phase 8 (left):** the re-review flag watches status and trust only. A later run that fills a blank field of an accepted item (for example a duty's approver) changes the item's content without flagging it; it does invalidate the lead's ready mark and shows in the pending diff.
- **Phase 8 (left):** the lead's mark covers items the lead cannot read (the advisor's private items), so the advisor's own change to such an item also needs a new mark. The count shown to the lead is of readable items.
- **Phase 8 (left):** no RLS test runs the pipeline's `plan_matches` step over a `distinct` pair; the skip is covered by a unit test of `planMatches` and the SQL by `link_obligations`.
- **Phase 9:** `release_item()` and `audit_row()` still use the obligation's private uploaders for context items. This is safe (more restrictive), but the outgoing lead cannot release or read the audit of a private note built from their own file.
- **Phase 9:** a released private item may borrow from a linked private item of the same uploader that the receiving role cannot read, so its trust can reflect a record they cannot see. The releaser sees this when releasing; consider showing "trust based on records you cannot see" to the receiver.
- **Matching:** links are not transitive (A–B and B–C do not make A borrow C's evidence). Duty pairs are scored on descriptions and approvers only. The fake's duty wording is poor, so offline runs do not link the finance copy of the HoD rule; the live probe does.
- **Phase 11/12:** ~~run `eval:pipeline` on a year of data~~ done in Phase 12 on the generated year club (not `data/samples/`, which stay parser fixtures). Duty recall was 3/4; matching at scale found a rule bug (fixed). No run hit the 48-pair cap.

## Phase 7 decisions

- The evidence pane is a page (`/ledger/evidence/[id]`), not a dialog, so it has a URL, works without JavaScript and is easy to test under RLS.
- Linked records fold into the earliest item's card by direct `same` links only.
- The header's step indicator is now inside `<Suspense>`: dynamic routes failed prerender checks without it.
- Folded records show their own facts (owed by, to, due; or cadence, approval, next due), marked "Differs from the card" where they disagree with the card's own record.
- `same` links that grouping cannot fold (A–B, B–C) are listed on both cards as "Also linked as the same item, on its own card".
- A gap is still reported per record when a linked twin has evidence: the trust rule already borrows wherever it may, so a remaining gap is real at that record's level.
- An item with several conflicts links to each, open ones first.
- The Gaps empty state ("No gaps among the N items you can read") is covered by unit tests of `findGaps`, not Playwright, because the e2e workspace always has gaps.

## Phase 8 decisions (confirmed with the user)

- **Close the draft hole now:** the incoming lead and members read approved versions, not the working ledger.
- **Two-step sign-off:** the outgoing lead marks ready, the advisor approves a current mark. Unruled conflicts do not block approval; they are handed over as "awaiting a ruling".
- **Rulings record the advisor's decision and do not change status or trust.**
- **Re-review blocks:** accepted items whose status or trust moved must be accepted again or rejected before marking ready or approving.
- Found while building: a diff stored in `versions.diff` is for all items, so each role's diff is computed from the rows it can read. Older (format 1) items are compared on the fields they recorded (`app.item_core`, `CORE_FIELDS` in `diff.ts`; keep the two in step).
- No paid model calls were made in this phase.

## Phase 9 decisions

- Read from `version_items` only, for every role, so the page can never show more than the approved version holds for that role.
- A placeholder is a manual act by a reviewer (`sealed_items` insert, audited by the existing trigger). Nothing creates placeholders automatically, because a model- or code-written topic could leak detail.
- Acks were not audited in Phase 1; migration 0016 closes that. The note is the incoming lead's own words.
- Fulfilled commitments are left out of "people waiting"; an item with no `owed_to` is grouped under "Not stated who it is owed to" rather than dropped.
- Known gaps: an acknowledgement is per item, not per version change, so a new version asks again; there is no UI for the outgoing team to answer a question (they can read it). Reviewers see one incoming lead's answers (the demo has one). The earlier Phase 9 notes under Known gaps (release_item for private notes, borrowed trust) still apply.

## Phase 10 decisions

Chosen by me while building; change any you disagree with.

- **One copy = one workspace with four new auth users**, because roles are memberships of users and role switching is a real sign-in. The alternative (adding the shared users to many workspaces) would have mixed visitors' data.
- **Passwords derived by HMAC** under `SUPABASE_SECRET_KEY` rather than stored, or magic links (which count against a lower verification limit). No new secret to configure.
- **Version 1 is approved in every copy**, as in the shared club, so the incoming lead's Handover works at once and the review flow can go on to version 2.
- **7 days**, so a judge can come back; **300 active / 60 per hour**, so the free tier cannot be flooded by repeated clicks.
- **The shared accounts stay** on the sign-in page, labelled as shared. Existing e2e tests use them.
- **One cron for both jobs** (keep-alive and clean-up), since Hobby allows daily crons only. It refuses every caller without `CRON_SECRET`, rather than half-running.
- A fresh copy deletes the visitor's previous one (the signed cookie proves it was theirs). Deleting a copy on Connect also deletes its accounts and signs the visitor out.
- No paid model calls were made in this phase.

## Known gaps (Phase 10)

- Each account is recorded right after it is created, so a function that dies in between leaves at most one account unrecorded. It carries `user_metadata.sandbox`; nothing removes it automatically.
- A purged copy's session token stays valid until it expires (about an hour), but the account has no membership, so it reads nothing.
- A copy is built from the small Phase 1 fixture (9 messages, 6 items). Phase 11's generator should feed `insertClub` a richer club.
- `getViewer()` still takes the first membership; copy accounts have exactly one, but a real user in two workspaces would be ambiguous.

## Phase 11 decisions

Confirmed with the user: add `yaml`; deterministic renderer first.

- **Authored, not drawn.** `world.yaml` holds the planted messages, card histories and meetings word for word. Only filler chat is templated (seeded, so the same bytes every time). Filler templates are tested to contain no promise words, so every commitment-like line in the data is planted and listed.
- **Truth is separate and written by hand.** `ground_truth.yaml` has the same shape as the mini `ground-truth.json` plus `restricted` amounts and `appears` months for duties. `checkTruth` proves every quote is in its file. `expectedTrust` is null where several sources restate a promise, because the answer depends on how the extractor folds them; Phase 12 should not score those.
- **The committed outputs are checked in** and a test fails if they drift from the world (`pnpm gen:scenario`).
- Year scenario: 18 commitments (4 no evidence, 2 contradicted), 4 duties with approvals, 6 decoys, 2 contradictions, 4 files at 4 levels. About 1,300 committee messages, 690 volunteer messages, 19 cards, 6 meetings. Smaller than `data/samples/` by design, and with the planted facts in the same story; those samples stay as parser format fixtures.
- **Not built:** the optional LLM renderer. It would need a new adapter task and a paid run with an estimate. Add it only if the template filler looks too repetitive.
- **Not done:** loading the year club into demo copies through `insertClub`. It needs a loader from parsed files to fixture rows plus a pipeline run (paid with a real model), so it fits with Phase 12.
- No paid model calls were made in this phase, and the pipeline was not run on the new files.

## Known gaps (Phase 11)

- The filler repeats phrases more than real chat does. Tamil-English lines come from a list of eight.
- ~~The scenario has no `.docx` minutes and no private-level file.~~ Closed in Phase 12: the year club has the advisor's private chat; the photo club has Word minutes and the outgoing lead's private chat.
- ~~`eval:pipeline` still reads the mini scenario only.~~ Closed in Phase 12: `--scenario`.
- Trello `dueComplete` is always false in the generated board (moves carry the evidence, as in the mini board).

## Phase 12 decisions

Confirmed with the user: run both paid evals; leave the year club in demo copies for Phase 13.

- **Scoring in code, truth by hand.** The scorer is pure and reused by the eval script and the tests. A promise written twice in one place (the minutes' finance line and its action line) is listed as an `alternate`, not matched loosely.
- **The second club differs on purpose:** different cast, iPhone committee chat, a finance chat, a private chat uploaded by the outgoing lead (the year club's private chat is the advisor's), Word minutes with dates in words, no Trello, monthly and per-event duties.
- **Leak tests at three layers**, each proving it is not vacuous. Who may read a restricted text is computed from the files that contain it (`canRead` over level and uploader), not hand-listed, in the RLS test.
- **The offline fake's floors are recorded, not claimed.** `FLOORS` in `eval.test.ts` say what the rule-based stand-in finds, so a regression in shared code shows up; the paid eval is the quality claim.
- **The cost estimate walks the real prompts** with the offline fake first, and is calibrated on the paid runs (input 1.3 × text + 1,500 a call for the schema; 800 output a call). It still errs high.
- **Fixed because the new tests found them:** the outgoing lead's private items (migration 0018), one chunk per chat-day, the hedge without its "Maybe", "Mr." ending sentences, and the rule linking two semesters' identical promises.
- **C18 in the year truth was wrong** (no_evidence); records say not done, so the status rule gives Open. Corrected with the two quotes.

## What the model got wrong (Phase 12 paid runs)

- **Photo P6** (hand over the camera and keys): the follow-up check took "the passbook stays in the cupboard", from the finance chat, as implying it was done. Status became Likely done, and, by the provenance rule, the committee item became finance-level, so the incoming lead would not see it. See outstanding task 4.
- **Photo:** "Sent the lab licence request to the IT cell." was extracted as a promise (it is a report), and shows as No evidence kept.
- **Year precision 79%:** 8 unplanned commitments, mostly Trello card descriptions ("Count what the lab has.", "Keep updated with receipts.", "Posters in first-year blocks.") and reports ("Posters printed, collecting tomorrow morning.").
- **Year C15:** "Registration desk is ready, forms are printed." judged only implied (Likely done).
- **Year R4** (hold the annual IoT Fest, no approval) not found apart from R2 (the auditorium), which shares its message.
- 23 context notes were dropped by code for naming people or numbers not in their message: the check is doing its job.

## Known gaps (Phase 12)

- The year eval was not re-run after the matching fix (another about $0.05). A unit test covers the exact pair.
- Leak checks search for the planted restricted strings. A paraphrase of a restricted fact (an amount in words) would not be caught; the in-memory check covers model-written text for the literal strings only.
- The browser leak sweep uses the photo club (plus the copy's 9-message fixture); the RLS leak test covers both generated clubs.
- The offline fake does not know "Chief Warden" or "faculty advisor" as approvers, and still extracts Trello card names as promises.
- The P6 finding above is a design question, not fixed.

## Phase 13 decisions

Confirmed with the user: P6 (implied quotes from a more restricted record are dropped); paid runs up to $0.25; two demo-copy choices; interviews are not to be invented.

- **P6.** `inferredMayAttach(item, quoteEvent)` = `canBorrow` from the item's own 'supports' messages to the quote's message. Mirrored in `record_followup()` through `app.own_visibility()`. Plain done / not done still raise the level (the Phase 5 rule stands).
- **Trello precision.** A candidate from a card or checklist (`isTrelloCard`: text starts `Card: ` or `Checklist "`) is kept only with a `Due:` line or an `owed_to` whose content words (minus words that name the club itself) appear in the card. Comments are unaffected. Not mirrored in SQL: it is a precision rule, not a safety rule. No prompt changed.
- **Frozen, not live, demo ledger.** A copy cannot run a 160-call build inside one 60-second action, and judges should not pay or wait. The ledger is the output of one real run through the app's own database path, stored as data, with the build's model and date in `built`. Review states come from the scorer (planted items, restatements and duty copies accepted; extras drafts), not from judgement.
- **Docket summaries** are copied from the build; the entries themselves are opened by the trust rule on insert, as in a live run.
- **The toy fixture stays** for the shared accounts and the RLS tests that assert its rows.
- **Replies attach to one ack** (the latest shown). Only questions and declines take replies.
- **Verify** links to the Docket; `stepForPath(pathname, tab)` marks the Docket, Gaps and evidence pages as Verify.
- **Interviews.** Not done; the docs say so. Fabricated answers were refused.

## What the model got wrong (Phase 13 builds, database path)

- **Year: 6 unplanned items** (the drafts in the built club): "collect the printed posters" (a report), "registration renewal status report" (a report), and four Trello cards with due dates (banner design, registration form, recruitment posters, an October permission-letter card).
- **Year: one wrong link.** The card "Lab permission letter (Nov workshop)" was linked to the January promise (C2) as well as to C1. The scorer counts a wrong link only between two planted items, so this is not in its count.
- **Year C15** ("Registration desk is ready, forms are printed.") is still only Likely done.
- **Year R4** (hold the annual IoT Fest, no approval) is still missed; it shares its message with R2.
- **Photo:** "Sent the lab licence request to the IT cell." is still extracted as a promise (a report). The P6 item (camera and keys) is now right: status and trust 9/9.

## Known gaps (Phase 13)

- A reply belongs to one acknowledgement; when the incoming lead answers an item again, older replies are not shown on the handover page (they remain in the audit log).
- The built club's dates were computed for 10 Nov 2026 (`built.today`). "Overdue" and "Start now" are computed live, so they drift as time passes; next-due dates do not roll forward until the ledger is rebuilt.
- Building a year copy on the hosted database has not been timed (locally a few seconds). If it nears 60 seconds, batch the evidence and context inserts further or move the sign-off out of the request.
- `pnpm cache:warm` is a manual step; a new deployment against a fresh database needs it again.
- No accessibility audit yet.
- The earlier known gaps still apply (Phase 7–12 lists above): release of private notes, borrowed trust shown to the receiver, the Gaps tab and linked twins, deleted links not remembered, re-review watching status and trust only.

## Round 3 plan (Phases 14 to 16): the three committed improvements

Committed in the Round 2 form; Round 3 is judged on delivering exactly these.

1. **Inferred recurring duties.** Detect a task repeated at about the same point in two or more past cycles with no stated rule; label it Inferred; list the past occurrences; compute a start-by date from how long past occurrences took. Needs: an occurrence finder (code over matched items and dates), a new duty source kind, the trust rule's "inferred" path, calendar display, ground truth for unstated duties in both scenarios, a paid eval.
2. **Gap questions.** Turn each gap (no follow-up, missing approver or date, unruled conflict) into a short question for the outgoing lead on one page; record each answer as a labelled source ("stated by the outgoing lead") with its own access level, through the same trust and audit rules; update the next version.
3. **Counterparty handoff notes.** Per counterparty, a note of what is still owed and the new contact, built only from that counterparty's approved items (template plus fields, no model text carrying restricted facts), edited and approved by the outgoing lead, opened by the counterparty through a signed link, and acknowledged; the acknowledgement shows on the handover.

Also for Round 3 (the brief asks for them): a demo video, accessibility checks, testing notes on failure cases, and a final report.

## Claude Code model per phase (recommendation)

| Model | Phases |
|---|---|
| Opus 5.5, high | 5, 6, 8, 10, 12 |
| Sonnet 5.5, medium or high | 7, 9, 11, 13 |

Run `/code-review` on Opus before merging a Sonnet-built phase.
