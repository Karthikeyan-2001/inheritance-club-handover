# Build status

Read this first when resuming work, on any machine. Last updated: 2026-11-14, Phase 15 (gap questions, Round 3 improvement 2) built on `build/phase-15`, awaiting review and merge. Phase 14 is merged.

Other docs:
- [dev-setup.md](dev-setup.md): setting up a new computer (tools, secrets, local database, hosted project).
- [architecture.md](architecture.md): migrations, `src/lib`, routes and tests.
- [decisions.md](decisions.md): why things are built this way (Phases 5 to 15).
- [gotchas.md](gotchas.md): things that broke once; read before touching the database, pipeline, demo copies or tests.
- [known-gaps.md](known-gaps.md): what is knowingly unfinished, and what the model still gets wrong.
- [deploy.md](deploy.md): hosted Supabase and Vercel, and the after-every-phase checklist.
- [changes-from-round1.md](changes-from-round1.md), [ai-disclosure.md](ai-disclosure.md): kept up to date whenever direction or AI use changes (CLAUDE.md).
- [archive/round2/](archive/round2/): the Round 2 project document. Section 10 holds the three improvements Round 3 is judged on.

## Where things stand

Round 2 (Phases 0 to 13, plus the guided tour) is merged and was submitted; the team qualified for the Round 3 finale. Round 2 built: parsers, Connect, the LLM pipeline with quote verification, matching and the trust rule, the docket, the ledger and evidence pane, two-step review with immutable versions, the handover page with acknowledgements and replies, per-visitor demo copies, the synthetic scenario generator, scoring and leak tests.

| Phase | Scope | State |
|---|---|---|
| 0 to 13 | Round 2 (see the README status table and [decisions.md](decisions.md)) | merged |
| 14 | Round 3: remove both walkthroughs; UI/UX overhaul so the app guides itself | merged (deploy: see outstanding tasks) |
| 15 | Round 3, improvement 2: gap questions for the outgoing lead | built, awaiting merge and deploy |
| 16 | Round 3, improvement 3: counterparty handoff notes | next |
| 17 | Round 3, improvement 1: inferred recurring duties | later |
| 18 | Round 3: hardening, end-to-end sweeps, README, final report PDF | later |

Tests on `build/phase-15`: 644 unit plus RLS (`pnpm test`; Phase 14 had 606), 65 Playwright (new: `gap-questions.spec.ts`), all passing; lint, typecheck and production build clean.

### Phase 15 (built, awaiting merge)

Gap questions, Round 3 improvement 2, delivered to its minimum and beyond: in a year copy, Arun answers "set up the demo kits" on the Questions tab of `/check`, sees "It is now Open, trust Corroborated", accepts it again, marks ready; Dr. Meena approves version 2; Kavya's handover shows the answer labelled "Stated by the outgoing lead (Arun, …)" (covered end to end by `e2e/gap-questions.spec.ts`).

