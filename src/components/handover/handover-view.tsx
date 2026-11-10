import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { TRUST_LABELS, STATUS_LABELS, statusLabel } from "@/components/ledger/commitments";
import { loadLatestVersion } from "@/components/review/version-data";
import { ROLE_LABELS, type AppRole } from "@/lib/access";
import { formatIst, formatIstDate } from "@/lib/format";
import {
  ACK_LABELS,
  ackSummary,
  canReplyTo,
  dutyCalendar,
  latestAckByItem,
  peopleWaiting,
  repliesByAck,
  toHandoverItem,
  type AckRow,
  type HandoverItem,
  type ReplyRow,
} from "@/lib/handover/handover";
import { capitalise } from "@/lib/ledger-view";
import type { VersionItem } from "@/lib/review/diff";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acknowledge, replyToAck, sealPlaceholder } from "@/app/handover/actions";
import { AckForm } from "./ack-form";
import { ReplyForm } from "./reply-form";
import { SealForm } from "./seal-form";

const TIMING: Record<string, string> = { overdue: "Overdue", start_now: "Start now", upcoming: "Upcoming", undated: "No date recorded" };
const RELATION: Record<string, string> = { supports: "The promise or duty", fulfils: "Says it was done", contradicts: "Says it was not done", past_instance: "A past time it happened" };

function Trust({ item }: { item: HandoverItem }) {
  const t = item.trust as keyof typeof TRUST_LABELS | null;
  if (!t || !(t in TRUST_LABELS)) return null;
  return <Badge variant={t === "contradicted" || t === "gap" ? "destructive" : "secondary"}>Trust: {TRUST_LABELS[t]}</Badge>;
}

type Ctx = {
  versionId: string;
  me: string;
  role: AppRole;
  acks: Map<string, AckRow>;
  evidence: Map<string, VersionItem["evidence"]>;
  replies: Map<string, ReplyRow[]>;
  roleOf: Map<string, AppRole>;
};

function Replies({ ack, ctx }: { ack: AckRow | undefined; ctx: Ctx }) {
  if (!ack?.id || !canReplyTo(ack)) return null;
  const list = ctx.replies.get(ack.id) ?? [];
  const reviewer = ctx.role === "outgoing_lead" || ctx.role === "advisor";
  if (list.length === 0 && !reviewer) return <p className="mt-1 text-xs text-muted-foreground">No reply yet.</p>;
  return (
    <div className="mt-2 border-l-2 pl-3" data-testid="ack-replies">
      {list.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Replies">
          {list.map((r) => {
            const who = ctx.roleOf.get(r.user_id);
            return (
              <li key={r.id} className="text-xs" data-testid="ack-reply">
                <span className="text-muted-foreground">
                  {r.user_id === ctx.me ? "You" : who ? `The ${ROLE_LABELS[who].toLowerCase()}` : "A reviewer"} replied on {formatIst(r.created_at)}:
                </span>{" "}
                “{r.text}”
              </li>
            );
          })}
        </ul>
      )}
      {reviewer && <ReplyForm action={replyToAck} ack={ack.id} />}
    </div>
  );
}

function AckState({ ack, who }: { ack: AckRow | undefined; who: string }) {
  if (!ack) return <p className="mt-2 text-xs text-muted-foreground">{who} has not answered yet.</p>;
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="ack-state">
      {ACK_LABELS[ack.action]} on {formatIst(ack.created_at)}
      {ack.note ? `: “${ack.note}”` : ""}
    </p>
  );
}

