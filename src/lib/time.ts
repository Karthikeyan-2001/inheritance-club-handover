// Everything in this app is stamped in IST (Asia/Kolkata, UTC+05:30, no daylight saving).
// Timestamps travel as ISO 8601 strings with an explicit +05:30 offset, so they are
// unambiguous, sort lexicographically, and Postgres reads them as timestamptz.

export const IST_OFFSET = "+05:30";
const IST_OFFSET_MS = 330 * 60_000;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Build an IST timestamp from wall-clock parts. Throws RangeError on impossible dates. */
export function istIso(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    Number.isInteger(year) &&
    year >= 1900 &&
    year <= 2200 &&
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute &&
    probe.getUTCSeconds() === second;
  if (!valid) throw new RangeError(`Invalid date/time: ${year}-${month}-${day} ${hour}:${minute}:${second}`);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}${IST_OFFSET}`;
}

/** An absolute instant (e.g. a Trello UTC timestamp) rendered as IST wall-clock time. */
export function instantToIstIso(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid Date");
  const s = new Date(date.getTime() + IST_OFFSET_MS);
  return istIso(
    s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate(),
    s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds(),
  );
}

/**
 * Treat a Date's LOCAL fields as IST wall-clock time. WhatsApp exports carry no zone, and
 * whatsapp-chat-parser builds its Dates from the file's text in the machine's local zone.
 * Reading the local fields back recovers the text exactly, whatever zone the code runs in.
 * (One caveat: on a machine in a daylight-saving zone, a wall-clock time that falls inside
 * its spring-forward gap would already have been shifted. Vercel runs in UTC, so this
 * only affects local development in such zones.)
 */
export function localWallClockToIstIso(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid Date");
  return istIso(
    date.getFullYear(), date.getMonth() + 1, date.getDate(),
    date.getHours(), date.getMinutes(), date.getSeconds(),
  );
}

/** The calendar date (YYYY-MM-DD) of an IST timestamp produced by this module. */
export function istDateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** Today's calendar date in IST (YYYY-MM-DD). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