- Questions for four gaps: promise with no follow-up, unruled conflict, duty with no approver, duty with no next date. Answers: done / not done / I don't know; an approver / no approval needed / I don't know; a date / I don't know.
- Each answer is a message from the lead in a "Stated by the outgoing lead" file at a chosen level (never below the item's), cited as verified evidence (or, for "I don't know", a verified note), through `public.answer_gap()` (migrations 0021, 0022). Quote check, trust and status rules, provenance, audit (`answer_gap` row with before and after), re-review, sign-off and version diff all apply unchanged. No model calls.
- The form previews the exact message and warns when a more restricted level would hide the item from someone. Only the outgoing lead answers; the advisor sees the lead's answer beside each conflict.
- Stated quotes are labelled on the ledger, the approved version, its diff and the handover. On the handover the lead's own words are on the card face, and promises already done are listed under "Already done" (they used to be counted but hidden, so the incoming lead could not answer them); the handover also shows each item's notes.
- The home page sends the outgoing lead to open questions before review; the check page's next-step bar does too.
- Also fixed: the review page's "Accepted." confirmation was hidden under the sticky header when scrolled; it is now a bottom toast (shared with the questions page).
- Decisions and open points: [decisions.md](decisions.md#phase-15-decisions-gap-questions-round-3-improvement-2) (please check the one on trust: a promise plus the lead's own "done" counts as corroborated, by the unchanged Phase 6 rule), [known-gaps.md](known-gaps.md#known-gaps-phase-15).

### Phase 14 (merged)

Tour and `/guide` removed; one page per step (new `/check` and `/messages`; old ledger tab URLs redirect); next-step bar on every step page; instant build feedback with time left; one-click sample files; purple pastel theme; home page with the next step per role (`src/lib/journey.ts`); one-line purpose on every page; plain-language labels; person switcher shows "Switch person" with who-is-who; skeleton, route-bar and progress-bar loading states; confirm dialogs for removing a file and deleting a club; empty and error states on every list; mobile and accessibility pass. Details: [decisions.md](decisions.md#phase-14-decisions-uiux-no-walkthrough), [changes-from-round1.md](changes-from-round1.md).

Not done in Phase 14, by choice: a dark mode, and a Lighthouse or axe run (the pass was manual: focus rings, contrast by palette, labels, skip link, reduced motion). Worth checking on the live link after deploy: sign in on a phone-sized window and complete the flow as Arun, Dr. Meena and Kavya.

## How the user works

- One branch per phase (`build/phase-N`), small commits, one concern per commit. The user merges through GitHub pull requests; never push or merge.
- Stop at the end of each phase with a summary, and update this file. Wait for "start phase N".
- Ask before adding a dependency not named in CLAUDE.md.
- Ask before any paid model call. Show a cost estimate first.
- Prove a new test can fail (a deliberate one-off mutation, then restore).
- The user chooses the Claude Code model per phase. Round 3 suggestion: Sonnet 5.5 for 14 and 18 (UI, docs); Opus 5.5 for 15 to 17 (RLS, signed links, trust rule). Run `/code-review` on Opus before merging a Sonnet-built phase.

## Outstanding user tasks

1. Review and merge `build/phase-15`, then deploy (checklist in [deploy.md](deploy.md#after-every-phase)). **This phase adds migrations 0021 and 0022: run `pnpm db:push` before redeploying**, or `/check` fails on the hosted app (the new code reads `gap_answers`). No seed or prompt change, so no `seed:hosted` or `cache:warm`. If Phase 14 was not deployed yet, this deploy covers both.
2. Before the first Round 3 deploy, confirm the hosted database is current: `/api/health` should report the latest `main` commit, and `pnpm db:push` should report migrations 0018 to 0020 as already applied. If `pnpm cache:warm` was never run against the hosted database, run it (building from the sample files then costs nothing).
3. The Round 1 user interviews were not done. The docs say so. Do not add interview answers unless real people gave them.

## Environment facts

- **Live app:** `https://inheritance-club-handover.vercel.app`. Hosted Supabase project ref: `gmlsskizjxhtoxnwhywj` (link it on a new machine; see [dev-setup.md](dev-setup.md)). Vercel deploys are manual.
- **Local stack:** `pnpm db:start` (Docker must be running), then `pnpm db:reset && pnpm seed`. `.env.local` holds local Supabase keys, `DEMO_USER_PASSWORD`, `ANTHROPIC_API_KEY` and the model names; `.env.hosted.local` holds hosted values for `pnpm seed:hosted` and `pnpm cache:warm`. Never print or commit either file's values.
- **npm registry:** the project `.npmrc` pins public npm. On the user's work Mac the global `~/.npmrc` points at an expired company mirror; never touch it. For corepack and `pnpm dlx`, prefix commands with `COREPACK_NPM_REGISTRY=https://registry.npmjs.org` (and `npm_config_registry` if needed), for that shell only.
- **TLS:** the user's work network re-signs HTTPS. Node needs `--use-system-ca`, which is already in `pnpm dev`, `eval:*` and `demo:freeze`. Never disable certificate checks.
- **Supabase CLI 3.0** (a dev dependency): `supabase db push` targets **local** by default; `pnpm db:push` adds `--remote`. Regenerate types with `pnpm db:types`.
- **New-style keys:** `sb_publishable_…` and `sb_secret_…` work with supabase-js. The local gateway translates a key only if it matches exactly.

## Round 3 plan (Phases 14 to 18)

Round 3 (the finale) opened 13 Nov 2026, 11:59 pm and **closes 16 Nov 2026, 11:59 pm, with no late window**. Aim to submit by about 8 pm on 16 Nov. Judges open the live link and use it alone, with no walkthrough. Marks: completeness 25, the three improvements 20, reliability 20, usability 20, documentation and roadmap 15. Everything must be built inside the event window. **No video** (the brief rules it out). Submission: live link, repository, product PDF, feature list, architecture and implementation summary, improvements after Round 2 (the three named), testing details, roadmap.

Decisions confirmed with the user (14 Nov):
- **Remove both walkthroughs:** the docked guided tour and the `/guide` page. The app itself must guide a first-time visitor.
- **UI/UX first**, then the three improvements, then hardening and docs.
- **Merge and deploy every phase.** Apply any new migrations (`pnpm db:push`) and redeploy on Vercel after each merge, then check `/api/health` shows the new commit. Hosted-only problems (the 60-second limit, migrations) then show up in the phase that caused them.

The three improvements were committed in the Round 2 report (section 10) and Round 3 is judged on exactly these. Each phase has a minimum that counts as delivered. If a phase overruns, cut scope down to that minimum rather than skip it. If something is genuinely impossible, the PDF must say so and why.

| Phase | Target | Scope | Minimum that counts as delivered |
|---|---|---|---|
| 14 UI/UX | 14 Nov | Remove the tour (`src/components/tour/`, `src/lib/tour/`, `src/app/actions/tour.ts`, `e2e/tour.spec.ts`, the tour cookie in `demo-club.ts`, the highlight CSS) and `/guide` (the header link, the sign-in link, the checks in `e2e/auth.spec.ts`). Keep `src/lib/demo/switch-user.ts` (the role menu uses it). Start with screenshots of every page as each person. Then: a home page showing each person their next step, with one primary button and handover progress worked out from the data; a one-line "what this page is for" on each page; an easier-to-find person switcher; empty, error and loading states on every list; buttons that cannot be pressed twice; confirmation before destructive actions; plain-language labels; a mobile layout check; an accessibility pass. | A first-time visitor gets from sign-in to the handover with no guide. |
| 15 Gap questions (improvement 2) | 15 Nov, morning | One page of questions for the outgoing lead: no follow-up, missing approver or date, unruled conflict. Each answer becomes a message in a "Stated by the outgoing lead" source at a chosen access level, so the existing quote check, trust rule, audit log and version diff all apply. No new model calls. | Answer a gap, see its trust change, approve, and the incoming lead sees it in the next version. |
| 16 Counterparty notes (improvement 3) | 15 Nov, afternoon | One note per counterparty, from a template plus fields, built from approved items only (no model text). The outgoing lead edits and approves it. The counterparty opens a public `/n/[token]` page signed with a key. It is served on the server and reads the note row only. It has an acknowledge button, and the acknowledgement shows on the handover. Audit rows and leak tests included. | One note goes from draft to approved, is opened and acknowledged, and the acknowledgement shows on the handover. |
| 17 Inferred duties (improvement 1) | 16 Nov, morning | Code (not a model) finds repeated items: the same task at about the same point in two or more past cycles. The year club gets a second past cycle containing 3 to 4 unstated duties, plus their ground truth. The trust rule labels them "inferred" and lists the occurrences. The start-by date comes from past lead times and shows on the calendar. A small paid eval, with a cost estimate shown before it runs. | Duties are detected in the built club, labelled Inferred with their occurrences, and placed on the calendar. |
| 18 Hardening and docs | 16 Nov, afternoon | Sweeps for bad input, refresh, the same action twice, and empty and error states; end-to-end tests of each journey. A README that someone else can clone and run from. The Round 3 PDF (feature list, architecture, improvements, testing, roadmap), rendered with `scripts/render-report.ts`. Update `docs/changes-from-round1.md` and `docs/ai-disclosure.md`. Final deploy and a check in a private window. | Every item on the submission list is ready. |