function Card({ item, ctx, facts, timing }: { item: HandoverItem; ctx: Ctx; facts: string; timing?: string }) {
  const ack = ctx.acks.get(item.id);
  const ev = ctx.evidence.get(item.id) ?? [];
  return (
    <li id={`item-${item.id}`} className="rounded-md border p-3 text-sm" data-testid="handover-item">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium">{capitalise(item.description)}</p>
        <span className="flex flex-wrap gap-1">
          {timing && <Badge variant={timing === "overdue" ? "destructive" : timing === "start_now" ? "secondary" : "outline"}>{TIMING[timing]}</Badge>}
          {item.kind === "commitment" && item.status && item.status in STATUS_LABELS && <Badge variant="outline">{statusLabel(item.status as keyof typeof STATUS_LABELS, null)}</Badge>}
          <Trust item={item} />
        </span>
      </div>
      <p className="mt-1 text-muted-foreground">{facts}</p>
      {ev.length === 0 ? (
        <p className="mt-2">No evidence kept.</p>
      ) : (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">Quotes ({ev.length})</summary>
          <ul className="mt-1 flex flex-col gap-2" aria-label="Evidence">
            {ev.map((e, i) => (
              <li key={i}>
                <p className="text-xs text-muted-foreground">{e.relation === "fulfils" && e.inferred ? "Suggests it was done (inferred)" : (RELATION[e.relation] ?? e.relation)}</p>
                <blockquote className="border-l-2 pl-3">“{e.quote}”</blockquote>
              </li>
            ))}
          </ul>
        </details>
      )}
      {ctx.role === "incoming_lead" ? (
        <>
          <AckState ack={ack} who="You" />
          <Replies ack={ack} ctx={ctx} />
          <AckForm action={acknowledge} version={ctx.versionId} obligation={item.id} current={ack?.action ?? null} />
        </>
      ) : (
        <>
          <AckState ack={ack} who="The incoming lead" />
          <Replies ack={ack} ctx={ctx} />
        </>
      )}
    </li>
  );
}

const commitmentFacts = (i: HandoverItem) => `${i.owedBy ?? "Someone"} owes ${i.owedTo ?? "someone"}${i.dueText ? `, ${i.dueText}` : ""}`;
function dutyFacts(i: HandoverItem): string {
  const parts = [
    i.owedBy ? `Owed by ${i.owedBy}` : null,
    i.cadence,
    i.approval ? `needs ${i.approval}${i.approver ? ` from ${i.approver}` : ""}` : null,
    i.nextDue ? `next due ${formatIstDate(`${i.nextDue}T00:00:00+05:30`)}` : null,
    i.startBy ? `start by ${formatIstDate(`${i.startBy}T00:00:00+05:30`)}` : null,
  ];
  return parts.filter(Boolean).join(" · ") || "No details stated";
}

