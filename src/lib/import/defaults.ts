// Suggested access level for an upload. The uploader can always change it before importing.
// One-to-one chats default to private, as the brief requires.

import type { AccessLevel } from "../access.ts";

/** Total size per import request. Vercel caps request bodies at about 4.5 MB. */
export const MAX_TOTAL_BYTES = 3_900_000;
export const ACCEPT = ".txt,.json,.md,.markdown,.docx";

const ANDROID = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},? \d{1,2}[:.]\d{2}(?:[:.]\d{2})?(?:\s?[ap]\.?\s?m\.?)? [-–] ([^:\n]{1,80}): (.*)$/i;
const IPHONE = /^\[[^\]]{8,40}\] ([^:\n]{1,80}): (.*)$/;
const LRM = "‎";

/** Distinct authors of ordinary messages in a WhatsApp export (system lines excluded). */
export function chatAuthors(text: string, maxLines = 20_000): Set<string> {
  const authors = new Set<string>();
  const lines = text.split(/\r?\n/, maxLines);
  for (const raw of lines) {
    const line = raw.startsWith(LRM) ? raw.slice(1) : raw;
    const m = line.match(ANDROID) ?? line.match(IPHONE);
    if (!m) continue;
    if (m[2].startsWith(LRM)) continue; // iPhone marks system lines and attachments
    authors.add(m[1].replace(/[‎‏]/g, "").trim());
  }
  return authors;
}

export type Suggestion = { level: AccessLevel; reason: string };

const FINANCE_NAME = /(financ|budget|account|treasur|expense|reimburs|payment|invoice)/i;

export function suggestAccessLevel(filename: string, text?: string): Suggestion {
  const lower = filename.toLowerCase();
  if (FINANCE_NAME.test(lower)) return { level: "finance", reason: "The file name mentions money, so it starts as finance-only." };
  if (lower.endsWith(".txt")) {
    if (text === undefined) return { level: "committee", reason: "Chat export." };
    const n = chatAuthors(text).size;
    if (n > 0 && n <= 2) {
      return { level: "private", reason: `Looks like a one-to-one chat (${n} ${n === 1 ? "person" : "people"}), so it starts as private.` };
    }
    return { level: "committee", reason: n > 2 ? `Group chat with ${n} people.` : "Chat export." };
  }
  if (lower.endsWith(".json")) return { level: "committee", reason: "Trello board." };
  if (/\.(md|markdown|docx)$/.test(lower)) return { level: "committee", reason: "Meeting minutes." };
  return { level: "committee", reason: "" };
}
