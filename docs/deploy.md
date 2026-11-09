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
pnpm db:push                                   # asks for the database password
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

Do **not** add `SUPABASE_SECRET_KEY` to Vercel yet: the app does not use it in Phase 1, and leaving it out keeps the deployment least-privileged.

Then **redeploy**. The login page is prerendered at build time, so the password shown there comes from the build.

## 5. Check

- `https://<app>/api/health` returns `"db": "ok"`.
- Sign in as Kavya and then Dr. Meena. The "Obligations" count changes from 3 to 6.

## Notes

- Supabase Free pauses a project after about a week without activity. Before judging, open the dashboard and restore it if needed. A daily keep-alive ping is planned for a later phase.
- The demo accounts are shared by every visitor. A later phase will give each "Load demo club" click its own workspace.
