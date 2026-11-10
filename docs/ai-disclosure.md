# AI disclosure

Inheritance uses AI in three separate ways. Each is listed here so judges and users can see exactly where a model is involved.

## 1. Writing the code: Claude Code

The solo developer used Claude Code (Anthropic) as a pair programmer to write and refactor code, tests, migrations and docs. Every change was reviewed and committed by the developer. Design decisions (schema, trust rules, permission model) are the developer's, recorded in `CLAUDE.md` and in these docs.

The guided demo tour's text (`src/lib/tour/tour.ts`) was written by Claude Code from these docs and checked against the built demo club. It is fixed text; no model is called to show the tour.

## 2. Inside the product: Claude API

The import pipeline sends source text to the Anthropic Claude API to:

- propose commitments and recurring duties;
- judge whether a commitment was fulfilled;
- decide whether two mentions refer to the same thing.

Safeguards that do **not** rely on the model:

- All model calls go through one adapter (`src/lib/llm/adapter.ts`). Output is structured and validated with Zod, and responses are cached by prompt hash.
- Every extracted claim must carry a verbatim quote and an event id. Deterministic code checks that the quote appears in that event's text. Claims that fail are dropped and counted.
- Trust states (corroborated / sourced / inferred / contradicted / gap) are set by a pure rule function, not by the model.
- A model never sees rows the requesting role cannot read. Permissions are enforced by Postgres row-level security before anything is sent.
- The import screen names the LLM provider and requires the uploader to confirm they are authorised to use the data.

*Status (Phase 6): commitments, recurring duties, follow-up, context and matching are live. Trust is set by the rule in `src/lib/pipeline/trust.ts` and `app.trust_rule()`.*

- **What is sent:** the text, author and IST time of messages the signed-in reviewer may read, to the model named in `LLM_MODEL_FAST` (Claude Haiku 5.5 by default) via the Anthropic API. Commitment chunks and duty batches each hold messages of one access level only. A follow-up check sends one item (its description, people and verified quotes) with up to 24 related messages that code picked. A matching check sends up to eight pairs of items the reviewer may read (each item's description, people, due date or cadence and approver, and up to two of its verified quotes). The two items of a pair may come from different access levels; the model returns only a verdict per pair.
- **What comes back:** candidate commitments and recurring duties, each citing message references and quotes. For each item: quotes that say it was done, imply it was done, or say it was not done, and short context notes (decision, contact, risk, dependency), each citing a quote. For each pair of items: "same", "different" or "unsure", and nothing else.
- **What the model does not decide:** status and trust (fixed rules over verified quotes, run by the database), dates (computed by code), which messages it reads and which pairs it compares (picked by code), near-identical duplicates (linked by a rule without the model), access levels (inherited from the cited messages by database triggers), and docket entries (opened by the trust rule, with a summary written by code).
- **What is stored:** only items whose quotes verify, as drafts. Context notes, and the short description of each commitment, are kept only if they name no person or number missing from their own message (a failing description is replaced by the verified quote). A "same" verdict links two items; an "unsure" verdict is shown as a possible match and never used as evidence. Items are never merged. Model responses are cached by prompt hash in `llm_cache`, which only the server can read.
- **Testing without the API:** an offline rule-based stand-in (`LLM_PROVIDER=fake`) is used in automated tests, so tests never send data to the API. The paid evals (`pnpm eval:extract`, `pnpm eval:pipeline`) run only with an explicit `--yes`, against synthetic data.

*Status (Phase 8): no AI use changed.* Review, sign-off, rulings and versions are deterministic code and database rules; no model is called and no new data is sent to one. The only link to the model is that a reviewer's "not the same" verdict on a pair of items is remembered, so later runs no longer send that pair to the matching prompt.

*Status (Phase 10): no AI use changed.* A visitor's own demo club is copied from the same synthetic fixture by code, with no model call. If a visitor runs "Build the ledger" in their copy, the prompts are the same text as for the shared club (prompts carry message text and short references, never ids or workspace names), so the saved answers in `llm_cache` are reused and the daily call budget still applies to anything new, such as files a visitor uploads.

*Status (Phase 12): what is sent changed slightly; what the model decides did not.* Extraction chunks are now packed per file group, so a year of chat is read in fewer, larger prompts (each still one access level). Two occasions of a repeated task with different due dates are no longer linked by a rule, so such pairs now go to the matching prompt. The hedge filter and sentence splitting are code. Two paid eval runs were approved and made on synthetic data only (Claude Haiku 5.5, 10 Nov 2026): the photography club (27 calls, about $0.013) and the year club (86 calls, about $0.053). The scorer that grades them (`src/lib/eval/score.ts`) is deterministic code.

*Status (Phase 13): what the model decides did not change; two rules now check its output more strictly, and its output from one run is shown in demo copies.*

- **Demo copies show stored model output.** "Explore a built handover" loads a ledger that Claude Haiku 5.5 built once from the synthetic year club, through the app's own pipeline (`scripts/freeze-demo.ts`), and that is stored in the repository as `src/lib/demo/year-club.json`. The items, quotes and context notes in it were proposed by the model and kept only because code verified them, exactly as in a live run. Which items start as accepted was decided by code, by comparing them with the hand-written ground truth (planted items accepted, the model's extras left as drafts), not by the model and not by hand.
- **Saved answers.** The model's answers for the three synthetic scenarios (126 responses) are stored in `data/demo/llm-cache.json` and can be loaded into the hosted cache, so building from the sample files reuses them. They are keyed by a hash of the exact prompt.
- **Two stricter checks in code.** A quote that only implies a promise was kept, from a record more restricted than the promise, is dropped (also refused by the database). A Trello card the model reads as a promise is kept only if the card names who is waiting for it or has a due date.
- **Paid runs this phase**, all on synthetic data and approved in advance: the year club build ($0.053, 163 calls of which 76 were cached), the photography club ($0.013) and the mini scenario ($0.004), on Claude Haiku 5.5. Each was scored against its ground truth.
- **Replies to the incoming lead's questions** are written by people; no model is involved.

## 3. Synthetic demo data: an LLM

All demo data is synthetic. A small hand-written scenario is used first. A later generator will use an LLM to render planted facts as realistic chat messages, minutes and Trello cards: typos, nicknames, and Tamil-English code-mixing in Latin script. Ground truth is fixed in YAML before generation, so the system can be scored against it. No real people or organisations are used.

*Status: the sample exports in `data/samples/` and the scenario in `data/scenarios/mini/` were written by Claude Code (with a seeded Python script for the large files); no language model is called to produce them at runtime. The year scenario in `data/scenarios/year/` (Phase 11) was also written by Claude Code: `world.yaml` and `ground_truth.yaml` by hand, and the generator that renders the files is a seeded, deterministic script. Still no model is called at runtime or during generation. The LLM-rendered variant is not built.* The photography club in `data/scenarios/photo/` (Phase 12) was made the same way: world and truth written by Claude Code, files rendered by the seeded script.

The Phase 2 parsers (`src/lib/parsers/`) use no AI at all: they are deterministic code, tested against the ground truth in `data/scenarios/mini/ground-truth.json`.
