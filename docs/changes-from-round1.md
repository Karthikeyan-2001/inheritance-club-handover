# Changes from Round 1

This file records where the Round 2 build differs from what was proposed in Round 1, and why.

> **TODO (developer):** add a short summary of the Round 1 submission here, so each change below has a baseline.

## Retrieval and matching

- **Embeddings dropped for Round 2.** Matching mentions across sources uses an alias table, candidate pairs within a date window that share an entity, `pg_trgm` similarity ranking, and a model verdict (same / different / unsure, where unsure is treated as different and surfaced as a possible match). This avoids an embedding provider and vector storage on free tiers, and keeps each match decision explainable.

## Processing model

- **Client-driven job runner.** Vercel Hobby limits how long a serverless function can run, and Supabase Free has no background workers. Long imports are therefore split into small steps stored in a `jobs` table. The browser polls `POST /api/jobs/run-next` and shows progress until all steps are done.

## Access for judges

- **Demo accounts.** Four pre-seeded synthetic accounts (outgoing lead Arun, advisor Dr. Meena, incoming lead Kavya, treasurer Divya) with one-click login and a role switcher. Their credentials are shown on the login page because the data is synthetic. Row-level security still applies to every account, so switching roles shows what each role can really read.

## Schema additions (for leak-safe permissions)

Row-level security filters whole rows, not values inside JSON, so a few additions keep restricted text from leaking:

- **`version_items`** holds one immutable row per obligation per approved version, with its own access level. `versions.snapshot`/`diff` contain only ids and hashes, and each role's diff is built from the items it can read.
- **`releases`** records explicit releases: the outgoing lead releasing a private item, or the advisor releasing an item to the incoming lead. Each release is written through a database function that also writes the audit log.
- **`audit_log.access_level` / `private_uploaders`**: audit rows carry the access level of the row they describe, because they store before/after copies of it.
- **`obligations.private_uploaders`**: who uploaded the private sources behind an obligation, so the outgoing lead can see private items derived only from their own files.

## Permission model details (Phase 1)

- **Automatic level inheritance.** A database trigger raises an obligation to the most restrictive level among the messages it cites, and records who uploaded any private sources behind it. Import code can't accidentally publish a private item at a lower level.
- **Releases share the item, not the conversation.** Releasing a private obligation shows its description and verified quotes to the receiving role, but the full private message stays hidden.
- **Audit visibility follows the item.** Audit rows store the access level of the item they describe. An audit row about an obligation is readable only while the reader can read that obligation. This stops private text from leaking through before/after copies.
- **Workspace deletion.** `delete_workspace()` is the only way to remove immutable rows (versions, acknowledgements, audit log). It deletes the whole workspace at once.
- **Acknowledgements are append-only.** Changing a decision adds a new row, and the latest row per item and user is the current answer (`latest_acks` view).

## Parsers and time (Phase 2)

- **One time zone, IST.** Chat exports have no time zone and clubs are in India, so every timestamp is stored as an IST (`+05:30`) ISO string. Trello's UTC times are converted. This keeps ordering consistent across WhatsApp, Trello and minutes, which matters for fulfilment ("later events") and for the Trello-done-versus-chat contradiction check.
- **Dropped items are counted, not hidden.** System lines, deleted messages and attachments without text do not become events, but the import summary reports how many were dropped and why.
- **Minutes become one event per dated heading.** Quotes are verified against the whole section, with markdown decoration stripped so a quote matches what a reader sees. Word files are read through their heading styles.
- **Trello contributes history, not only cards.** Comments, list moves and completion changes become events, so a card that was moved to Done can later be compared with what people said afterwards.

## Import flow (Phase 3)

- **Files are not stored.** An upload is parsed on the server and only its messages, a counts-only summary and its SHA-256 fingerprint are kept. This avoids a second copy of sensitive chats to protect and delete. It also sets a practical limit of about 3.9 MB per import, from Vercel's request size cap. Supabase Storage can be added later if real exports turn out larger.
- **Imports are atomic and checked by RLS.** `import_source()` runs as the uploader, so the same row-level policies that govern reading also govern writing. A failed import leaves nothing behind.
- **Sensible defaults for access.** One-to-one chats (two people) default to private, as the brief requires. Files whose names mention money default to finance. The uploader can change either before importing.
- **The shared demo club is protected.** Visitors cannot delete it; only the seed script can reset it. Per-visitor workspaces arrive with "Load demo club".

## Language model use (Phase 4)

