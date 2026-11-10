# Inheritance

A handover ledger for university student clubs.

Every year a club's committee changes and knowledge is lost: who was promised what, which duties come round every semester, and which of them need someone's permission first. Inheritance reads a club's WhatsApp chat exports, meeting minutes (.md/.docx) and Trello JSON export. From them it builds a ledger of **obligations**: commitments owed to people, and recurring duties with the approvals they need.

- Every claim links to a verbatim quote, and code (not a model) checks that the quote really appears in its source message.
- Anything unsupported is shown as a gap ("No evidence kept"), never as done.
- The outgoing lead and faculty advisor review and approve a version before the incoming lead sees it.
- Each role sees only what it is allowed to, enforced by Postgres row-level security.

Workflow: **Connect → Reconstruct → Verify → Review → Handover**.

> **All demo data is synthetic.** No real people or organisations appear in this repository or the live demo.

Built for the CodersInPune Hackathon, Round 2.

## Status

| Phase | Scope | State |
|---|---|---|
| 0 | Scaffold, health route, test tooling, CI | done |
| 1 | Schema, RLS, seed, demo login, role switcher | done |
| 2 | Parsers: WhatsApp, Trello, minutes (.md/.docx), all stamped in IST | done |
| 3 | Connect (import) page and ledger timeline | done |
| 4 | LLM adapter, commitment extraction, quote verifier | done |
| 5 | Fulfilment, recurring duties with approvals, context notes | done |
| 6 | Matching, trust rule, docket | done |
| 7 | Ledger UI and evidence pane | done |
| 8 | Review: two-step sign-off, rulings, immutable versions, audit | done |
| 9 | Handover: people waiting, duty calendar, sealed placeholders, acknowledgements | done |
| 10 | Demo mode: "Load demo club" per visitor, daily keep-alive and clean-up | done |

## Stack

Next.js (App Router, TypeScript strict), Tailwind CSS + shadcn/ui, Supabase (Postgres, Auth, RLS, `pg_trgm`), Anthropic SDK behind a single adapter, Zod, Vitest, Playwright. Hosted on Vercel Hobby and Supabase Free.

## Local setup

Requirements: Node 24, pnpm (via corepack), and Docker Desktop (for local Supabase, from Phase 1).

```bash
export COREPACK_NPM_REGISTRY=https://registry.npmjs.org   # this shell only; lets corepack fetch pnpm
corepack enable pnpm
pnpm install
pnpm db:start                # local Supabase in Docker; prints URL and keys
cp .env.example .env.local   # paste URL, publishable key, secret key; choose DEMO_USER_PASSWORD
pnpm seed                    # four demo accounts + the synthetic demo club
pnpm dev                     # http://localhost:3000
```

Supabase Studio (a database browser) runs at http://127.0.0.1:54323 while the local stack is up. Deploying to hosted Supabase and Vercel is covered in [docs/deploy.md](docs/deploy.md).

Packages always come from the public npm registry. The project `.npmrc` contains only `registry=https://registry.npmjs.org/`, with no tokens or auth. The `COREPACK_NPM_REGISTRY` export applies only to the current shell session, and no global config is changed.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build (what Vercel runs) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | All Vitest projects. RLS tests are skipped (with a count) if Supabase env is missing |
| `pnpm test:unit` | Unit tests only |
| `pnpm test:rls` | RLS integration tests against local Supabase (fails if env is missing) |
| `pnpm e2e` | Playwright: re-seeds, clears the fake model's saved answers, starts the dev server with the fake model, and tests login, roles, import and building the ledger. Set `E2E_BASE_URL` to test a deployment read-only |
| `pnpm db:start` / `db:stop` / `db:status` | Local Supabase stack |
| `pnpm db:reset` | Re-create the local database from `supabase/migrations` |
| `pnpm db:push` | Apply migrations to the linked hosted project (`--remote`; the CLI targets local by default) |
| `pnpm db:types` | Regenerate `src/lib/supabase/database.types.ts` |
| `pnpm seed` / `seed:hosted` | Seed demo accounts and the synthetic club (local / hosted) |
| `pnpm eval:extract` | Extraction quality on the mini scenario (dry run; `-- --yes` calls the model) |
| `pnpm eval:pipeline` | The whole pipeline (commitments, statuses, recurring duties, context) on the mini scenario (dry run; `-- --yes` calls the model; `--model <id>` compares another) |

## Parsers

`src/lib/parsers/` turns uploads into one `ParsedEvent` shape (author, IST timestamp, text, thread, small metadata). They are pure: no database access, no network.

| Source | Parser | Notes |
|---|---|---|
| WhatsApp `.txt` (Android or iPhone) | `parseWhatsApp` | Drops system lines, deleted messages and attachments without text, and counts each. Unknown formats raise a clear error. |
| Trello board `.json` | `parseTrello` | Cards, comments, member additions, list moves (a move into "Done" is flagged), completion and due-date changes. |
| Minutes `.md` or `.docx` | `parseMinutesMarkdown`, `parseMinutesDocx` | One event per dated heading. |

