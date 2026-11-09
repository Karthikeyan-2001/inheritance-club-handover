import { z } from "zod";

export const SOURCE_TYPES = ["whatsapp", "trello", "minutes"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

const IST_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+05:30$/;

/**
 * The one shape every parser outputs. It maps onto the `events` table; ids and access
 * levels are assigned at import time, not here.
 */
export const EventSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  /** Who said or did it. Null when the source has no author (e.g. an undated minutes file). */
  author: z.string().min(1).nullable(),
  /** ISO 8601 in IST (+05:30). Null when the source gives no usable date. */
  ts: z.string().regex(IST_ISO).nullable(),
  text: z.string().min(1),
  /** Groups related events: a chat day, a Trello card, a meeting. */
  threadId: z.string().min(1).nullable(),
  /** Small, source-specific facts (e.g. a Trello list move). Never source text. */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type ParsedEvent = z.infer<typeof EventSchema>;

/** "What was read": shown to the user after an upload. */
export type ReadSummary = {
  sourceType: SourceType;
  /** What the raw units are: chat messages, Trello actions and cards, or minutes sections. */
  unit: "message" | "action" | "section";
  rawUnits: number;
  eventCount: number;
  /** Raw units that did not become events, by reason. Nothing is dropped silently. */
  dropped: Record<string, number>;
  first: string | null;
  last: string | null;
  warnings: string[];
};

export type ParseResult = { events: ParsedEvent[]; summary: ReadSummary };

export type ParseErrorCode =
  | "empty"
  | "unsupported-format"
  | "invalid-json"
  | "not-trello-board"
  | "docx-unreadable"
  | "unsupported-file";

/** A problem with the uploaded file that the user can act on. The message is safe to show. */
export class ParseError extends Error {
  code: ParseErrorCode;
  constructor(code: ParseErrorCode, message: string) {
    super(message);
    this.name = "ParseError";
    this.code = code;
  }
}

/** Validate, sort by time (stable; undated events last) and build the summary. */
export function finish(
  sourceType: SourceType,
  unit: ReadSummary["unit"],
  rawUnits: number,
  events: ParsedEvent[],
  dropped: Record<string, number>,
  warnings: string[],
): ParseResult {
  const valid = z.array(EventSchema).parse(events);
  valid.sort((a, b) => (a.ts === null ? 1 : b.ts === null ? -1 : a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const dated = valid.filter((e) => e.ts !== null);
  const cleanDropped = Object.fromEntries(Object.entries(dropped).filter(([, n]) => n > 0));
  return {
    events: valid,
    summary: {
      sourceType,
      unit,
      rawUnits,
      eventCount: valid.length,
      dropped: cleanDropped,
      first: dated[0]?.ts ?? null,
      last: dated.at(-1)?.ts ?? null,
      warnings,
    },
  };
}

// Invisible direction marks that WhatsApp (iPhone) puts around attachments and system lines.
const BIDI = /[‎‏‪-‮⁦-⁩]/g;
export const stripBidi = (s: string): string => s.replace(BIDI, "");