- **Structured outputs instead of forced tool use.** The brief asked for tool use as the structured-output mechanism. Current Claude Sonnet and Opus models reject forced tool calls, so the adapter uses the documented replacement, `output_config.format` with a JSON schema generated from Zod. The guarantee is the same: output must match the schema, and it is validated again with Zod.
- **The quote check runs twice.** It runs once in TypeScript and once inside the database function that stores a commitment. A bug in the application cannot store an unverified claim.
- **Extraction runs as the person who started it.** Every read and write goes through their session and RLS, so the model never receives a message that person cannot read. Job records hold message ids only, never text.
- **A deterministic hedge filter backs up the prompt.** Quotes containing "maybe", "might", "will see", "not sure" and similar are dropped by code even if the model returns them.
- **A daily budget and a response cache.** Repeated runs over the same messages reuse saved answers. A per-day limit on uncached calls protects the hosted demo from runaway cost.

## Fulfilment, recurring duties and context (Phase 5)

- **One run, in stages.** A single "Build the ledger" run finds commitments, then recurring duties, then checks every item for follow-up and context. Jobs are claimed stage by stage (`claim_next_run_job()`), so follow-up checks are planned only once the items exist. Each serverless step is still one small job.
- **Status is computed, not asked for.** The model only points at quotes and says whether each one reports the item done, implies it, or says it is not done. A fixed rule turns verified quotes into a status, and the same rule runs in SQL. A fifth status was added, **Likely done (inferred)**, for evidence that only implies completion, so an inference is never shown as fact. A checked item with nothing verifiable is **No evidence kept**; an unchecked one says "Not yet checked".
- **Fulfilment must come after the promise.** Follow-up evidence dated before the promise, or the promise message itself, is refused by code and again by the database.
- **Code chooses what the model reads.** Related messages for a follow-up check are picked deterministically (rare shared words, same Trello card), not by the model.
- **Prompts never mix access levels.** This was found while building recurring duties: a description written from a committee message and a finance message together could carry finance facts into a committee-level row. Commitment chunks and duty batches now hold one access level each, and one uploader for private files. The database refuses a duty whose quotes span levels. A duty already known from a less restricted record is not stored again at a more restricted one. (Finance readers may still see a near-duplicate when the wording differs; Phase 6 matching handles that.)
- **Follow-up evidence raises visibility (kept by choice).** By the existing provenance rule, an item inherits the most restrictive message it cites. If finance minutes say a committee-level promise was paid, the item becomes finance-level, because its status now comes from a finance record.
- **Context notes carry their own level.** `context_items` now cite a message and a verified quote and inherit that message's level (and uploader, for private files). A note may not name a person or number missing from its own message, and must be about its item.
- **Dates are derived by code and labelled.** Next-due and start-by dates come from a stated month, or one period after the last recorded instance (marked "Estimated"). Otherwise the ledger says the date is not derivable.
- **Standing rules are duties, not commitments.** The extraction prompt now leaves general rules ("a permission letter is needed before every booking") to the duty finder, while a person's promise to do it this time is still a commitment.

## Matching, trust and the docket (Phase 6)

- **Trust is computed by the database, every time.** The trust rule runs inside the obligation trigger, so it follows every change to an item's evidence or links, including evidence that disappears when a file is removed (the item becomes a **gap**). No client, reviewer or model can set it. A checked commitment's status is recomputed the same way, so status and trust always agree.
- **"Corroborated" means independent.** Two messages corroborate an item only if they come from different files or from different named people. One person promising and then reporting it done in the same chat stays **sourced**. An unknown author never counts as a second person, and an inferred quote never corroborates.
- **Linked, never merged.** Items recorded twice (a chat promise and its Trello card; a duty in the chat and again in the minutes) are linked as the same item, or as a possible match when the model is unsure. Each record keeps its own access level and quotes.
- **Evidence flows only downwards.** An item may use the evidence of a linked item only if everyone who can read it can also read the other: a less restricted level, or the same level (and, for private items, files from the same uploaders). A finance record can make the finance copy contradicted, but never changes what the committee copy tells the incoming lead.
- **Code picks the pairs; the model only gives a verdict.** Pairs are scored on wording (trigram similarity as `pg_trgm` computes it, and shared words), the people they are owed to or approved by (through the alias table), and a 60-day window for commitments. Near-identical pairs with matching people and numbers link by rule. The uncertain middle goes to the model in batches of eight. A match prompt may show two items of different levels side by side (both readable by the reviewer), because the model returns only a verdict and writes nothing that is stored.
- **The docket fills itself.** A contradicted item opens a docket entry with its latest "done" claim and its latest "not done" claim, both quotes, and a summary written by code from the two messages' file type and date. An entry is visible only to someone who can read both messages and the item. It closes by itself when the conflict goes, unless someone has already ruled on it. Rulings arrive with review (Phase 8).
- **Model-written descriptions are checked too.** A commitment's description may not name a person or number missing from its message; if it does, the verified quote is shown instead.

