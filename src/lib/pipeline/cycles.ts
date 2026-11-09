// Recurring duties ("cycles"): things the club must do again every semester or year, or
// before every booking, with the approvals they need. Code picks candidate messages by
// keyword, the model groups them into duties, and code keeps only duties whose quotes verify
// and whose cadence, approver and lead time appear in those quotes. Next-due and start-by
// dates are computed by code, never by the model, and say how they were derived.

import { z } from "zod";
import { levelRank } from "../access.ts";
import { istDayKey } from "../format.ts";
import { recordLine, visibilityKey, type PipelineEvent } from "./extract.ts";
import { byTime } from "./related.ts";
import { sentenceContaining } from "./text.ts";
import { normaliseForQuote, verifyQuote } from "./verify.ts";

/** Words that suggest a rule, a cycle or an approval. Broad on purpose: the model decides. */
export const DUTY_CUE =
  /\b(every|each|annual\w*|yearly|per (?:semester|sem|year|term|month)|semesters?|recurr\w*|next year|last year|last sem\w*|always|whenever|approv\w*|permission|signature|sign-?off|renew\w*|registration|in advance|ahead|deadline)\b/i;

/** The cadence words must say that something repeats. */
export const RECURRENCE = /\b(every|each|annual\w*|yearly|monthly|weekly|per (?:semester|sem|year|term|month|week)|semester\w*|recurr\w*|always|whenever)\b/i;

export const BATCH_MAX_EVENTS = 80;
export const BATCH_MAX_CHARS = 14_000;

/** Messages worth showing the duty finder. */
export function dutyCandidates(events: readonly PipelineEvent[]): PipelineEvent[] {
  return events.filter((e) => DUTY_CUE.test(e.text));
}

/**
 * Time-ordered batches that mix source types, so a rule stated in chat, minutes and Trello
 * lands together. Batches never mix visibility (see visibilityKey): least restricted first,
 * so a duty is stored at the most open level that states it.
 */
export function batchDutyEvents(events: readonly PipelineEvent[], maxEvents = BATCH_MAX_EVENTS, maxChars = BATCH_MAX_CHARS): PipelineEvent[][] {
  const groups = new Map<string, PipelineEvent[]>();
  for (const e of events) {
    const k = visibilityKey(e);
    const list = groups.get(k);
    if (list) list.push(e);
    else groups.set(k, [e]);
  }
  const ordered = [...groups.values()].sort((a, b) => levelRank(a[0].accessLevel ?? "everyone") - levelRank(b[0].accessLevel ?? "everyone"));
  return ordered.flatMap((g) => batchByTime(g, maxEvents, maxChars));
}

