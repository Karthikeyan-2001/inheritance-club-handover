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
| `SUPABASE_SECRET_KEY` | hosted secret key; used only on the server, for the LLM response cache and (from Phase 10) visitors' demo copies |
| `CRON_SECRET` | from Phase 10: a random string of at least 16 letters and digits (for example `openssl rand -hex 24`); Vercel sends it to the daily cron route |

and, not sensitive: `LLM_MODEL_FAST=claude-haiku-5-5`, `LLM_MODEL_STRONG=claude-sonnet-5-5`, `LLM_MAX_CALLS_PER_DAY=500` (lower it if you want a tighter cap).

Then **redeploy**. The login page is prerendered at build time, so the password shown there comes from the build.

## 5. Check

- `https://<app>/api/health` returns `"db": "ok"`.
- Sign in as Kavya and then Dr. Meena. The "Obligations" count changes from 3 to 6.
- From Phase 10: on the sign-in page, **Load demo club**. You land as Arun in "Demo Club (SYNTHETIC, your copy)", with a "Your demo club" badge in the header. Switch to Kavya from the menu and open Handover.
- From Phase 10: in Vercel, **Project → Settings → Cron Jobs** (or **Schedules → Cron Jobs**) lists `/api/cron/daily`. **Run** it once and check its log shows `200` with `"db":"ok"`. A `401` means `CRON_SECRET` is missing from the Production environment or the deployment predates it; redeploy.

## Notes

- **Keep-alive.** Supabase Free pauses a project after about a week without activity. The daily cron (`vercel.json`, 21:30 UTC, which is 03:00 IST; Hobby runs it at some point in that hour) queries the database, so the project stays awake while the deployment is live. If the project was paused before the cron existed, restore it once from the Supabase dashboard.
- **Demo copies.** "Load demo club" creates four auth users and a workspace per visitor, using the secret key on the server. Copies are deleted after 7 days by the cron (up to 25 per run; any left over go the next day, or on the next "Load demo club"). At most 300 can be active and 60 started per hour. Creating users this way works with "Allow new users to sign up" turned off, because it uses the admin API.
- **Sign-in rate limit.** Every sign-in, role switch and new copy signs in from Vercel's servers, so many visitors share a few IP addresses. Supabase's default is 30 sign-ins per 5 minutes per IP. If visitors see "Sign-in failed" during judging, raise **Authentication → Rate Limits → Sign-ups and sign-ins** in the Supabase dashboard.
- **The shared demo accounts** are still on the sign-in page, below the "Load demo club" card, and are shared by everyone. `pnpm seed:hosted` resets their club; it does not touch visitors' copies.

## Updating the hosted database after a new phase

When a phase adds a migration (Phase 3 adds `0007_import.sql`, Phase 4 adds `0008_extraction.sql`, Phase 10 adds `0017_demo_sandboxes.sql`), apply it and re-seed:

```bash
pnpm db:push        # applies only the new migrations
pnpm seed:hosted    # resets the demo club; Phase 3 also marks it as protected (is_demo)
```

Then redeploy on Vercel if the app code changed.
