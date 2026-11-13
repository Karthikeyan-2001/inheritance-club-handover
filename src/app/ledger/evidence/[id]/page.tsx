import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoadingBlock } from "@/components/feedback/loading-block";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABELS } from "@/components/ledger/obligation-parts";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { formatIst } from "@/lib/format";
import { locateQuote, segmentsFor, type QuoteSpan } from "@/lib/pipeline/locate";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorState } from "@/components/feedback/error-state";

export const metadata: Metadata = { title: "Source message · Inheritance" };

type Msg = {
  id: string;
  author: string | null;
  ts: string | null;
  text: string;
  access_level: AccessLevel;
  source_id: string;
  seq: number;
  sources: { filename: string; type: keyof typeof TYPE_LABELS } | null;
};

const EVENT_SELECT = "id, author, ts, text, access_level, source_id, seq, sources(filename, type)";
const NEIGHBOURS = 2;

function Message({ msg, span, quoted }: { msg: Msg; span?: QuoteSpan | null; quoted?: boolean }) {
  const parts = segmentsFor(msg.text, span ?? null);
  return (
    <article className={quoted ? "rounded-xl border-2 border-primary bg-accent/50 p-4 text-sm" : "rounded-xl border bg-card p-4 text-sm text-muted-foreground"} aria-label={`${msg.author ?? "Unknown"}, ${formatIst(msg.ts)}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{msg.author ?? "Unknown"}</span>
        <span>{formatIst(msg.ts)}</span>
        <Badge variant={msg.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[msg.access_level]}</Badge>
      </div>
      <p className="whitespace-pre-wrap break-words" data-testid={quoted ? "source-message" : undefined}>
        {parts.map((p, i) =>
          p.mark ? (
            <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-foreground underline decoration-warning decoration-2 underline-offset-2">
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
    </article>
  );
}

async function EvidenceContent({ params, searchParams }: { params: PageProps<"/ledger/evidence/[id]">["params"]; searchParams: PageProps<"/ledger/evidence/[id]">["searchParams"] }) {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return <ErrorState title="Could not reach the database">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  }
  if (!viewer) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p>Sign in to see the source.</p>
        <Button asChild>
          <Link href="/login">Choose a demo account</Link>
        </Button>
      </div>
    );
  }
  const { id } = await params;
  const sp = await searchParams;
  const isContext = sp.kind === "context";
  const back = <Link href="/ledger" className="text-sm underline">Back to the ledger</Link>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return <p>That quote does not exist. {back}</p>;

  const supabase = await createSupabaseServerClient();
  // RLS decides whether this quote, its item and its message are readable at all.
  const found = isContext
    ? await supabase.from("context_items").select("id, quote, verified, event_id, obligation_id, obligations(description, kind)").eq("id", id).maybeSingle()
    : await supabase.from("evidence").select("id, quote, verified, event_id, obligation_id, obligations(description, kind)").eq("id", id).maybeSingle();
  if (found.error) return <ErrorState title="Could not load the quote">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  // The query shape differs by table; both carry the fields used below.
  const row = found.data as unknown as {
    quote: string | null;
    verified: boolean;
    event_id: string | null;
    obligation_id: string;
    obligations: { description: string; kind: "commitment" | "recurring" } | null;
  } | null;
  if (!row) return <p>That quote is not available to your role. {back}</p>;
  if (!row.quote) return <p>No quote is kept for this note. {back}</p>;

  const itemTab = row.obligations?.kind === "recurring" ? "recurring" : "commitments";
  const itemLink = (
    <Link href={`/ledger?tab=${itemTab}#item-${row.obligation_id}`} className="text-sm underline">
      Back to the item
    </Link>
  );

  const msgResult = row.event_id ? await supabase.from("events").select(EVENT_SELECT).eq("id", row.event_id).maybeSingle() : { data: null, error: null };
  // An error is not the same as "your role cannot read it": say which one it is.
  if (msgResult.error) return <ErrorState title="Could not load the source message">Nothing was changed. Try again in a minute, or reload the page.</ErrorState>;
  const event = msgResult.data as unknown as Msg | null;

  // Neighbours in the same file, in the file's own order (seq), so messages sent in the same
  // minute, or minutes sections sharing a date, appear as they were written. RLS filters them.
  let before: Msg[] = [];
  let after: Msg[] = [];
  let neighboursFailed = false;
  if (event) {
    const [b, a] = await Promise.all([
      supabase.from("events").select(EVENT_SELECT).eq("source_id", event.source_id).lt("seq", event.seq).order("seq", { ascending: false }).limit(NEIGHBOURS),
      supabase.from("events").select(EVENT_SELECT).eq("source_id", event.source_id).gt("seq", event.seq).order("seq", { ascending: true }).limit(NEIGHBOURS),
    ]);
    neighboursFailed = Boolean(b.error || a.error);
    before = ((b.data ?? []) as unknown as Msg[]).reverse();
    after = (a.data ?? []) as unknown as Msg[];
  }
  const span = event ? locateQuote(event.text, row.quote) : null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        {row.obligations ? <>For: {row.obligations.description}. </> : null}
        {itemLink}
      </p>
      <blockquote className="border-l-2 pl-3 text-sm">“{row.quote}”</blockquote>
      {event ? (
        <>
          <p className="text-sm text-muted-foreground">
            {event.sources ? `${TYPE_LABELS[event.sources.type]} · ${event.sources.filename}. ` : ""}
            {row.verified ? "The quote was checked against this message by code. " : "This quote was not verified. "}
            The highlighted words are the quote; the messages around it are shown for context. Times are IST.
          </p>
          <div className="flex flex-col gap-2" data-testid="source-thread">
            {before.map((m) => <Message key={m.id} msg={m} />)}
            <Message msg={event} span={span} quoted />
            {after.map((m) => <Message key={m.id} msg={m} />)}
          </div>
          {neighboursFailed && (
            <p className="text-sm" role="alert">Could not load the messages around it. Try again in a minute.</p>
          )}
          {!span && (
            <p className="text-sm text-muted-foreground" role="status">The quote could not be placed in this message, so nothing is highlighted.</p>
          )}
        </>
      ) : (
        <p className="rounded-md border p-3 text-sm" role="status">
          The quote was shared with your role, but the full message is not visible to you.
        </p>
      )}
    </div>
  );
}

export default function EvidencePage(props: PageProps<"/ledger/evidence/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader title="Source message" purpose="The original message behind a quote, with the messages around it, so you can judge the claim for yourself." />
      <Suspense fallback={<LoadingBlock label="Finding the source message…" variant="list" rows={3} />}>
        <EvidenceContent params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