export function batchByTime(events: readonly PipelineEvent[], maxEvents = BATCH_MAX_EVENTS, maxChars = BATCH_MAX_CHARS): PipelineEvent[][] {
  const out: PipelineEvent[][] = [];
  let cur: PipelineEvent[] = [];
  let chars = 0;
  for (const e of [...events].sort(byTime)) {
    if (cur.length && (cur.length >= maxEvents || chars + e.text.length > maxChars)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(e);
    chars += e.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

export const PERIODS = ["semester", "year", "month", "week", "each_time", "other"] as const;
export type Period = (typeof PERIODS)[number];

export const DutySchema = z.object({
  duties: z.array(
    z.object({
      duty: z.string().describe("What must be done, in a few plain words"),
      period: z.enum(PERIODS).describe("How often: each_time means before every booking or event of a kind"),
      cadence_words: z.string().describe("Words copied exactly from a quoted message that say how often"),
      when_words: z.string().nullable().describe("Words copied exactly that say when in the year, e.g. 'every August', or null"),
      approval: z.string().nullable().describe("What approval is needed, in a few words, or null"),
      approver: z.string().nullable().describe("Who gives the approval, copied exactly as written, or null"),
      lead_time_words: z.string().nullable().describe("Words copied exactly that say how far ahead to start, or null"),
      usual_owner: z.string().nullable().describe("Who usually does it, if a record says so, or null"),
      quotes: z.array(
        z.object({
          message: z.string().describe("The reference of the message, e.g. m3"),
          quote: z.string().describe("Words copied exactly from that one message"),
          role: z.enum(["rule", "past_instance"]),
        }),
      ),
    }),
  ),
});
export type DutyOutput = z.infer<typeof DutySchema>;

export const DUTY_SYSTEM = `You read records from a university student club (chat messages, Trello activity, meeting minutes) and list its recurring duties: things the club has to do again and again on a cycle, such as every semester, every year, or before every booking, including any approval they need.

Examples: "the HoD's permission letter has to be approved before booking, every semester"; "club registration has to be renewed every August, signed by the Dean".

Do not list one-off promises or tasks, wishes, or anything you would have to guess. Combine mentions of the same duty from different records into one duty.

For each duty:
- duty: what must be done, in a few plain words ("Get the HoD's permission letter before booking the lab").
- period: semester, year, month, week, each_time (before every booking or event of a kind), or other.
- cadence_words: the words that say how often, copied exactly from one of the quoted messages ("every semester", "our annual event", "before every lab booking").
- when_words: words that say when in the year it falls, copied exactly ("every August"), or null.
- approval: what approval is needed, in a few words, or null if none is mentioned.
- approver: who gives it, copied exactly as written ("HoD", "Dean's office"), or null.
- lead_time_words: how far ahead to start, copied exactly ("a month ahead", "two weeks ahead"), or null.
- usual_owner: who usually does it, only if a record says so, or null.
- quotes: every message that states or shows this duty. Give the message reference in square brackets at the start of the message (e.g. m3) and words copied exactly from that one message. Role "rule" for a statement of the requirement or cycle, "past_instance" for a record of one time it was done or attempted.

If there are no recurring duties, return an empty list.`;

export function buildDutyPrompt(events: readonly PipelineEvent[]): { user: string; refs: Map<string, PipelineEvent> } {
  const refs = new Map<string, PipelineEvent>();
  const lines = [...events].sort(byTime).map((e, i) => {
    const r = `m${i + 1}`;
    refs.set(r, e);
    return recordLine(r, e);
  });
  return { user: `Records (times in IST), oldest first:\n\n${lines.join("\n")}`, refs };
}

export type DutyQuote = { event: PipelineEvent; quote: string; relation: "supports" | "past_instance" };

export type KeptDuty = {
  description: string;
  period: Period;
  cadence: string;
  approval: string | null;
  approver: string | null;
  leadTime: string | null;
  whenWords: string | null;
  owedBy: string | null;
  quotes: DutyQuote[];
};

export type DutyDropReason =
  | "unknown_message" | "quote_not_found" | "quote_too_short" | "no_rule" | "no_recurrence" | "duplicate"
  | "ungrounded_field" | "mixed_visibility";
const grounded = (words: string, quotes: readonly DutyQuote[]) =>
  quotes.some((q) => normaliseForQuote(q.quote).includes(normaliseForQuote(words)));

/**
 * Keep duties whose quotes verify and whose cadence is in a quote and says something repeats.
 * A batch never mixes visibility (batchDutyEvents); a duty whose quotes do anyway is dropped.
 */
export function postProcessDuties(output: DutyOutput, refs: Map<string, PipelineEvent>): { kept: KeptDuty[]; dropped: Partial<Record<DutyDropReason, number>> } {
  const dropped: Partial<Record<DutyDropReason, number>> = {};
  const drop = (r: DutyDropReason, n = 1) => (dropped[r] = (dropped[r] ?? 0) + n);
  const kept: KeptDuty[] = [];

  for (const d of output.duties) {
    const quotes: DutyQuote[] = [];
    const seen = new Set<string>();
    for (const q of d.quotes) {
      const event = refs.get(q.message.trim().replace(/^\[|\]$/g, ""));
      if (!event) {
        drop("unknown_message");
        continue;
      }
      const check = verifyQuote(q.quote, event.text);
      if (!check.ok) {
        drop(check.reason);
        continue;
      }
      const key = `${event.id}|${normaliseForQuote(q.quote)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      quotes.push({ event, quote: q.quote.trim(), relation: q.role === "rule" ? "supports" : "past_instance" });
    }
    if (!quotes.some((q) => q.relation === "supports")) {
      drop("no_rule");
      continue;
    }

    // The cadence must be stated in the records. If the model named words from a message it
    // did not quote, quote the sentence that holds them (built by code, so it verifies).
    const cadence = d.cadence_words.trim();
    if (!cadence || !RECURRENCE.test(cadence)) {
      drop("no_recurrence");
      continue;
    }
    if (!grounded(cadence, quotes)) {
      const holder = [...refs.values()].find((e) => sentenceContaining(e.text, cadence));
      const sentence = holder ? sentenceContaining(holder.text, cadence) : null;
      if (!holder || !sentence || !verifyQuote(sentence, holder.text).ok) {
        drop("no_recurrence");
        continue;
      }
      quotes.push({ event: holder, quote: sentence, relation: "supports" });
    }

    if (new Set(quotes.map((q) => visibilityKey(q.event))).size > 1) {
      drop("mixed_visibility");
      continue;
    }

    const field = (w: string | null) => {
      const v = w?.trim() || null;
      if (v && !grounded(v, quotes)) {
        drop("ungrounded_field");
        return null;
      }
      return v;
    };
    const duty: KeptDuty = {
      description: d.duty.trim(),
      period: d.period,
      cadence,
      approval: d.approval?.trim() || null,
      approver: field(d.approver),
      leadTime: field(d.lead_time_words),
      whenWords: field(d.when_words),
      owedBy: d.usual_owner?.trim() || null,
      quotes,
    };
    if (!duty.description) {
      drop("no_rule");
      continue;
    }
    const same = kept.find((k) => normaliseForQuote(k.description) === normaliseForQuote(duty.description));
    if (same) {
      drop("duplicate");
      for (const q of duty.quotes) {
        if (!same.quotes.some((s) => s.event.id === q.event.id && normaliseForQuote(s.quote) === normaliseForQuote(q.quote))) same.quotes.push(q);
      }
      continue;
    }
    kept.push(duty);
  }
  return { kept, dropped };
}

// ---------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10 };

/** A month named in the words ("every August" -> 8), or null. */
export function monthIn(words: string | null): number | null {
  if (!words) return null;
  const m = words.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/);
  if (!m) return null;
  const i = MONTHS.findIndex((name) => name.startsWith(m[1].slice(0, 3)));
  return i >= 0 ? i + 1 : null;
}

export type LeadTime = { days: number } | { months: number };

/** "a month ahead" -> 1 month, "two weeks ahead" -> 14 days, "10 days before" -> 10 days. */
export function parseLeadTime(words: string | null): LeadTime | null {
  if (!words) return null;
  const m = words.toLowerCase().match(/\b(\d+|a|an|one|two|three|four|five|six|eight|ten)\s+(day|week|month)s?\b/);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1]];
  if (!n) return null;
  if (m[2] === "month") return { months: n };
  return { days: m[2] === "week" ? n * 7 : n };
}

const PERIOD_MONTHS: Partial<Record<Period, number>> = { semester: 6, year: 12, month: 1 };

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const humanDay = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 1).toUpperCase()}${MONTHS[m - 1].slice(1, 3)} ${y}`;
};

export type Schedule = { nextDue: string | null; startBy: string | null; basis: string | null };

/**
 * Next due date and start-by date, where the records allow it:
 *  - a yearly duty with a stated month falls on the 1st of that month (stated);
 *  - otherwise, one period after the latest recorded past instance (estimated);
 *  - start-by is the next due date minus a stated lead time.
 * `today` is an IST calendar day (YYYY-MM-DD). Dates are rolled forward past today.
 */
export function schedule(input: { period: Period; whenWords: string | null; leadTime: string | null; pastInstances: readonly string[]; today: string }): Schedule {
  const { period, whenWords, today } = input;
  let nextDue: string | null = null;
  let basis: string | null = null;

  const month = monthIn(whenWords);
  if (month && period === "year") {
    const [y] = today.split("-").map(Number);
    nextDue = `${y}-${String(month).padStart(2, "0")}-01`;
    if (nextDue <= today) nextDue = `${y + 1}-${String(month).padStart(2, "0")}-01`;
    basis = `Stated in the records: "${whenWords}"`;
  } else if (PERIOD_MONTHS[period] || period === "week") {
    const last = [...input.pastInstances].sort().at(-1);
    if (last) {
      // Count whole periods from the last instance (not step by step, so 31 Jan stays month-end).
      const after = (k: number) => (period === "week" ? addDays(last, 7 * k) : addMonths(last, PERIOD_MONTHS[period]! * k));
      let k = 1;
      while (after(k) <= today && k < 10_000) k++;
      nextDue = after(k);
      const unit = { semester: "one semester", year: "one year", month: "one month", week: "one week" }[period as "semester"];
      basis = `Estimated: ${unit} after it was last recorded, on ${humanDay(last)}`;
    }
  }

  let startBy: string | null = null;
  const lead = parseLeadTime(input.leadTime);
  if (nextDue && lead) {
    startBy = "months" in lead ? addMonths(nextDue, -lead.months) : addDays(nextDue, -lead.days);
    basis = `${basis}; start ${input.leadTime}`;
  }
  return { nextDue, startBy, basis };
}

/** IST calendar days of a duty's past instances. */
export function pastInstanceDays(quotes: readonly DutyQuote[]): string[] {
  return quotes.filter((q) => q.relation === "past_instance" && q.event.ts).map((q) => istDayKey(q.event.ts!));
}
