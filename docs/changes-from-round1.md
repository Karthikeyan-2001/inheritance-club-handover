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
