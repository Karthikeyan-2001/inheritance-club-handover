import Link from "next/link";
import { ArrowRightIcon, CheckIcon, UsersIcon } from "lucide-react";
import { ErrorState } from "@/components/feedback/error-state";
import { SwitchPersonButton } from "@/components/home/switch-person-button";
import { Button } from "@/components/ui/button";
import { ROLE_LABELS } from "@/lib/access";
import { journey, type JourneyFacts } from "@/lib/journey";
import { needsRereview } from "@/lib/review/rereview";
import type { Viewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type Membership = NonNullable<Viewer["membership"]>;

/**
 * Gathers the facts through the viewer's own session. RLS decides what each count includes, so
 * a role that cannot read the working ledger sees zero there and is guided by the approved
 * versions instead.
 */
async function loadFacts(viewer: Viewer, m: Membership): Promise<JourneyFacts | null> {
  const supabase = await createSupabaseServerClient();
  const ws = m.workspaceId;
  const [files, obligations, docket, signoff, versions] = await Promise.all([
    supabase.from("sources").select("*", { count: "exact", head: true }).eq("workspace_id", ws),
    supabase.from("obligations").select("review_state, status, trust_state, reviewed_status, reviewed_trust").eq("workspace_id", ws),
    supabase.from("docket_entries").select("ruling").eq("workspace_id", ws),
    supabase.rpc("signoff_status", { p_workspace: ws }),
    supabase.from("versions").select("id, number, created_at").eq("workspace_id", ws).order("number", { ascending: false }).limit(1),
  ]);
  if (files.error || obligations.error || docket.error || signoff.error || versions.error) return null;

  const latest = versions.data?.[0] ?? null;
  let version: JourneyFacts["version"] = null;
  let answered = 0;
  if (latest) {
    const [items, acks] = await Promise.all([
      supabase.from("version_items").select("*", { count: "exact", head: true }).eq("version_id", latest.id),
      supabase.from("latest_acks").select("obligation_id, user_id").eq("version_id", latest.id),
    ]);
    if (items.error || acks.error) return null;
    version = { number: latest.number, createdAt: latest.created_at, itemCount: items.count ?? 0 };
    const mine = viewer.membership?.role === "incoming_lead";
    answered = new Set((acks.data ?? []).filter((a) => !mine || a.user_id === viewer.userId).map((a) => a.obligation_id)).size;
  }

  const rows = obligations.data ?? [];
  const changed = rows.filter(needsRereview).length;
  const drafts = rows.filter((r) => r.review_state === "draft").length;
  const mark = signoff.data?.[0] ?? null;
  return {
    role: m.role,
    files: files.count ?? 0,
    items: rows.length,
    toReview: drafts + changed,
    accepted: rows.filter((r) => r.review_state === "accepted" || r.review_state === "edited").length,
    signoff: mark ? { isCurrent: mark.is_current, markedAt: mark.marked_at } : null,
    version,
    answered,
    unruledConflicts: (docket.data ?? []).filter((d) => !d.ruling).length,
  };
}

/** The first thing a signed-in person sees: where the handover stands and the one thing to do next. */
export async function NextStep({ viewer, membership }: { viewer: Viewer; membership: Membership }) {
  const facts = await loadFacts(viewer, membership).catch(() => null);
  if (!facts) {
    return <ErrorState title="Could not work out your next step">The data service did not answer. You can still open any step from the bar above.</ErrorState>;
  }
  const j = journey(facts);
  const percent = Math.round((j.doneCount / j.stages.length) * 100);
  return (
    <section aria-labelledby="next-step" className="rise-in overflow-hidden rounded-3xl border bg-card shadow-md shadow-primary/10" data-testid="next-step">
      <div className="flex flex-col gap-5 bg-gradient-to-br from-lilac/80 via-card to-card p-6 sm:p-8">
        <p className="text-sm font-medium text-primary">
          Your next step · {viewer.name}, {ROLE_LABELS[membership.role].toLowerCase()}
        </p>
        <div className="flex flex-col gap-2">
          <h2 id="next-step" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {j.title}
          </h2>
          <p className="max-w-2xl text-base text-muted-foreground">{j.body}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {j.cta && (
            <Button asChild size="lg">
              <Link href={j.cta.href}>
                {j.cta.label}
                <ArrowRightIcon aria-hidden="true" />
              </Link>
            </Button>
          )}
          {j.switchTo && <SwitchPersonButton personKey={j.switchTo.key} label={j.switchTo.label} primary={!j.cta} inCopy={membership.sandboxExpiresAt !== null} />}
          {j.also.map((a) => (
            <Button key={a.href} asChild variant="outline">
              <Link href={a.href}>{a.label}</Link>
            </Button>
          ))}
        </div>
      </div>
      <div className="border-t bg-card px-6 py-5 sm:px-8">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="font-medium">Handover progress</span>
          <span className="text-muted-foreground" data-testid="progress-count">
            {j.doneCount} of {j.stages.length} steps done
          </span>
        </div>
        <div role="progressbar" aria-label="Handover progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${Math.max(percent, 4)}%` }} />
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-5">
          {j.stages.map((s, i) => (
            <li key={s.key}>
              <Link
                href={s.href}
                aria-current={s.state === "current" ? "step" : undefined}
                className={`flex h-full items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-accent ${s.state === "current" ? "border-primary bg-accent font-semibold text-accent-foreground" : "border-transparent bg-muted/60"}`}
              >
                <span
                  aria-hidden="true"
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${s.state === "done" ? "bg-success text-white" : s.state === "current" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}
                >
                  {s.state === "done" ? <CheckIcon className="size-3" /> : i + 1}
                </span>
                <span>
                  {s.label}
                  <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (next)" : " (later)"}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
        {membership.role === "incoming_lead" || membership.role === "member" || membership.role === "treasurer" ? null : (
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <UsersIcon aria-hidden="true" className="size-3.5" />
            A handover needs three people. Use “Switch person” at the top right to act as the advisor or the incoming lead.
          </p>
        )}
      </div>
    </section>
  );
}
