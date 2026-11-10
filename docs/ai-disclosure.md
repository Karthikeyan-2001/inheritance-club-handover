# AI disclosure

Inheritance uses AI in three separate ways. Each is listed here so judges and users can see exactly where a model is involved.

## 1. Writing the code: Claude Code

The solo developer used Claude Code (Anthropic) as a pair programmer to write and refactor code, tests, migrations and docs. Every change was reviewed and committed by the developer. Design decisions (schema, trust rules, permission model) are the developer's, recorded in `CLAUDE.md` and in these docs.

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

## 3. Synthetic demo data: an LLM

All demo data is synthetic. A small hand-written scenario is used first. A later generator will use an LLM to render planted facts as realistic chat messages, minutes and Trello cards: typos, nicknames, and Tamil-English code-mixing in Latin script. Ground truth is fixed in YAML before generation, so the system can be scored against it. No real people or organisations are used.

*Status: the sample exports in `data/samples/` and the scenario in `data/scenarios/mini/` were written by Claude Code (with a seeded Python script for the large files); no language model is called to produce them at runtime. The year scenario in `data/scenarios/year/` (Phase 11) was also written by Claude Code: `world.yaml` and `ground_truth.yaml` by hand, and the generator that renders the files is a seeded, deterministic script. Still no model is called at runtime or during generation. The LLM-rendered variant is not built.*

The Phase 2 parsers (`src/lib/parsers/`) use no AI at all: they are deterministic code, tested against the ground truth in `data/scenarios/mini/ground-truth.json`.
