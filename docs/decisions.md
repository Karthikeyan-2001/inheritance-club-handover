# Design decisions (Phases 5 to 15)

Why the system works the way it does. Most were confirmed with the user at the end of each phase. Round 3 decisions are in [status.md](status.md) under the Round 3 plan, and move here when each phase ends.

## Phase 5 decisions

- "Likely done" is a fifth status, `likely_fulfilled`, from evidence marked `inferred`.
- One staged run ("Build the ledger"), not separate buttons.
- Follow-up evidence from a more restricted record raises the item (the provenance rule is kept).
- The fast tier (Haiku 5.5, low effort) for every task. The eval showed no need for Sonnet, so refusal fallbacks are still off (Haiku has no server-side fallback anyway).
- Found while building: prompts must never mix access levels, or model-written text (descriptions, notes) can carry restricted facts into a more open row. Chunks and batches are now split by `visibilityKey`.

## Phase 6 decisions

- **Corroborated means independent:** at least two verified messages that agree, from different files or from different named people. One person's word stays sourced (C3 in the mini ground truth was changed to `sourced`). Unknown authors and inferred quotes never corroborate.
- Trust and the status of checked commitments are computed in the database trigger, over effective evidence. No `settle_trust` stage was needed.
- Evidence is borrowed only from linked items at the same or a less restricted level (private: same uploaders).
- One docket entry per contradicted item; the Docket tab shows a shared conflict once.
- Two paid runs were approved and made: `eval:pipeline` (about $0.0045) and the matching probe (about $0.0003).

## Phase 7 decisions

- The evidence pane is a page (`/ledger/evidence/[id]`), not a dialog, so it has a URL, works without JavaScript and is easy to test under RLS.
- Linked records fold into the earliest item's card by direct `same` links only.
- The header's step indicator is now inside `<Suspense>`: dynamic routes failed prerender checks without it.
- Folded records show their own facts (owed by, to, due; or cadence, approval, next due), marked "Differs from the card" where they disagree with the card's own record.
- `same` links that grouping cannot fold (A–B, B–C) are listed on both cards as "Also linked as the same item, on its own card".
- A gap is still reported per record when a linked twin has evidence: the trust rule already borrows wherever it may, so a remaining gap is real at that record's level.
- An item with several conflicts links to each, open ones first.
- The Gaps empty state ("No gaps among the N items you can read") is covered by unit tests of `findGaps`, not Playwright, because the e2e workspace always has gaps.

## Phase 8 decisions

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

## Phase 11 decisions

Confirmed with the user: add `yaml`; deterministic renderer first.

- **Authored, not drawn.** `world.yaml` holds the planted messages, card histories and meetings word for word. Only filler chat is templated (seeded, so the same bytes every time). Filler templates are tested to contain no promise words, so every commitment-like line in the data is planted and listed.
- **Truth is separate and written by hand.** `ground_truth.yaml` has the same shape as the mini `ground-truth.json` plus `restricted` amounts and `appears` months for duties. `checkTruth` proves every quote is in its file. `expectedTrust` is null where several sources restate a promise, because the answer depends on how the extractor folds them; Phase 12 should not score those.
- **The committed outputs are checked in** and a test fails if they drift from the world (`pnpm gen:scenario`).
- Year scenario: 18 commitments (4 no evidence, 2 contradicted), 4 duties with approvals, 6 decoys, 2 contradictions, 4 files at 4 levels. About 1,300 committee messages, 690 volunteer messages, 19 cards, 6 meetings. Smaller than `data/samples/` by design, and with the planted facts in the same story; those samples stay as parser format fixtures.
- **Not built:** the optional LLM renderer. It would need a new adapter task and a paid run with an estimate. Add it only if the template filler looks too repetitive.
- **Not done:** loading the year club into demo copies through `insertClub`. It needs a loader from parsed files to fixture rows plus a pipeline run (paid with a real model), so it fits with Phase 12.
- No paid model calls were made in this phase, and the pipeline was not run on the new files.

## Phase 12 decisions

Confirmed with the user: run both paid evals; leave the year club in demo copies for Phase 13.

