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
| 1 | Schema, RLS, seed, demo login | in progress |

## Stack

Next.js (App Router, TypeScript strict), Tailwind CSS + shadcn/ui, Supabase (Postgres, Auth, RLS, `pg_trgm`), Anthropic SDK behind a single adapter, Zod, Vitest, Playwright. Hosted on Vercel Hobby and Supabase Free.

## Local setup

Requirements: Node 24, pnpm (via corepack), and Docker Desktop (for local Supabase, from Phase 1).

```bash
corepack enable pnpm
pnpm install
cp .env.example .env.local   # then fill in values
pnpm dev                     # http://localhost:3000
```

If your machine has a global npm registry mirror configured, installs still use the public registry. This repo pins it in `.npmrc` and `pnpm-workspace.yaml`. If pnpm itself fails to download, run once with `pnpm_config_registry=https://registry.npmjs.org/`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server |
| `pnpm build` | Production build (what Vercel runs) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm test` | All Vitest projects (unit + RLS integration) |
| `pnpm test:unit` / `pnpm test:rls` | One project only |
| `pnpm e2e` | Playwright (starts the dev server; set `E2E_BASE_URL` to test a deployment) |

## Health check

`GET /api/health` → `{ "status": "ok", "service": "inheritance", "commit": "abc1234", "time": "..." }`

## Docs

- [docs/changes-from-round1.md](docs/changes-from-round1.md)
- [docs/ai-disclosure.md](docs/ai-disclosure.md)

## Licence

MIT, see [LICENSE](LICENSE).
