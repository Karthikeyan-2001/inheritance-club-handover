import { deleteAlias, saveAlias } from "@/app/import/actions";
import { ActionForm } from "@/components/action-form";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Names that refer to the same person or organisation, used later for matching. */
export async function AliasEditor({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const supabase = await createSupabaseServerClient();
  const [{ data: aliases }, { data: authors }] = await Promise.all([
    supabase.from("aliases").select("id, canonical, variants, kind").eq("workspace_id", workspaceId).order("canonical"),
    supabase.rpc("event_authors", { p_workspace: workspaceId }),
  ]);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h3 className="font-medium">Known aliases</h3>
        {!aliases?.length ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" aria-label="Aliases">
            {aliases.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <span>
                  <span className="font-medium">{a.canonical}</span>
                  <span className="text-muted-foreground"> ({a.kind === "org" ? "organisation" : "person"}) also written as </span>
                  {a.variants.join(", ")}
                </span>
                {canEdit && (
                  <ActionForm action={deleteAlias} submitLabel="Remove" variant="outline" className="flex items-center gap-2">
                    <input type="hidden" name="aliasId" value={a.id} />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <ActionForm action={saveAlias} submitLabel="Add alias" className="flex flex-col gap-2 rounded-md border p-3 text-sm">
            <label className="flex flex-col gap-1">
              Name to use
              <input name="canonical" required className="rounded-md border bg-background px-2 py-1" placeholder="Mr. Bala" />
            </label>
            <label className="flex flex-col gap-1">
              Other ways it is written (comma separated)
              <input name="variants" required className="rounded-md border bg-background px-2 py-1" placeholder="Bala sir, lab incharge" />
            </label>
            <label className="flex flex-col gap-1">
              Kind
              <select name="kind" className="rounded-md border bg-background px-2 py-1" defaultValue="person">
                <option value="person">Person</option>
                <option value="org">Organisation</option>
              </select>
            </label>
          </ActionForm>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="font-medium">Names seen in files you can read</h3>
        {!authors?.length ? (
          <p className="text-sm text-muted-foreground">No messages imported yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm" aria-label="Authors seen">
            {authors.slice(0, 40).map((a) => (
              <li key={a.author} className="rounded-full border px-2 py-0.5">
                {a.author} <span className="text-muted-foreground">({a.events})</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
