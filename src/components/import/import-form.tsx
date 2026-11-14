"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { importFiles, type ImportState } from "@/app/import/actions";
import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ACCESS_LABELS, ACCESS_LEVELS, type AccessLevel } from "@/lib/access";
import { formatBytes, formatIst, formatIstDate } from "@/lib/format";
import { ACCEPT, MAX_TOTAL_BYTES, suggestAccessLevel } from "@/lib/import/defaults";
import { SAMPLE_SETS, sampleUrl } from "@/lib/import/samples";

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

function Part({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
        {n}
      </span>
      <div className="flex flex-col gap-0.5">
        <h3 className="font-semibold">{title}</h3>
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
    </div>
  );
}

const PHOTO = SAMPLE_SETS.find((s) => s.dir === "photo")!;

export function ImportForm() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [authorised, setAuthorised] = useState(false);
  const [state, action, pending] = useActionState<ImportState, FormData>(importFiles, null);
  const ids = useId();
  const input = useRef<HTMLInputElement>(null);
  const total = picked.reduce((n, p) => n + p.file.size, 0);
  const tooBig = total > MAX_TOTAL_BYTES;
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  /** One click: fetch the photography club's four synthetic files and list them at their levels. */
  async function addSamples() {
    setLoadingSamples(true);
    setSampleError(null);
    try {
      const files = await Promise.all(
        PHOTO.files.map(async (f) => {
          const res = await fetch(sampleUrl(PHOTO.dir, f.file));
          if (!res.ok) throw new Error(f.file);
          return { file: new File([await res.blob()], f.file), level: f.level };
        }),
      );
      setPicked((prev) => [
        ...prev,
        ...files
          .filter((n) => !prev.some((p) => p.file.name === n.file.name && p.file.size === n.file.size))
          .map((n) => ({ file: n.file, kind: kindOf(n.file.name), level: n.level, reason: "Sample file: its level is already set for you.", dateOrder: "auto" as const })),
      ]);
    } catch {
      setSampleError("Could not load the sample files. Check your connection, or download them below and choose them by hand.");
    } finally {
      setLoadingSamples(false);
    }
  }

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
    // The list empties once sent; the result below says what was read, or why a file was refused.
    setPicked([]);
    startTransition(() => action(fd));
  }

  const done = state?.results.filter((r) => r.ok).length ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-5" aria-describedby={`${ids}-notice`}>
        <Part n={1} title="Choose files">Use the sample files in one click, or choose the club&apos;s own exports.</Part>
        <div className="flex flex-col gap-3 pl-9">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={addSamples} disabled={loadingSamples || pending} data-testid="use-samples">
              {loadingSamples ? <Spinner /> : <SparklesIcon aria-hidden="true" />}
              {loadingSamples ? "Loading the sample files…" : `Use the ${PHOTO.files.length} sample files`}
            </Button>
            <span className="text-sm text-muted-foreground">or</span>
          </div>
          {sampleError && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-destructive">
              {sampleError}
            </p>
          )}
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

        <Part n={2} title="Choose who may see each file">
          {picked.length === 0 ? "Each file you choose appears here with a suggested level." : "A level is suggested for each file; change it if needed."}
        </Part>

        {picked.length > 0 && (
          <ul className="flex flex-col gap-3 pl-9" aria-label="Files ready to import">
            {picked.map((p, i) => {
              const sel = `${ids}-level-${i}`;
              const ord = `${ids}-order-${i}`;
              return (
                <li key={`${p.file.name}-${i}`} className="rounded-xl border bg-card p-3 text-sm">
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

        <Part n={3} title="Confirm and import" />
        <div id={`${ids}-notice`} className="ml-9 rounded-xl border bg-muted/40 p-3 text-sm">
          <p>
            <strong>How your data is used.</strong> Files are read on the server and only their messages are kept, with a
            fingerprint (SHA-256) of each file; the file itself is not stored. In a later step the messages are analysed by
            Anthropic&apos;s Claude API. A role only ever has the rows it may read sent for analysis. Times are read as IST.
          </p>
        </div>

        <label className="ml-9 flex items-start gap-2 rounded-xl border border-primary/25 bg-card p-3 text-sm">
          <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>
            <span className="font-medium">I am authorised to use this data.</span>{" "}
            <span className="text-muted-foreground">Needed once per import. The sample files are synthetic, so ticking it is fine for them.</span>
          </span>
        </label>

        <div className="ml-9 flex flex-col items-start gap-1.5">
          <Button type="submit" size="lg" disabled={pending || !authorised || picked.length === 0 || tooBig} aria-describedby={`${ids}-why`}>
            {pending && <Spinner />}
            {pending ? "Importing…" : `Import ${picked.length || ""} file${picked.length === 1 ? "" : "s"}`.replace("  ", " ")}
          </Button>
          <p id={`${ids}-why`} className="text-sm text-muted-foreground" data-testid="import-why">
            {pending
              ? "Reading each file on the server. This takes a few seconds."
              : picked.length === 0
                ? "Choose at least one file in step 1."
                : tooBig
                  ? "Too much at once: remove some files."
                  : !authorised
                    ? "Tick the box above to confirm you may use this data."
                    : "Ready to import."}
          </p>
        </div>
      </form>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state && state.results.length > 0 && (
        <section aria-labelledby={`${ids}-read`} className="flex flex-col gap-3" role="status">
          {done > 0 && (
            <div className="rise-in flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-success/25 bg-success-soft px-5 py-4" data-testid="import-done">
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2Icon aria-hidden="true" className="size-5" />
                {done} {done === 1 ? "file" : "files"} added.
              </p>
              <Button asChild>
                <Link href="/ledger">
                  Next: build the ledger
                  <ArrowRightIcon aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
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