## Ledger UI and evidence pane (Phase 7)

- **Every quote opens its source.** "Open source message" shows the full message with the quote highlighted and up to two messages either side, in IST. The highlight uses the verifier's own normalisation, mapped back onto the original text; if a quote cannot be placed, the message is shown unhighlighted and says so. The page reads through RLS: a quote shared with a role that cannot read the message says so, and a quote the role cannot read at all is "not available to your role".
- **One card per item, with its other records inside.** A promise recorded in the chat and again in Trello or the minutes is one card; each other record is nested under "Also in Trello" with its own access level, trust label and quotes. Grouping uses direct links only (links are not transitive), and possible matches are a quiet note that is never merged or used as evidence.
- **Conflicts link both ways.** A contradicted item links to its Docket entry, and the entry links back to the item.
- **The Gaps tab is live.** It lists items with no kept evidence, promises with no follow-up, promises not yet checked, and duties with no derivable next date, each with what would close the gap. Only items the role may read count, so a gap is a gap in what that role can see.
- **One trust legend** replaces the repeated sentence on each card. Contradicted cards keep their own one-line explanation.
- **Messages keep their file order.** Events now carry `seq`, their position in the file, so the evidence pane shows the messages around a quote in the order they were written, even when many share one minute (WhatsApp) or one date (minutes).
- **Folded records keep their facts.** A record folded into another card still shows who owes whom and when (or how often and the next date), with any disagreement with the card marked. Links that cannot be folded are listed, so none is hidden.
- No AI use changed in this phase.

## Review, sign-off and versions (Phase 8)

- **Two-step sign-off.** The outgoing lead checks each item against its quotes (accept, edit, reject, move back to draft) and marks the accepted draft "ready for the advisor". Only the faculty advisor can approve, and only while that mark still matches the pending items: any later change to an accepted item or a note means it must be marked ready again. The advisor's own rulings do not invalidate the mark.
- **Every change needs a reason.** A signed-in user can no longer update an item directly. Changes go through `review_obligation()`, which needs a reason, limits edits to a fixed list of fields per kind (status, trust and access level are never editable), and writes an audit row named for the action (`accept`, `edit`, `reject`, `reopen`).
- **Items remember what they were accepted with.** If a later run changes the status or trust of an accepted item, it is flagged "Changed since accepted: was X, now Y". Marking ready and approving are both refused until each flagged item is accepted again or rejected.
- **Rulings are recorded, not rewritten.** The advisor rules on a conflict (done, not done, cannot tell) with a reason. The ruling is shown as the advisor's decision and travels in the version, but the item stays contradicted, because the records still disagree. Status still comes from evidence alone.
- **"Not the same" is remembered.** A reviewer's verdict on a pair (`same` or `distinct`, method `reviewer`) stands: matching skips that pair and never asks the model about it again, and a `distinct` pair never lends evidence.
- **Versions hold more.** Format 2 items also carry the `inferred` flag on evidence, the same-item links the item may borrow from, and the conflicts with their rulings. Context notes sit in their own immutable table (`version_context_items`) so each keeps its own access level: a finance note never rides inside a committee item. Hashes of earlier versions are never rewritten; the next diff compares an older item on the fields it recorded.
- **The working ledger is not for the incoming lead.** Until a version is approved, only the outgoing lead, the advisor and the treasurer read obligations (and so evidence, notes, links and conflicts). The incoming lead and members read approved versions only, filtered by the same access rules, so a release still reaches the incoming lead through a version. Messages and files (the timeline) are unchanged.
- **Version diffs are built from rows the role can read.** The diff shown to each role is computed from that role's readable items, not from a stored diff, so it cannot show a restricted item or field.
- No AI use changed in this phase.

## Handover (Phase 9)

- **`/handover` reads the latest approved version only**, as the viewer's role may read it (`version_items` through row-level security). It is the incoming lead's page: "People waiting on you" (open commitments grouped by who they are owed to, soonest first, with a last group for items that name no one), a calendar of recurring duties by next due date with "Overdue" and "Start now" markers, and sealed placeholders. Items with no evidence say "No evidence kept". Reviewers see the same page with the incoming lead's answers.
- **Sealed placeholders** come from `sealed_items` (holder and a short topic, no source text). The outgoing lead or advisor can add one for a finance or private item that has not been released; the topic is shown to every member, so the form says to leave details out.
- **Acknowledgements** (accept, ask a question, decline) are immutable rows; the latest per item wins. Only the incoming lead can answer, and only an item they can read. A question or a decline needs a note. Each answer now writes an audit row (migration 0016) with the item's access level, so the audit is filtered like the item.
- No AI use changed in this phase; no paid model calls were made.
