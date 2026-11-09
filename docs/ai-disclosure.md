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

- All model calls go through one adapter (`src/lib/llm/adapter.ts`, from a later phase). Output is structured and validated with Zod, and responses are cached by prompt hash.
- Every extracted claim must carry a verbatim quote and an event id. Deterministic code checks that the quote appears in that event's text. Claims that fail are dropped and counted.
- Trust states (corroborated / sourced / inferred / contradicted / gap) are set by a pure rule function, not by the model.
- A model never sees rows the requesting role cannot read. Permissions are enforced by Postgres row-level security before anything is sent.
- The import screen names the LLM provider and requires the uploader to confirm they are authorised to use the data.

*Status (Phase 4): commitment extraction is live.*

- **What is sent:** the text, author and IST time of messages the signed-in reviewer may read, in chunks, to the model named in `LLM_MODEL_FAST` (Claude Haiku 5.5 by default) via the Anthropic API.
- **What comes back:** candidate commitments, each citing a message reference and a quote.
- **What is stored:** only candidates whose quote verifies are stored, as drafts. Model responses are cached by prompt hash in `llm_cache`, which only the server can read.
- **Testing without the API:** an offline rule-based stand-in (`LLM_PROVIDER=fake`) is used in automated tests, so tests never send data to the API.

## 3. Synthetic demo data: an LLM

All demo data is synthetic. A small hand-written scenario is used first. A later generator will use an LLM to render planted facts as realistic chat messages, minutes and Trello cards: typos, nicknames, and Tamil-English code-mixing in Latin script. Ground truth is fixed in YAML before generation, so the system can be scored against it. No real people or organisations are used.

*Status: the sample exports in `data/samples/` and the scenario in `data/scenarios/mini/` were written by Claude Code (with a seeded Python script for the large files); no language model is called to produce them at runtime. The LLM-driven generator is planned for a later phase.*

The Phase 2 parsers (`src/lib/parsers/`) use no AI at all: they are deterministic code, tested against the ground truth in `data/scenarios/mini/ground-truth.json`.