- **Scoring in code, truth by hand.** The scorer is pure and reused by the eval script and the tests. A promise written twice in one place (the minutes' finance line and its action line) is listed as an `alternate`, not matched loosely.
- **The second club differs on purpose:** different cast, iPhone committee chat, a finance chat, a private chat uploaded by the outgoing lead (the year club's private chat is the advisor's), Word minutes with dates in words, no Trello, monthly and per-event duties.
- **Leak tests at three layers**, each proving it is not vacuous. Who may read a restricted text is computed from the files that contain it (`canRead` over level and uploader), not hand-listed, in the RLS test.
- **The offline fake's floors are recorded, not claimed.** `FLOORS` in `eval.test.ts` say what the rule-based stand-in finds, so a regression in shared code shows up; the paid eval is the quality claim.
- **The cost estimate walks the real prompts** with the offline fake first, and is calibrated on the paid runs (input 1.3 × text + 1,500 a call for the schema; 800 output a call). It still errs high.
- **Fixed because the new tests found them:** the outgoing lead's private items (migration 0018), one chunk per chat-day, the hedge without its "Maybe", "Mr." ending sentences, and the rule linking two semesters' identical promises.
- **C18 in the year truth was wrong** (no_evidence); records say not done, so the status rule gives Open. Corrected with the two quotes.

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

## Phase 14 decisions (UI/UX, no walkthrough)

- **The tour and `/guide` are gone** (Round 3 judges use the app alone). Guidance now lives in the pages: a one-line purpose under every title, a home page that names the next step, and a step bar that is always visible. `switch-user.ts` stays (the role menu uses it).
- **Next step is worked out by code from the viewer's own reads** (`src/lib/journey.ts`). A role that cannot read the working ledger gets zero counts there and is guided by approved versions. Approval is detected by "the lead's mark is newer than the latest version", because the mark stays current after approval.
- **When the next step is someone else's, the button switches person.** A handover needs three people, and a lone judge would otherwise not know that. The same `signInAsDemo` action as the menu is used.
- **Purple pastel palette** (OKLCH tokens in `globals.css`; primary hue 296). Text on every surface is at least 4.5:1. No dark mode: it was unused, and a half-themed dark mode is worse than none.
- **Plain-language labels:** Commitments is "Promises", Recurring is "Yearly duties", Docket is "Conflicts", Timeline is "All messages"; in Review, Draft is "Check and sign off", Conflicts is "Rulings", Versions is "Approved versions", History is "Audit history". URLs and test ids are unchanged. The Verify step is "Check the records".
- **Waiting is explained, not just shown:** skeletons shaped like the content, a status line that adds a reassurance after 3.5 s and 9 s, a route bar after 150 ms, a progress bar with stripes while a demo club is built (a curve to 90%, labelled as usually under half a minute, because the real time is not known), and a full-screen "Switching to Dr. Meena…" while a person switch signs in.
- **Confirmation only where it cannot be undone:** removing a file and deleting a workspace. Reject, decline and edits are reversible and audited, so they have no extra dialog.
- **No new dependency.** `radix-ui` (already used) supplies the AlertDialog. No paid model calls.
- **One page per step (follow-up after the user tried it).** Tabs on `/ledger` used to light different steps (Conflicts and Gaps lit "Check the records"), so clicking a tab looked like moving through the workflow, and "Review the items" after a build skipped the check step. Conflicts and Gaps now live on `/check`, the message list on `/messages` (no step, chosen by the user), and the step bar follows the path only. Each step page ends with a next-step bar to the next page, in order. Old URLs redirect in `next.config.ts`.
- **The build button responds before the server does.** Planning a run reads every readable message first (seconds on the year club); the panel now shows "Getting ready" at once instead of a silently disabled button.
- **Samples in one click, downloads kept.** The user asked for both: "Use the 4 sample files" fills the list at the right levels; the authorisation box is still ticked by hand, so the real import path runs.
- **The home page sends a freshly built ledger to Check the records first** (when there are conflicts or gaps), then to review once reviewing has started.
- **Known gaps:** the build-progress bar is an estimate; the person switch signs in again (a few seconds). There is no dark mode.

### Review page: no frozen buttons or tabs (14 Nov, after Phase 14)
- **Sign-off moved to the end.** The page is three numbered steps (check items, see what changes, sign off) with a status strip on top. Sign-off used to sit above the items, before there was anything to sign.
- **Filter in the browser, not the URL.** To check / Accepted / Rejected / All hide lists that are already rendered, so switching is instant. It opens on "To check" if anything is a draft, else "All". The group test ids (`group-draft` and so on) are unchanged; a hidden group cannot be clicked, so a test that needs an accepted item picks the Accepted filter first.
- **Confirmations outlive the card.** Accepting moves a card to another list, which threw away the form's own "Accepted." A `NoticeContext` line (sticky, dismissable) now carries it.
- **A slow save says so.** After 12 s a form shows "taking longer than usual" and a reload button, instead of a spinner with no end.
- **Tab feedback.** The pressed tab shows a spinner (`useLinkStatus`) and `TabSuspense` keys the loading boundary by tab. A pressed tab still waits for a save that is in flight; that is the Next router's queue, not something the app controls.


## Phase 15 decisions (gap questions, Round 3 improvement 2)

Chosen while building; change any you disagree with.

- **An answer is a record, not an edit of the item.** `public.answer_gap()` writes the answer as a message from the outgoing lead in a `statement` source ("Stated by the outgoing lead"), then cites it as verified evidence (done → `fulfils`, not done → `contradicts`, an approver, "no approval needed" or a date → `supports`). So every existing rule applies unchanged: the quote check (the quote is the whole message, checked with `app.quote_in`), the trust and status rules, provenance, the audit, re-review, the sign-off hash and the version diff. No new trust state.
- **The message is written by code**, from the answer and the item's description ("Not done: set up the demo kits."), followed by the lead's own words. `statementText()` in `src/lib/questions.ts` mirrors the SQL so the form shows the exact message before saving; the RLS test checks the two agree.
- **One statement file per access level per lead**, found or made on the first answer at that level (`Answers to gap questions (Committee)`). An answer can never be less restricted than its item, because the message names the item; a more restricted one raises the item (the Phase 5 provenance rule), and the form says who would stop seeing it.
- **The trust rule is not special-cased for statements.** A promise in the chat plus the lead's "done" in the statement file are two records from different files, so the item becomes corroborated, as it would with a later chat message saying done. Every such quote is labelled "Stated by the outgoing lead" wherever it is shown, so the reader can weigh it. (Worth reconsidering: one could argue a statement should never corroborate on its own.)
- **"I don't know" is a verified note** (context kind `risk`, "Arun does not know whether it was done."), citing its own message. It changes no status or trust, travels with the version, and shows on the handover. The question is "left open" and can be answered once more later.
- **A conflict answer does not settle the conflict.** It is one more record next to the two that disagree; the item stays contradicted and the advisor still rules. Once ruled, the question no longer applies.
- **Only the outgoing lead answers** (`app.has_role(..., 'outgoing_lead')`). The advisor and the treasurer read questions and answers, since they read the working ledger; the incoming lead and members see answers only in approved versions.
- **Answering never accepts an item.** An accepted item whose status or trust moved shows under "Changed since accepted" and needs "Accept again" before the lead can mark ready, as after any new evidence.
- **`gap_answers` has no write policies.** Rows are written only by `app.record_gap_answer()` (called from `answer_gap()`), which also writes one `answer_gap` audit row with the item before and after. Removing the statement file removes its answers and the questions come back.
- **The handover shows each item's notes** from the approved version (`version_context_items`, as RLS allows), so an "I don't know" reaches the incoming lead.
- **The lead's own words are on the face of the card** ("The outgoing lead told us, when asked about a gap in the records", with the quote, who, when, and "Their own word, not a document"), not only inside the collapsed "Quotes". Found when the user, as Kavya, could not find Arun's notes.
- **Fulfilled promises are no longer hidden from the incoming lead.** Before, "People waiting" left them out, yet the version's item count included them: Kavya could not see or answer them, and "Answer N items" could never reach zero. A "done" answer made this visible by making a promise vanish. They now sit under "Already done" (`doneCommitments`), each readable and answerable, and a promise the lead's answer closed carries "Done, per the outgoing lead". The Phase 9 note that fulfilled commitments are "left out of people waiting" still holds for that list.
- **The handover explains conflicts.** A contradicted item used to show only a red badge, with the two sides hidden in "Quotes" and the ruling only on the Approved versions page. Each conflict the version carries (`handoverConflicts`) is now a box on the card: the records disagree, what each says, and the advisor's ruling with its reason, or "Nobody had ruled on it when this version was approved". It shows the ruling as it stood at approval, since versions never change; a later ruling reaches her in the next version.
- **An answer reaches the incoming lead only in the next approved version** (she reads approved versions only). The questions page now says so.
- **Dates:** a date answer must be today or later (IST); the start-by date comes from the duty's stated lead time (`startByFor`), and `next_due_basis` says "Stated by the outgoing lead". An approver answer on a duty with no stated approval sets `approval_required` to "Approval", so the handover can say "needs approval from …".
- **The pipeline never reads statements** (`pipelineReads` in `run-pipeline.ts`), and matching leaves them out, so an answer is never taken for a new promise, and answering never changes a model prompt.
- **Found while building:** the review page's "Accepted." confirmation (Phase 14) was sticky under the sticky header, so it was hidden once the page was scrolled. Both it and the questions page now use a toast fixed to the bottom of the window (`components/feedback/notice-toast.tsx`).
- No paid model calls were made in this phase, and no dependency was added.
