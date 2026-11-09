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
| `pnpm e2e` | Playwright: re-seeds, starts the dev server, tests login and role switching. Set `E2E_BASE_URL` to test a deployment read-only |
| `pnpm db:start` / `db:stop` / `db:status` | Local Supabase stack |
| `pnpm db:reset` | Re-create the local database from `supabase/migrations` |
| `pnpm db:push` | Apply migrations to the linked hosted project |
| `pnpm db:types` | Regenerate `src/lib/supabase/database.types.ts` |
| `pnpm seed` / `seed:hosted` | Seed demo accounts and the synthetic club (local / hosted) |

## Roles and permissions

Permissions are enforced by Postgres row-level security (`supabase/migrations/0003`–`0004`). The UI never decides what a role can see.

| Role | Can read |
|---|---|
| Faculty advisor | Everything |
| Outgoing lead | Everyone, committee, finance, plus private items built only from files they uploaded |
| Treasurer | Everyone, committee, finance |
| Incoming lead | Everyone, committee |
| Member | Everyone |

Any role can also read items explicitly released to it, through `release_item()`, which is audited.

How the guarantees are enforced:

- **Inherited levels.** An obligation inherits the most restrictive level of the messages it cites; a trigger does this, so it doesn't depend on the import code.
- **Immutable records.** Approved versions, version items, acknowledgements and audit rows can't be changed, even with the service role. Only `delete_workspace()` can remove them.
- **Tests.** `tests/rls/` proves each role sees exactly its expected rows.

Demo accounts (synthetic): `arun.demo@example.com` (outgoing lead), `meena.demo@example.com` (advisor), `kavya.demo@example.com` (incoming lead), `divya.demo@example.com` (treasurer).

## Health check

`GET /api/health` → `{ "status": "ok", "service": "inheritance", "commit": "abc1234", "db": "ok", "time": "..." }`

`db` is `ok`, `error` or `not_configured`; `status` is `degraded` unless `db` is `ok`.

## Docs

- [docs/changes-from-round1.md](docs/changes-from-round1.md)
- [docs/ai-disclosure.md](docs/ai-disclosure.md)

## Licence

MIT, see [LICENSE](LICENSE).
