import { parseString, type Message } from "whatsapp-chat-parser";
import { istDateOf, localWallClockToIstIso } from "../time.ts";
import { ParseError, finish, stripBidi, type ParsedEvent, type ParseResult } from "./types.ts";

export type WhatsAppOptions = {
  /**
   * Whether dates are day-first (24/10/2026) or month-first (10/24/2026). Leave unset to let
   * the parser infer it; when every date is ambiguous it assumes day-first.
   */
  daysFirst?: boolean;
};

const LRM = "‎";

const MEDIA = [
  /^<Media omitted>$/i,
  /^<attached: .+>$/i,
  /^(image|video|audio|sticker|gif|document|contact card|location) omitted$/i,
];
const DELETED = /^(This message was deleted|You deleted this message)\.?$/i;
// Applied only to lines that cannot be a person talking (no author, or iPhone's marked lines).
const SYSTEM = [
  /end-to-end encrypted/i,
  /\bcreated (this )?group\b/i,
  /\badded\b/i,
  /\bremoved\b/i,
  /\bleft\b/i,
  /\bjoined\b/i,
  /\bchanged (this group's icon|the group description|the subject|the group name|their phone number|this group's settings)\b/i,
  /security code/i,
  /\b(is|are) now an admin\b/i,
  /\bpinned a message\b/i,
];
const EDITED = /\s*<This message was edited>\s*$/i;

/**
 * Parse a WhatsApp "Export chat" text file (Android or iPhone). Times are stamped as IST.
 * System lines, deleted messages and attachments without text are dropped and counted.
 */
export function parseWhatsApp(text: string, options: WhatsAppOptions = {}): ParseResult {
  const input = text.replace(/^﻿/, "");
  if (!input.trim()) throw new ParseError("empty", "The chat file is empty.");

  let messages: Message[];
  try {
    messages = parseString(input, {
      parseAttachments: true,
      ...(options.daysFirst === undefined ? {} : { daysFirst: options.daysFirst }),
    });
  } catch {
    messages = [];
  }
  if (messages.length === 0) {
    const firstLine = input.split("\n").find((l) => l.trim()) ?? "";
    throw new ParseError(
      "unsupported-format",
      "This does not look like a WhatsApp chat export, or its date format is not supported. " +
        "Expected lines like '24/10/2026, 10:14 am - Name: message' (Android) or " +
        `'[24/10/2026, 10:14:15 am] Name: message' (iPhone). The first line was: "${firstLine.slice(0, 80)}"`,
    );
  }

  const events: ParsedEvent[] = [];
  const dropped = { system: 0, deleted: 0, media: 0, empty: 0, bad_date: 0 };

  for (const m of messages) {
    const raw = m.message.trim();
    const marked = raw.startsWith(LRM);
    const body = stripBidi(raw).trim();
    const author = m.author === null ? null : stripBidi(m.author).trim();

    if (m.attachment || MEDIA.some((re) => re.test(body))) {
      dropped.media++;
      continue;
    }
    if (DELETED.test(body)) {
      dropped.deleted++;
      continue;
    }
    if (author === null || author === "" || (marked && SYSTEM.some((re) => re.test(body)))) {
      dropped.system++;
      continue;
    }

    const edited = EDITED.test(body);
    const clean = body.replace(EDITED, "").trim();
    if (!clean) {
      dropped.empty++;
      continue;
    }

    let ts: string;
    try {
      ts = localWallClockToIstIso(m.date);
    } catch {
      dropped.bad_date++;
      continue;
    }
    events.push({
      sourceType: "whatsapp",
      author,
      ts,
      text: clean,
      threadId: `wa:${istDateOf(ts)}`,
      meta: edited ? { edited: true } : {},
    });
  }

  const warnings: string[] = [];
  if (dropped.bad_date) warnings.push(`${dropped.bad_date} message(s) had an impossible date and were skipped.`);
  if (events.length === 0) warnings.push("No ordinary messages were found, only system lines, deleted messages or attachments.");

  return finish("whatsapp", "message", messages.length, events, dropped, warnings);
}