/** The handover as this role may read it: the latest approved version only, filtered by RLS before anything is shown. */
export async function HandoverView({ workspaceId, role, userId, today }: { workspaceId: string; role: AppRole; userId: string; today: string }) {
  const supabase = await createSupabaseServerClient();
  const { version, error: vErr } = await loadLatestVersion(supabase, workspaceId);
  if (vErr) return <p role="alert">Could not load the handover. Try again in a minute.</p>;

  const sealed = await supabase.from("sealed_items").select("id, holder_role, topic_label, obligation_id").eq("workspace_id", workspaceId).order("topic_label");
  if (sealed.error) return <p role="alert">Could not load the handover. Try again in a minute.</p>;

  if (!version) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing has been handed over yet. The faculty advisor must approve a version first; see{" "}
        <Link href="/review?tab=versions" className="underline">
          Review
        </Link>
        .
      </p>
    );
  }

  const [rowsRes, acksRes, releases] = await Promise.all([
    supabase.from("version_items").select("obligation_id, item, access_level").eq("version_id", version.id),
    supabase.from("latest_acks").select("id, obligation_id, user_id, action, note, created_at").eq("version_id", version.id),
    supabase.from("releases").select("target_id, to_role").eq("workspace_id", workspaceId).eq("target_type", "obligation"),
  ]);
  if (rowsRes.error || acksRes.error || releases.error) return <p role="alert">Could not load the handover. Try again in a minute.</p>;

  const evidence = new Map<string, VersionItem["evidence"]>();
  const items: HandoverItem[] = [];
  const levels = new Map<string, string>();
  for (const r of rowsRes.data ?? []) {
    const item = r.item as unknown as VersionItem;
    const h = toHandoverItem(r.obligation_id, item);
    if (!h) continue;
    items.push(h);
    evidence.set(r.obligation_id, item.evidence ?? []);
    levels.set(r.obligation_id, r.access_level);
  }
  const mine = role === "incoming_lead";
  // The incoming lead sees only their own answers; reviewers see the incoming lead's.
  const acks = latestAckByItem((acksRes.data ?? []) as AckRow[], mine ? userId : ((acksRes.data ?? [])[0]?.user_id ?? userId));
  // Replies to the answers shown, and who wrote them (by role, from the workspace's memberships).
  const ackIds = [...acks.values()].map((a) => a.id).filter((x): x is string => Boolean(x));
  const [repliesRes, membersRes] = await Promise.all([
    ackIds.length ? supabase.from("ack_replies").select("id, ack_id, user_id, text, created_at").in("ack_id", ackIds) : Promise.resolve({ data: [] as ReplyRow[], error: null }),
    supabase.from("memberships").select("user_id, role").eq("workspace_id", workspaceId),
  ]);
  if (repliesRes.error || membersRes.error) return <p role="alert">Could not load the handover. Try again in a minute.</p>;
  const replies = repliesByAck((repliesRes.data ?? []) as ReplyRow[]);
  const roleOf = new Map((membersRes.data ?? []).map((m) => [m.user_id, m.role as AppRole]));
  const waiting = peopleWaiting(items);
  const calendar = dutyCalendar(items, today);
  const summary = ackSummary(items.map((i) => i.id), acks);
  const ctx: Ctx = { versionId: version.id, me: userId, role, acks, evidence, replies, roleOf };

  const sealedIds = new Set((sealed.data ?? []).map((s) => s.obligation_id));
  const released = new Set((releases.data ?? []).filter((r) => r.to_role === "incoming_lead").map((r) => r.target_id));
  const reviewer = role === "outgoing_lead" || role === "advisor";
  const sealable = reviewer
    ? items.filter((i) => (levels.get(i.id) === "finance" || levels.get(i.id) === "private") && !sealedIds.has(i.id) && !released.has(i.id)).map((i) => ({ id: i.id, label: capitalise(i.description) }))
    : [];

  const months = new Map<string, typeof calendar>();
  for (const e of calendar) months.set(e.month, [...(months.get(e.month) ?? []), e]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Summary" className="rounded-md border p-4 text-sm" data-testid="handover-summary">
        <h2 className="text-base font-semibold">Version {version.number}</h2>
        <p className="mt-1 text-muted-foreground">
          Approved by the faculty advisor on {formatIst(version.created_at)}. {items.length} {items.length === 1 ? "item" : "items"} you can read.{" "}
          {mine ? "Your answers" : "The incoming lead’s answers"}: {summary.accept} accepted, {summary.question} with a question, {summary.decline} declined, {summary.waiting} waiting.
        </p>
      </section>

      <section aria-labelledby="waiting-h" className="flex flex-col gap-3">
        <h2 id="waiting-h" className="text-xl font-semibold">{mine ? "People waiting on you" : "People waiting on the incoming lead"}</h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open commitments are handed over. Nothing is owed to anyone that you can read about.</p>
        ) : (
          waiting.map((g) => (
            <div key={g.person} className="flex flex-col gap-2" data-testid="waiting-group">
              <h3 className="text-base font-semibold">
                {g.person} <span className="text-sm font-normal text-muted-foreground">({g.items.length})</span>
              </h3>
              <ul className="flex flex-col gap-2" aria-label={`Owed to ${g.person}`}>
                {g.items.map((i) => (
                  <Card key={i.id} item={i} ctx={ctx} facts={commitmentFacts(i)} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="calendar-h" className="flex flex-col gap-3">
        <h2 id="calendar-h" className="text-xl font-semibold">Calendar of recurring duties</h2>
        {calendar.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recurring duties are handed over.</p>
        ) : (
          [...months].map(([month, entries]) => (
            <div key={month} className="flex flex-col gap-2" data-testid="calendar-month">
              <h3 className="text-base font-semibold">{month}</h3>
              <ul className="flex flex-col gap-2" aria-label={month}>
                {entries.map((e) => (
                  <Card key={e.item.id} item={e.item} ctx={ctx} facts={dutyFacts(e.item)} timing={e.timing} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="sealed-h" className="flex flex-col gap-3">
        <h2 id="sealed-h" className="text-xl font-semibold">Sealed items</h2>
        <p className="text-sm text-muted-foreground">Some things are held back for your role. You can see that they exist, who holds them and the topic, never the details. Ask the holder to release them.</p>
        {(sealed.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing is sealed.</p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label="Sealed placeholders" data-testid="sealed-items">
            {(sealed.data ?? []).map((s) => (
              <li key={s.id} className="rounded-md border border-dashed p-3 text-sm" data-testid="sealed-item">
                <strong>{s.topic_label}</strong> <span className="text-muted-foreground">· held by the {ROLE_LABELS[s.holder_role].toLowerCase()}</span>
              </li>
            ))}
          </ul>
        )}
        {reviewer && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Add a sealed placeholder</summary>
            <div className="mt-2">
              <SealForm action={sealPlaceholder} options={sealable} />
            </div>
          </details>
        )}
      </section>
    </div>
  );
}
