"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { importFiles, type ImportState } from "@/app/import/actions";
import { Button } from "@/components/ui/button";
import { ACCESS_LABELS, ACCESS_LEVELS, type AccessLevel } from "@/lib/access";
import { formatBytes, formatIst, formatIstDate } from "@/lib/format";
import { ACCEPT, MAX_TOTAL_BYTES, suggestAccessLevel } from "@/lib/import/defaults";

type Picked = {
  file: File;
  kind: "WhatsApp chat" | "Trello board" | "Minutes" | "Unsupported";
  level: AccessLevel;
  reason: string;
  dateOrder: "auto" | "day" | "month";
};

const ACCESS_HELP: Record<AccessLevel, string> = {
  everyone: "every member",
  committee: "the committee",
  finance: "treasurer, outgoing lead and advisor",
  private: "only you and the advisor, unless you release an item",
};

function kindOf(name: string): Picked["kind"] {
  const n = name.toLowerCase();
  if (n.endsWith(".txt")) return "WhatsApp chat";
  if (n.endsWith(".json")) return "Trello board";
  if (/\.(md|markdown|docx)$/.test(n)) return "Minutes";
  return "Unsupported";
}

export function ImportForm() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [authorised, setAuthorised] = useState(false);
  const [state, action, pending] = useActionState<ImportState, FormData>(importFiles, null);
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const total = picked.reduce((n, p) => n + p.file.size, 0);
  const tooBig = total > MAX_TOTAL_BYTES;

  async function onChoose(list: FileList | null) {
    if (!list) return;
    const next: Picked[] = [];
    for (const file of Array.from(list)) {
      const text = file.name.toLowerCase().endsWith(".txt") ? await file.text() : undefined;
      const s = suggestAccessLevel(file.name, text);
      next.push({ file, kind: kindOf(file.name), level: s.level, reason: s.reason, dateOrder: "auto" });
    }
    setPicked((prev) => [...prev, ...next.filter((n) => !prev.some((p) => p.file.name === n.file.name && p.file.size === n.file.size))]);
  }

  // Files chosen before the page finished loading never fired onChange; pick them up now.
  useEffect(() => {
    const el = input.current;
    if (el?.files?.length) {
      void onChoose(el.files).then(() => {
        el.value = "";
      });
    }
  }, []);

  function update(i: number, patch: Partial<Picked>) {
    setPicked((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    picked.forEach((p, i) => {
      fd.append("file", p.file);
      fd.append(`access_${i}`, p.level);
      fd.append(`dateOrder_${i}`, p.dateOrder);
    });
    if (authorised) fd.append("authorised", "on");
    startTransition(() => action(fd));
  }

  const done = state?.results.filter((r) => r.ok).length ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-5" aria-describedby={`${ids}-notice`}>
        <div className="flex flex-col gap-2">
          <label htmlFor={`${ids}-files`} className="font-medium">
            Files to import
          </label>
          <input
            id={`${ids}-files`}
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => {
              const el = e.currentTarget;
              void onChoose(el.files).then(() => {
                el.value = "";
              });
            }}
            className="text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-sm text-muted-foreground">
            WhatsApp chat exports (.txt, Android or iPhone), a Trello board export (.json), or meeting minutes (.md or .docx).
            Up to about 3.9 MB in total per import.
          </p>
        </div>

        {picked.length > 0 && (
          <ul className="flex flex-col gap-3" aria-label="Files ready to import">
            {picked.map((p, i) => {
              const sel = `${ids}-level-${i}`;
              const ord = `${ids}-order-${i}`;
              return (
                <li key={`${p.file.name}-${i}`} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium break-all">{p.file.name}</span>
                    <span className="text-muted-foreground">
                      {p.kind} · {formatBytes(p.file.size)}
                    </span>
                  </div>
                  {p.kind === "Unsupported" ? (
                    <p className="mt-2 text-destructive">This file type is not supported and will be skipped.</p>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-end gap-4">
                      <div className="flex flex-col gap-1">
                        <label htmlFor={sel}>Who may see it</label>
                        <select
                          id={sel}
                          value={p.level}
                          onChange={(e) => update(i, { level: e.target.value as AccessLevel })}
                          className="rounded-md border bg-background px-2 py-1"
                        >
                          {ACCESS_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {ACCESS_LABELS[l]} ({ACCESS_HELP[l]})
                            </option>
                          ))}
                        </select>
                      </div>
                      {p.kind === "WhatsApp chat" && (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={ord}>Date order</label>
                          <select
                            id={ord}
                            value={p.dateOrder}
                            onChange={(e) => update(i, { dateOrder: e.target.value as Picked["dateOrder"] })}
                            className="rounded-md border bg-background px-2 py-1"
                          >
                            <option value="auto">Detect (day first if unclear)</option>
                            <option value="day">Day first (24/10/2026)</option>
                            <option value="month">Month first (10/24/2026)</option>
                          </select>
                        </div>
                      )}
                      <Button type="button" variant="outline" size="sm" onClick={() => setPicked((prev) => prev.filter((_, j) => j !== i))}>
                        Remove<span className="sr-only"> {p.file.name}</span>
                      </Button>
                    </div>
                  )}
                  {p.reason && <p className="mt-2 text-muted-foreground">{p.reason}</p>}
                </li>
              );
            })}
          </ul>
        )}

        {tooBig && (
          <p role="alert" className="text-sm text-destructive">
            These files add up to {formatBytes(total)}, more than about 3.9 MB. Import them in smaller groups.
          </p>
        )}

        <div id={`${ids}-notice`} className="rounded-md border bg-muted/40 p-3 text-sm">
          <p>
            <strong>How your data is used.</strong> Files are read on the server and only their messages are kept, with a
            fingerprint (SHA-256) of each file; the file itself is not stored. In a later step the messages are analysed by
            Anthropic&apos;s Claude API. A role only ever has the rows it may read sent for analysis. Times are read as IST.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-1" />
          <span>I am authorised to use this data.</span>
        </label>

        <div>
          <Button type="submit" disabled={pending || !authorised || picked.length === 0 || tooBig}>
            {pending ? "Importing…" : `Import ${picked.length || ""} file${picked.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
        </div>
      </form>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state && state.results.length > 0 && (
        <section aria-labelledby={`${ids}-read`} className="flex flex-col gap-3" role="status">
          <h3 id={`${ids}-read`} className="font-medium">
            What was read ({done} of {state.results.length} imported)
          </h3>
          <ul className="flex flex-col gap-3">
            {state.results.map((r, i) => (
              <li key={`${r.filename}-${i}`} className="rounded-md border p-3 text-sm" data-testid="import-result">
                <p className="font-medium break-all">{r.filename}</p>
                {r.ok ? (
                  <ReadSummaryView summary={r.summary} level={r.accessLevel} />
                ) : (
                  <p className="text-destructive">Not imported: {r.error}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export function ReadSummaryView({
  summary,
  level,
}: {
  summary: { unit: string; rawUnits: number; eventCount: number; dropped: Record<string, number>; first: string | null; last: string | null; warnings: string[] };
  level?: AccessLevel;
}) {
  const DROP_LABELS: Record<string, string> = {
    system: "system lines",
    deleted: "deleted messages",
    media: "attachments without text",
    empty: "empty messages",
    bad_date: "unreadable dates",
    unknown_action: "other Trello actions",
  };
  const dropped = Object.entries(summary.dropped);
  return (
    <div className="mt-1 flex flex-col gap-1 text-muted-foreground">
      <p>
        Read {summary.rawUnits} {summary.unit}
        {summary.rawUnits === 1 ? "" : "s"}, kept <span className="text-foreground">{summary.eventCount}</span> as entries
        {level ? <> visible to {ACCESS_LABELS[level].toLowerCase()}</> : null}.
      </p>
      {dropped.length > 0 && (
        <p>Left out: {dropped.map(([k, n]) => `${n} ${DROP_LABELS[k] ?? k}`).join(", ")}.</p>
      )}
      {summary.first && (
        <p>
          {summary.unit === "section"
            ? `Meetings from ${formatIstDate(summary.first)} to ${formatIstDate(summary.last)}.`
            : `From ${formatIst(summary.first)} to ${formatIst(summary.last)}.`}
        </p>
      )}
      {summary.warnings.map((w) => (
        <p key={w} className="text-foreground">
          Note: {w}
        </p>
      ))}
    </div>
  );
}
