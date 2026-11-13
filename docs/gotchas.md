# Gotchas learned

Things that broke once and how to avoid them. Read before changing the database, the pipeline, demo copies or tests.

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