`parseUpload(filename, bytes)` picks the parser from the extension. Every parser returns `{ events, summary }`; the summary is the "what was read" report (counts, dropped items by reason, first and last date, warnings).

**Everything is IST.** WhatsApp exports carry no time zone, so their times are read as IST, and Trello's UTC times are converted to IST. Timestamps are ISO 8601 strings ending `+05:30` (`src/lib/time.ts`). Numeric dates in minutes are read day-first.

`data/samples/` holds format samples and year-long files; `data/scenarios/mini/` is a small scenario with a `ground-truth.json` that the tests check the parsers against.

## Connect (import) and timeline

- **`/import`**: the outgoing lead or advisor chooses files, and the app suggests who may see each one. One-to-one chats start as private, and files whose names mention money start as finance. The uploader confirms they are authorised to use the data and sees a notice naming the LLM provider. Each file is parsed on the server and saved with its events in one transaction by `import_source()`, running as the signed-in user, so RLS checks every row. The raw file is not stored; only its events, a "what was read" summary and its SHA-256 are kept. The page also lists the files your role may read, lets the uploader or advisor remove a file (with a reason, audited), edits aliases, and holds the delete-workspace control. The shared demo club cannot be deleted.
- **`/ledger?tab=timeline`**: every message your role may read, grouped by IST day, filterable by file and text.
- **Upload limit**: about 3.9 MB per import, because Vercel caps request bodies at about 4.5 MB. A year of text-only chat is usually well under that.
- **Sample files**: synthetic sample files to try the flow are linked from the page (`public/samples/mini/`).

## Building the ledger (LLM)

One button on `/ledger`, **Build the ledger**, runs every step in order as small jobs. The browser calls `POST /api/jobs/run-next` until all are done, showing progress for each stage. Each step runs as the signed-in user, so the model only sees messages that user may read. Job records hold ids and counts, never text. Results are drafts for review.

1. **Commitments** (`src/lib/pipeline/extract.ts`). Messages are chunked by thread. The model returns candidates citing short message references. Code keeps a candidate only if its quote is verbatim in the cited message, it isn't hedged ("maybe", "will see"), and it names a counterparty and a deliverable. Everything else is dropped and counted by reason.
2. **Recurring duties** (`cycles.ts`). Code picks messages that mention cycles, rules or approvals. The model groups them into duties: how often, what approval is needed and from whom, how far ahead to start. The cadence, approver and lead time must appear in the duty's own quotes, or they are left blank (or the duty is dropped). Next-due and start-by dates are computed by code, from a stated month or one period after the last recorded instance, and the ledger says which ("Stated in the records" or "Estimated"). When neither is possible it says "Not derivable from the records".
3. **Follow-up and context** (`fulfilment.ts`, `related.ts`). For each item, code picks the related messages: rare shared words, plus the same Trello card. The model reports later messages that say it was done, imply it was done, or say it was not done, plus up to five context notes: decisions, contacts, risks and dependencies. Code drops follow-ups that are unverified, dated before the promise, the promise itself, hedged or a question. It also drops notes that name a person or number not in their own message, or that are about something else.
4. **Status from evidence alone** (`status.ts`, mirrored by `app.followup_status()` in SQL). Says done and not done: **Contradicted**. Says done: **Done**. Only implies done: **Likely done (inferred)**. Only says not done: **Open**. Nothing: **No evidence kept**. An item not yet checked says so.

Safeguards:

- **One adapter.** Every model call goes through `generateStructured()` in `src/lib/llm/adapter.ts`. It uses structured output validated with Zod, retries once on invalid output, caches responses by prompt hash in `llm_cache`, enforces a daily call budget (`LLM_MAX_CALLS_PER_DAY`), and returns typed errors. Tiers map to `LLM_MODEL_FAST` and `LLM_MODEL_STRONG`; every task currently uses the fast tier. Providers are swappable: `anthropic`, or `fake` for offline tests.
- **Every check runs twice.** Quotes, dates and grounding are checked in TypeScript, then again inside the database functions that store them (`add_extracted_commitment()`, `add_recurring_duty()`, `record_followup()`). A claim without a verified quote cannot be saved.
- **Prompts never mix access levels.** Commitment chunks and duty batches hold messages of one access level only (and one uploader for private files), so nothing the model writes can carry restricted text into a more open row. The database refuses a duty whose quotes span levels.
- **Levels follow the evidence.** An item inherits the most restrictive message it cites, including follow-up evidence, so a status learned from finance minutes is visible only to finance readers. Each context note has the level of its own message.
- **Audited.** Every stored item, quote, note and status change writes an audit row with the reason. Re-running finds nothing new, reuses saved answers and writes no new audit rows.

