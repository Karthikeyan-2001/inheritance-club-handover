// Display helpers. Everything is shown in IST, whatever zone the server or browser is in.

const PARTS = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function parts(value: string): Record<string, string> | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Object.fromEntries(PARTS.formatToParts(d).map((p) => [p.type, p.value]));
}

/** "24 Oct 2026, 10:14 am IST". Accepts any ISO string (UTC from Postgres or +05:30). */
export function formatIst(value: string | null | undefined): string {
  if (!value) return "No date";
  const p = parts(value);
  if (!p) return "Invalid date";
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()} IST`;
}

/** "24 Oct 2026" in IST. */
export function formatIstDate(value: string | null | undefined): string {
  if (!value) return "No date";
  const p = parts(value);
  return p ? `${p.day} ${p.month} ${p.year}` : "Invalid date";
}

/** The IST calendar day (YYYY-MM-DD) of any ISO timestamp, for grouping. */
export function istDayKey(value: string): string {
  const d = new Date(new Date(value).getTime() + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** "10:14 am" in IST. */
export function formatIstTime(value: string | null | undefined): string {
  if (!value) return "";
  const p = parts(value);
  return p ? `${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}` : "";
}
