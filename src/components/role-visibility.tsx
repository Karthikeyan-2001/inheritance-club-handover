import Link from "next/link";
import { EmptyState } from "@/components/feedback/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ACCESS_LABELS, ACCESS_LEVELS, ROLE_LABELS, clearance, levelRank, type AccessLevel } from "@/lib/access";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TABLES = [
  { table: "obligations", label: "Obligations" },
  { table: "evidence", label: "Evidence quotes" },
  { table: "events", label: "Source messages" },
  { table: "sources", label: "Source files" },
  { table: "context_items", label: "Context items" },
  { table: "docket_entries", label: "Docket entries" },
  { table: "sealed_items", label: "Sealed placeholders" },
  { table: "audit_log", label: "Audit log rows" },
] as const;

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-4 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

/**
 * What the signed-in role can read. Every number comes from a query made with the
 * user's own session, so it is exactly what Postgres RLS returns for that user.
 */
export async function RoleVisibility() {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return (
      <Notice title="Could not reach the database">
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-destructive">The data service is unavailable right now. Try again in a minute.</p>
      </Notice>
    );
  }

  if (!viewer) return null; // the home page shows its own invitation to signed-out visitors

  if (!viewer.membership) {
    return (
      <Notice title="No workspace yet">
        <p>Your account is not a member of any club workspace. If you deleted your demo club, load a new one from the sign-in page.</p>
      </Notice>
    );
  }

  const { role, workspaceName } = viewer.membership;
  const supabase = await createSupabaseServerClient();
  const counts = await Promise.all(
    TABLES.map(async ({ table, label }) => {
      const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
      return { table, label, count: error ? null : (count ?? 0) };
    }),
  );
  const { data: obligations, error: oErr } = await supabase
    .from("obligations")
    .select("id, description, access_level, kind")
    .order("created_at");

  const max = clearance(role);
  const readable = ACCESS_LEVELS.filter((l) => levelRank(l) <= levelRank(max));

  return (
    <Card className="rise-in">
      <CardHeader>
        <CardTitle className="text-lg">
          What {ROLE_LABELS[role].toLowerCase()} {viewer.name} can read
        </CardTitle>
        <CardDescription>
          {workspaceName}. Readable levels: {readable.map((l) => ACCESS_LABELS[l]).join(", ")}
          {role === "outgoing_lead" && ", plus private items built only from files you uploaded"}
          {role !== "advisor" && ", plus anything explicitly released to your role"}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 md:grid-cols-2">
        <table className="w-full self-start text-sm">
          <caption className="mb-2 text-left font-medium">Rows visible to this role</caption>
          <tbody>
            {counts.map((c) => (
              <tr key={c.table} className="border-b last:border-0">
                <th scope="row" className="py-1.5 text-left font-normal">{c.label}</th>
                <td className="py-1.5 text-right font-mono tabular-nums" data-testid={`count-${c.table}`}>
                  {c.count ?? "error"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="text-sm">
          <h2 className="mb-2 font-medium">Obligations you can read</h2>
          {oErr ? (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-destructive">Could not load obligations. Try again in a moment.</p>
          ) : !obligations?.length ? (
            <EmptyState title="Nothing visible to this role" body="Items appear here once the advisor approves a version, or when the outgoing lead releases one to you." />
          ) : (
            <ul className="flex flex-col gap-2" data-testid="visible-obligations">
              {obligations.map((o) => (
                <li key={o.id} className="flex items-start justify-between gap-3">
                  <span>{o.description}</span>
                  <LevelChip level={o.access_level} />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button asChild size="sm">
            <Link href="/import">{role === "outgoing_lead" || role === "advisor" ? "Add files" : "See imported files"}</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/ledger?tab=timeline">Open the timeline</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function LevelChip({ level }: { level: AccessLevel }) {
  return (
    <Badge variant={level === "everyone" ? "outline" : "secondary"} className="shrink-0">
      {ACCESS_LABELS[level]}
    </Badge>
  );
}