**`pnpm eval:pipeline`** scores the whole pipeline on the mini scenario. It estimates cost without `--yes`, and calls the model only with `-- --yes`. Last run (Claude Haiku 5.5, 9 Nov 2026): 5 of 5 commitments, 0 decoys, 5 of 5 statuses right, 5 of 5 expected follow-up quotes, the contradiction detected, 2 of 2 recurring duties with the right approver, 12 calls, about $0.005.

## Review and versions

`/review` is the fourth step. Nothing reaches the incoming lead until it has been checked and approved.

- **Draft** (outgoing lead and advisor): every item with its quotes, grouped as *Changed since accepted*, *Draft*, *Accepted* and *Rejected*. Each can be accepted, edited (a fixed list of fields; status and trust are never editable), rejected or moved back to draft, always with a reason. Linked records can be marked "Same item" or "Not the same"; a verdict stands, and later runs leave that pair alone.
- **Sign-off in two steps.** The outgoing lead marks the accepted draft ready; the faculty advisor approves it as a new version, and only while that mark still matches. Any change to an accepted item or note afterwards means a new mark. An accepted item whose status or trust moved because a later run found new records is flagged, and blocks both steps until it is accepted again or rejected.
- **Conflicts.** The advisor rules on each (done, not done, cannot tell) with a reason. A ruling is the advisor's decision, shown as such; the item stays contradicted because the records still disagree.
- **Versions** are immutable, even for the service role. Each holds the items with their evidence (including which quotes are only inferred), the same-item links, the conflicts with their rulings, and context notes, each at its own access level. Every role sees the diff from the previous version built only from the rows it can read.
- **History** lists every review action from the audit log with its actor, reason and what changed.

## Roles and permissions

Permissions are enforced by Postgres row-level security (`supabase/migrations/0003`–`0004`, and `0014` for the working ledger). The UI never decides what a role can see.

| Role | Can read |
|---|---|
| Faculty advisor | Everything |
| Outgoing lead | Everyone, committee, finance, plus private items built only from files they uploaded |
| Treasurer | Everyone, committee, finance |
| Incoming lead | Approved versions only (items at everyone or committee level, plus items released to the role), never the working ledger |
| Member | Approved versions only (items at everyone level) |

Any role can also read items explicitly released to it, through `release_item()`, which is audited.

How the guarantees are enforced:

- **Inherited levels.** An obligation inherits the most restrictive level of the messages it cites; a trigger does this, so it doesn't depend on the import code.
- **Immutable records.** Approved versions, version items, acknowledgements and audit rows can't be changed, even with the service role. Only `delete_workspace()` can remove them.
- **Tests.** `tests/rls/` proves each role sees exactly its expected rows.

Demo accounts (synthetic): `arun.demo@example.com` (outgoing lead), `meena.demo@example.com` (advisor), `kavya.demo@example.com` (incoming lead), `divya.demo@example.com` (treasurer). These are shared by every visitor.

## Demo mode

- **Load demo club** (on `/login`) builds the visitor a private copy of the synthetic club: a workspace with four accounts of its own, the same messages and items, and version 1 approved (`src/lib/demo/sandbox.ts`, `load-club.ts`; the seed script uses the same loader for the shared club). Nothing a visitor does reaches anyone else, and RLS applies as in any club. The role menu switches only among the accounts of the visitor's own copy.
- Copy accounts have no stored password: the server derives each from the account's email with an HMAC under `SUPABASE_SECRET_KEY`. A signed, http-only cookie offers "Return to your demo club" after signing out.
- A copy is deleted after 7 days, when its visitor deletes it on Connect, or when they start a fresh one. Bookkeeping is in `demo_sandboxes` (service role only; migration `0017`). At most 300 copies are active and 60 start per hour.
- **Daily cron** (`vercel.json` → `GET /api/cron/daily`, guarded by `CRON_SECRET`): queries the database so the free Supabase project is not paused, and deletes expired copies.

## Troubleshooting

- **`unable to get local issuer certificate` when calling the Anthropic API locally.** Your network re-signs HTTPS traffic with its own certificate, which your operating system trusts but Node's built-in list does not. `pnpm dev`, `pnpm eval:extract` and `pnpm eval:pipeline` already pass Node's `--use-system-ca`, so Node uses the operating system's trusted certificates. Certificate checking stays on. Vercel is not affected.

## Health check

`GET /api/health` → `{ "status": "ok", "service": "inheritance", "commit": "abc1234", "db": "ok", "time": "..." }`

`db` is `ok`, `error` or `not_configured`; `status` is `degraded` unless `db` is `ok`.

## Docs

- [docs/changes-from-round1.md](docs/changes-from-round1.md)
- [docs/ai-disclosure.md](docs/ai-disclosure.md)

## Licence

MIT, see [LICENSE](LICENSE).
