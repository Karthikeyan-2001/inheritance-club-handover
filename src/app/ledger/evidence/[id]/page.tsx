import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TYPE_LABELS } from "@/components/ledger/obligation-parts";
import { ACCESS_LABELS, type AccessLevel } from "@/lib/access";
import { formatIst } from "@/lib/format";
import { highlightSegments } from "@/lib/pipeline/locate";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Source message · Inheritance" };

type Msg = {
  id: string;
  author: string | null;
  ts: string | null;
  text: string;
  access_level: AccessLevel;
  source_id: string;
  sources: { filename: string; type: keyof typeof TYPE_LABELS } | null;
};

const EVENT_SELECT = "id, author, ts, text, access_level, source_id, sources(filename, type)";
const NEIGHBOURS = 2;

function Message({ msg, quote }: { msg: Msg; quote?: string }) {
  const parts = quote ? highlightSegments(msg.text, quote) : [{ text: msg.text, mark: false }];
  return (
    <article className={quote ? "rounded-md border-2 border-primary p-3 text-sm" : "rounded-md border p-3 text-sm text-muted-foreground"} aria-label={`${msg.author ?? "Unknown"}, ${formatIst(msg.ts)}`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="font-medium text-foreground">{msg.author ?? "Unknown"}</span>
        <span>{formatIst(msg.ts)}</span>
        <Badge variant={msg.access_level === "everyone" ? "outline" : "secondary"}>{ACCESS_LABELS[msg.access_level]}</Badge>
      </div>
      <p className="whitespace-pre-wrap break-words" data-testid={quote ? "source-message" : undefined}>
        {parts.map((p, i) =>
          p.mark ? (
            <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/60">
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
    return <p role="alert">Could not reach the database. Try again in a minute.</p>;
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
    ? await supabase.from("context_items").select("id, quote, text, verified, event_id, obligation_id, obligations(description, kind)").eq("id", id).maybeSingle()
    : await supabase.from("evidence").select("id, quote, verified, event_id, obligation_id, obligations(description, kind)").eq("id", id).maybeSingle();
  if (found.error) return <p role="alert">Could not load the quote. Try again in a minute.</p>;
  // The query shape differs by table; both carry the fields used below.
  const row = found.data as unknown as {
    quote: string | null;
    verified: boolean;
    event_id: string | null;
    obligation_id: string;
    obligations: { description: string; kind: "commitment" | "recurring" } | null;
  } | null;
  if (!row || !row.quote) return <p>That quote is not available to your role. {back}</p>;

  const itemTab = row.obligations?.kind === "recurring" ? "recurring" : "commitments";
  const itemLink = (
    <Link href={`/ledger?tab=${itemTab}#item-${row.obligation_id}`} className="text-sm underline">
      Back to the item
    </Link>
  );

  const { data: msg } = row.event_id ? await supabase.from("events").select(EVENT_SELECT).eq("id", row.event_id).maybeSingle() : { data: null };
  const event = msg as unknown as Msg | null;

  let before: Msg[] = [];
  let after: Msg[] = [];
  if (event?.ts) {
    const [b, a] = await Promise.all([
      supabase.from("events").select(EVENT_SELECT).eq("source_id", event.source_id).lt("ts", event.ts).order("ts", { ascending: false }).limit(NEIGHBOURS),
      supabase.from("events").select(EVENT_SELECT).eq("source_id", event.source_id).gt("ts", event.ts).order("ts", { ascending: true }).limit(NEIGHBOURS),
    ]);
    before = ((b.data ?? []) as unknown as Msg[]).reverse();
    after = (a.data ?? []) as unknown as Msg[];
  }

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
            <Message msg={event} quote={row.quote} />
            {after.map((m) => <Message key={m.id} msg={m} />)}
          </div>
          {!highlightSegments(event.text, row.quote).some((s) => s.mark) && (
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Source message</h1>
      <Suspense fallback={<p className="text-muted-foreground">Loading the source…</p>}>
        <EvidenceContent params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
