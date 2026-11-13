# Working on another computer

How to go from a fresh machine to a working copy of Inheritance: tests passing, the app running locally, and able to deploy. Expect about 30 minutes, most of it Docker pulling the Supabase images.

Everything Claude Code needs is in the repository: [CLAUDE.md](../CLAUDE.md) (rules) and [status.md](status.md) (where the build is). Claude Code's memory lives on each machine and does not travel, so anything worth keeping goes into those two files, not memory.

## 1. Install the tools

| Tool | Version | Notes |
|---|---|---|
| Git | any recent | Plus access to the GitHub repository (SSH key or `gh auth login`). |
| Node.js | **24.x** | `package.json` pins `engines.node` to 24. Node 24 is needed for `--use-system-ca` and for running `.ts` scripts directly. |
| pnpm | 12 (via corepack) | Pinned by `packageManager` in `package.json`; corepack fetches the right version. |
| Docker Desktop | any recent | Runs the local Supabase stack. Must be running before `pnpm db:start`. |
| Claude Code | latest | Optional. CLI, desktop app or VS Code extension. |

The Supabase CLI and Playwright come with `pnpm install` (dev dependencies); do not install them globally.

**Use macOS, Linux, or Windows with WSL 2.** Several scripts use POSIX shell syntax (`NODE_OPTIONS=... next dev`), which plain Windows `cmd` or PowerShell does not understand.

## 2. Clone and install

```bash
git clone <repository URL> inheritance-club-handover
cd inheritance-club-handover
export COREPACK_NPM_REGISTRY=https://registry.npmjs.org   # this shell only
corepack enable pnpm
pnpm install
pnpm exec playwright install chromium                     # browser for e2e tests and the report renderer
```

Packages always come from public npm: the project `.npmrc` contains only `registry=https://registry.npmjs.org/`. The `COREPACK_NPM_REGISTRY` export matters only on a machine whose global npm config points at a private mirror (the user's work Mac does). Never put a registry token or company mirror in the project, and never edit a global `~/.npmrc` to work around it.

## 3. Bring the secrets across

Two git-ignored files hold every secret. **Never commit them, paste them into chat, or send them through anything that keeps a copy.** Move them with a password manager, or re-create them from the dashboards listed below.

### `.env.local` (local development)

Start from the template: `cp .env.example .env.local`.

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Printed by `pnpm db:start` (`http://127.0.0.1:54321`). **Per machine: do not copy from the old machine.** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Printed by `pnpm db:start` ("Publishable key"). Per machine. |
| `SUPABASE_SECRET_KEY` | Printed by `pnpm db:start` ("Secret key"). Per machine. |
| `DEMO_USER_PASSWORD` | Any password you choose for the four local demo accounts. |
| `ANTHROPIC_API_KEY` | Anthropic Console, or the old machine's file. Only needed for paid runs (`eval:*`, `demo:freeze`) and building from files with the real model. Tests use the offline fake. |
| `LLM_MODEL_FAST`, `LLM_MODEL_STRONG`, `LLM_PROVIDER`, `LLM_MAX_CALLS_PER_DAY` | Copy the defaults from `.env.example`. |
| `CRON_SECRET` | Not needed locally. |

### `.env.hosted.local` (hosted database: seeding, warming the model cache)

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → project `gmlsskizjxhtoxnwhywj` → Project Settings → API Keys. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same page. |
| `SUPABASE_SECRET_KEY` | Same page. **Do not create a new one unless you must:** demo-copy passwords are derived from it, so rotating it locks visitors out of existing copies (see [gotchas.md](gotchas.md)). |
| `DEMO_USER_PASSWORD` | Must equal the value set in Vercel (Project → Settings → Environment Variables). |

The Vercel environment variables themselves stay in Vercel; you only need dashboard access to read or change them ([deploy.md](deploy.md), step 4).

## 4. Start the local database

```bash
pnpm db:start              # Docker must be running; prints the URL and keys for .env.local
pnpm db:reset              # builds the database from supabase/migrations
pnpm seed                  # four demo accounts and the small synthetic club
pnpm dev                   # http://localhost:3000
```

Supabase Studio (a database browser) runs at http://127.0.0.1:54323 while the stack is up.

## 5. Check that everything works

Run these in order; each should pass on a clean clone.

```bash
pnpm lint && pnpm typecheck
pnpm test                  # unit and RLS (RLS needs the local stack running)
pnpm e2e                   # Playwright, own dev server on port 3100 with the offline fake model
pnpm build                 # what Vercel runs
```

If `pnpm test` reports RLS tests as skipped, `.env.local` is missing or the local stack is not running.

## 6. Hosted project and deploys (only for migrations and deploys)

```bash
pnpm exec supabase login                                   # opens a browser
pnpm exec supabase link --project-ref gmlsskizjxhtoxnwhywj  # asks for the database password
```

The database password is in the Supabase dashboard (Project Settings → Database; reset it there if lost). After linking, `pnpm db:push` applies new migrations to the hosted database. Vercel deploys are manual, from the Vercel dashboard. The full checklist is in [deploy.md](deploy.md#after-every-phase).

## 7. Switching between machines

The user pushes and merges; Claude Code never does. Before leaving one machine:

1. Commit everything on the phase branch and push it (`git push -u origin build/phase-N`).
2. Note anything unfinished at the top of [status.md](status.md) and commit that too.

On the other machine:

```bash
git fetch && git switch build/phase-N && git pull
pnpm install                         # if pnpm-lock.yaml changed
pnpm db:reset && pnpm seed           # if supabase/migrations changed
pnpm db:types                        # if a migration changed tables or functions
```

Then start Claude Code with: *"Read docs/status.md and continue phase N."*

## 8. Network notes

- **"unable to get local issuer certificate" when calling the Anthropic API.** The network re-signs HTTPS with its own certificate, which the operating system trusts but Node's built-in list does not. `pnpm dev`, `eval:*` and `demo:freeze` already pass `--use-system-ca`; add it to any new Node script that calls an external HTTPS service. **Never** set `NODE_TLS_REJECT_UNAUTHORIZED=0`. On an ordinary home network the flag is harmless.
- **Claude Code on the web or in another cloud sandbox** can read and edit the repository, but has no Docker and none of the secrets. Unit tests, lint, typecheck and build work there; RLS tests, e2e and paid model runs do not.
