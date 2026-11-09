# Deploying: hosted Supabase + Vercel

Local development uses the Supabase CLI in Docker. The live demo uses a free hosted Supabase project and Vercel Hobby. The same migrations run in both.

## 1. Create the Supabase project

1. In the Supabase dashboard, create a new project (Free plan). Note the **database password** you choose.
2. Under **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up". Only the seeded demo accounts should exist. The local `supabase/config.toml` setting does not apply to hosted projects.
3. Under **Project Settings → API Keys**, copy the project URL, the **publishable** key and the **secret** key.

## 2. Apply the migrations

```bash
pnpm exec supabase login                       # opens a browser for an access token
pnpm exec supabase link --project-ref <ref>    # <ref> is in the project URL
pnpm db:push                                   # runs `supabase db push --remote`; asks for the database password
```

## 3. Seed the demo accounts and synthetic club

Create `.env.hosted.local`. It is git-ignored; never commit it.

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
DEMO_USER_PASSWORD=<same password you will set in Vercel>
```

Then run:

```bash
pnpm seed:hosted
```

The seed refuses non-local targets unless `--remote` is passed; `seed:hosted` passes it. Re-running it resets the demo workspace.

## 4. Configure Vercel

In **Project → Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | hosted project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | hosted publishable key |
| `DEMO_USER_PASSWORD` | same as in `.env.hosted.local` |

From Phase 4, also add these, marked **Sensitive**:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | your Anthropic key (set a monthly spend limit in the Console) |
| `SUPABASE_SECRET_KEY` | hosted secret key; used only on the server, for the LLM response cache |

and, not sensitive: `LLM_MODEL_FAST=claude-haiku-5-5`, `LLM_MODEL_STRONG=claude-sonnet-5-5`, `LLM_MAX_CALLS_PER_DAY=500` (lower it if you want a tighter cap).

Then **redeploy**. The login page is prerendered at build time, so the password shown there comes from the build.

## 5. Check

- `https://<app>/api/health` returns `"db": "ok"`.
- Sign in as Kavya and then Dr. Meena. The "Obligations" count changes from 3 to 6.

## Notes

- Supabase Free pauses a project after about a week without activity. Before judging, open the dashboard and restore it if needed. A daily keep-alive ping is planned for a later phase.
- The demo accounts are shared by every visitor. A later phase will give each "Load demo club" click its own workspace.

## Updating the hosted database after a new phase

When a phase adds a migration (Phase 3 adds `0007_import.sql`, Phase 4 adds `0008_extraction.sql`), apply it and re-seed:

```bash
pnpm db:push        # applies only the new migrations
pnpm seed:hosted    # resets the demo club; Phase 3 also marks it as protected (is_demo)
```

Then redeploy on Vercel if the app code changed.
