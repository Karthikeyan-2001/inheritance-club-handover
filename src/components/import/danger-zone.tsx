import { deleteWorkspace } from "@/app/import/actions";
import { ActionForm } from "@/components/action-form";

export function DangerZone({ workspaceName, isDemo, isCopy }: { workspaceName: string; isDemo: boolean; isCopy: boolean }) {
  if (isDemo) {
    return (
      <p className="text-sm text-muted-foreground">
        This is the shared demo club, so it cannot be deleted here; it is reset by the administrator. In your own club workspace, this
        section deletes the workspace and everything in it, including approved versions and the audit log.
      </p>
    );
  }
  return (
    <details>
      <summary className="cursor-pointer text-sm">Delete this workspace…</summary>
      <ActionForm action={deleteWorkspace} submitLabel="Delete workspace permanently" variant="destructive" className="mt-3 flex max-w-md flex-col gap-2 text-sm" confirm={{ title: "Delete this workspace?", description: <>Everything in <strong>{workspaceName}</strong> is removed for good, including approved versions and the audit log.</>, confirmLabel: "Yes, delete everything" }}>
        <p>
          This removes every file, message, obligation, approved version and audit entry in <strong>{workspaceName}</strong>. It cannot be undone.
        </p>
        {isCopy && <p>This is your own demo club, so its four accounts are deleted too and you are signed out.</p>}
        <label className="flex flex-col gap-1">
          Type the workspace name to confirm
          <input name="confirmName" required autoComplete="off" className="rounded-md border bg-background px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          Reason
          <input name="reason" required minLength={3} className="rounded-md border bg-background px-2 py-1" />
        </label>
      </ActionForm>
    </details>
  );
}
