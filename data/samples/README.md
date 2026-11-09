# Sample exports (SYNTHETIC)

Format samples for the parsers. Every name, club, number and message here is invented.
No real people or organisations. The number `+91 00000 00001` is a placeholder.

Dates are day-first (`dd/mm/yyyy`). WhatsApp exports carry no time zone; the parsers will assume IST (`+05:30`).

## Small format fixtures

Short files for fast unit tests, one edge case per line.

| File | Format | What it exercises |
|---|---|---|
| `whatsapp-android.txt` | Android: `dd/mm/yyyy, h:mm am - Author: text` | System lines (no author), multi-line message, `<Media omitted>`, deleted messages (`This message was deleted`, `You deleted this message`), `<This message was edited>`, an unsaved-contact author, a non-binding "maybe" message, Tamil-English code-mixing, midnight and noon times |
| `whatsapp-iphone.txt` | iPhone: `[dd/mm/yyyy, h:mm:ss am] Author: text` | The same cases, plus invisible left-to-right marks (U+200E) before attachments and system lines, `<attached: ...>`, `image omitted`, curly quotes |
| `trello-board.json` | Trello board JSON | Members, lists, cards with labels, due dates and `dueComplete`, a checklist, and `actions` (newest first) |
| `minutes.md` / `minutes.docx` | Markdown / Word | Two meetings each; ISO dates in the `.md`, textual dates in the `.docx` |

## Year-long samples (1 Nov 2025 to 31 Oct 2026)

One club over one year, for volume and realism. The files tell one story and agree with each other.

| File | Size | Contents |
|---|---|---|
| `whatsapp-android-committee-year.txt` | ~3,200 messages | Committee chat: planning, tech questions, banter, Tamil-English code-mixing, typos, 90 media placeholders, about 40 deleted messages, joins and leaves, a changed group icon and description. Busier before the fest (Jan to Feb), quiet during exams and the summer break |
| `whatsapp-iphone-volunteers-year.txt` | ~1,280 messages | Fest volunteers chat in iPhone format. Very active 5 Jan to 20 Feb, then nearly silent |
| `trello-board-year.json` | 25 cards, 94 actions | Cards moved through Backlog, To Do, Doing and Done across the year, with comments and two checklists |
| `minutes-2025-11-to-2026-04.md` | 6 meetings | Agenda, discussion, decisions, actions and finance notes, ISO dates |
| `minutes-2026-05-to-2026-10.docx` | 6 meetings | The same structure as Word headings, textual dates |

The filler conversation is template-generated, so it repeats phrases more than real chat would, and it contains a
few incidental "will" phrases that are not real commitments. The planted items below are the ground truth.

### Planted items

**Commitments**

| Who | Commitment | Outcome in the data |
|---|---|---|
| Arun | Lab permission letter signed by 14 Nov 2025 | Fulfilled (chat + Trello, 13 Nov) |
| Arun | Lab permission letter by 31 Jan 2026 | Fulfilled (23 Jan) |
| Kavya | Lab permission letter by 7 Aug 2026 | Fulfilled late (14 Aug) |
| Arun | Lab permission letter signed by 31 Oct 2026 | **No evidence kept**; the Trello card is still in To Do |
| Priya | Book the auditorium by 10 Jan | Fulfilled (9 Jan) |
| Arun | Send sponsorship proposal to Brightwave Labs by 20 Jan | Fulfilled (21 Jan); sponsorship confirmed 10 Feb |
| Kavya | Fest posters printed by 3 Feb | Fulfilled (3 to 4 Feb) |
| Rohan | WiFi router in the fest hall before 6 Feb | **Contradicted**: Trello says Done on 5 Feb, chat on 7 Feb says it still does not work |
| Rohan | Return the borrowed ESP32 boards by Friday 27 Feb | Fulfilled (27 Feb, with a photo) |
| Arun | Certificates to workshop speakers by 15 Mar | **Contradicted**: Trello Done on 16 Mar, chat on 18 Mar says they were not sent |
| Divya | Reimburse Mr. Ganesan ₹2,400 after bills | Fulfilled (8 Apr) |
| Arun | Club registration renewal by 10 Aug | Fulfilled (9 Aug); Dean signed 30 Aug |
| Arun | Handover document by 15 Nov 2026 | Open at the end of the data |
| Sanjay, Lakshmi, Ananya | Extension boards, registration desk, snacks (volunteers chat) | Fulfilled on 13 to 14 Feb |
| Imran | Demo kits setup before the fest | **No evidence kept** |
| Priya | Volunteer certificates by 28 Feb | **No evidence kept**; volunteers are still asking in March and April |

**Recurring duties (with approvals)**

| Duty | Approval needed | Appears |
|---|---|---|
| Lab permission letter before booking, every semester | HoD | Nov 2025, Jan 2026, Jul 2026, Oct 2026 |
| Auditorium booking for the annual IoT Fest, a month ahead | Dean's office | Dec 2025, Oct 2026 |
| Club registration renewal every August | Dean's signature (Student Affairs) | Jul to Aug 2026, "last August" |
| IoT Fest itself | none | "last year it was on 14 Feb", then 14 Feb 2026 |

**Decoys** (not commitments): "Maybe I'll check the projector too, will see", "We should probably do a hackathon someday",
"Might look at sponsors for next year, not sure", "Will see if the lab has extra sensors", "Maybe I'll bring my own projector too, will see".

**Restricted-looking content:** budget and reimbursement amounts appear in the committee chat and in the minutes' finance notes.
