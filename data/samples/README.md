# Sample exports (SYNTHETIC)

Format samples for the parsers. Every name, club, number and message here is invented.
No real people or organisations. The unassigned-looking number `+91 00000 00001` is a placeholder.

| File | Format | What it exercises |
|---|---|---|
| `whatsapp-android.txt` | Android export: `dd/mm/yyyy, h:mm am - Author: text` | System lines (no author), multi-line message, `<Media omitted>`, deleted messages (`This message was deleted`, `You deleted this message`), `<This message was edited>`, an unsaved-contact author, a non-binding "maybe" message, Tamil-English code-mixing, midnight and noon times |
| `whatsapp-iphone.txt` | iPhone export: `[dd/mm/yyyy, h:mm:ss am] Author: text` | Same cases as Android, plus invisible left-to-right marks (U+200E) before attachments and system lines, `<attached: ...>`, `image omitted`, curly quotes, system lines attributed to the chat name |
| `trello-board.json` | Trello board JSON export | Members, lists (To Do, Doing, Done), cards with labels, due dates and `dueComplete`, a checklist, and `actions` (newest first): `createCard`, `addMemberToCard`, `commentCard`, and `updateCard` list moves |
| `minutes.md` | Markdown | ISO-dated `##` sections with decisions and actions |
| `minutes.docx` | Word | Textual dates (`9 October 2026`) in Heading 2 sections, bold labels, Heading 3 subsections |

`trello-board.json` contains one deliberate conflict for later contradiction checks: card 3
("Send certificates to workshop speakers") is moved to Done on 2026-10-16, and a comment on
2026-10-20 says the speakers have not received them.

Dates are day-first (`dd/mm/yyyy`). WhatsApp exports carry no time zone; the parsers will
assume IST (`+05:30`).
