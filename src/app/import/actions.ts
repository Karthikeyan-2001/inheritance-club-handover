"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ACCESS_LEVELS } from "@/lib/access";
import type { FormState } from "@/lib/form-state";
import { sha256Hex } from "@/lib/hash";
import { MAX_TOTAL_BYTES } from "@/lib/import/defaults";
import { ParseError, parseUpload, sourceTypeFor, type ReadSummary } from "@/lib/parsers";
import { forgetDeletedCopy } from "@/lib/demo/sandbox-server";
import { getViewer, type Viewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FileResult =
  | { filename: string; ok: true; accessLevel: (typeof ACCESS_LEVELS)[number]; summary: ReadSummary }
  | { filename: string; ok: false; error: string };
export type ImportState = { results: FileResult[]; error?: string } | null;

const AccessLevel = z.enum(ACCESS_LEVELS);
const DateOrder = z.enum(["auto", "day", "month"]).catch("auto");

type Member = Viewer & { membership: NonNullable<Viewer["membership"]> };

async function requireMember(): Promise<Member | string> {
  const viewer = await getViewer();
  if (!viewer) return "Please sign in first.";
  if (!viewer.membership) return "Your account is not a member of a workspace.";
  return viewer as Member;
}

function dbMessage(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === "23505") return "This exact file has already been imported into this workspace.";
  if (error.code === "42501") return error.message.charAt(0).toUpperCase() + error.message.slice(1) + ".";
  if (error.code === "23514" || error.code === "22023") return error.message;
  return fallback;
}

/**
 * Parse each uploaded file and save it with its events in one transaction, as the signed-in
 * user. RLS decides whether that is allowed. The raw file is not stored, only its events,
 * its "what was read" summary and its SHA-256.
 */
export async function importFiles(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const me = await requireMember();
  if (typeof me === "string") return { results: [], error: me };
  if (formData.get("authorised") !== "on") {
    return { results: [], error: "Please confirm that you are authorised to use these files." };
  }
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { results: [], error: "Choose at least one file to import." };
  const total = files.reduce((n, f) => n + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    return { results: [], error: "These files are too large to import together (limit about 3.9 MB). Import them one at a time, or split a long chat export." };
  }

  const supabase = await createSupabaseServerClient();
  const results: FileResult[] = [];
  for (const [i, file] of files.entries()) {
    const filename = file.name;
    const type = sourceTypeFor(filename);
    const level = AccessLevel.safeParse(formData.get(`access_${i}`));
    if (!type) {
      results.push({ filename, ok: false, error: "Unsupported file type. Use a WhatsApp .txt, a Trello .json, or minutes as .md or .docx." });
      continue;
    }
    if (!level.success) {
      results.push({ filename, ok: false, error: "Choose who may see this file." });
      continue;
    }
    const order = DateOrder.parse(formData.get(`dateOrder_${i}`));
    const bytes = new Uint8Array(await file.arrayBuffer());

    let parsed;
    try {
      parsed = await parseUpload(filename, bytes, {
        whatsapp: order === "auto" ? {} : { daysFirst: order === "day" },
      });
    } catch (err) {
      results.push({ filename, ok: false, error: err instanceof ParseError ? err.message : "This file could not be read." });
      continue;
    }

    const { error } = await supabase.rpc("import_source", {
      p_workspace: me.membership.workspaceId,
      p_type: type,
      p_filename: filename,
      p_access: level.data,
      p_sha256: sha256Hex(bytes),
      p_summary: parsed.summary,
      p_events: parsed.events.map((e) => ({ author: e.author, ts: e.ts, text: e.text, thread_id: e.threadId, meta: e.meta })),
      p_reason: "Imported by the uploader, who confirmed they are authorised to use this data",
    });
    if (error) {
      results.push({ filename, ok: false, error: dbMessage(error, "The file was read but could not be saved. Nothing was imported.") });
      continue;
    }
    results.push({ filename, ok: true, accessLevel: level.data, summary: parsed.summary });
  }
  refresh();
  return { results };
}

const RemoveSource = z.object({ sourceId: z.uuid(), reason: z.string().trim().min(3, "Give a short reason.") });

export async function removeSource(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = RemoveSource.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("remove_source", { p_source: input.data.sourceId, p_reason: input.data.reason });
  if (error) return { error: dbMessage(error, "Could not remove the file.") };
  refresh();
  return { ok: "File and its messages removed." };
}

const SaveAlias = z.object({
  canonical: z.string().trim().min(1, "Enter the name to use.").max(80),
  variants: z.string().max(500),
  kind: z.enum(["person", "org"]),
});

export async function saveAlias(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const input = SaveAlias.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid alias." };
  const variants = [...new Set(input.data.variants.split(",").map((v) => v.trim()).filter(Boolean))].filter(
    (v) => v.toLowerCase() !== input.data.canonical.toLowerCase(),
  );
  if (variants.length === 0) return { error: "Add at least one other name, separated by commas." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("aliases").insert({
    workspace_id: me.membership.workspaceId,
    canonical: input.data.canonical,
    variants,
    kind: input.data.kind,
  });
  if (error) return { error: error.code === "42501" ? "Only the outgoing lead or advisor can edit aliases." : "Could not save the alias." };
  refresh();
  return { ok: `Saved: ${variants.join(", ")} → ${input.data.canonical}` };
}

export async function deleteAlias(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  const id = z.uuid().safeParse(formData.get("aliasId"));
  if (!id.success) return { error: "Invalid alias." };
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("aliases").delete().eq("id", id.data).select("id");
  if (error || !data?.length) return { error: "Could not remove the alias (only the outgoing lead or advisor can)." };
  refresh();
  return { ok: "Alias removed." };
}

export async function deleteWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireMember();
  if (typeof me === "string") return { error: me };
  if (String(formData.get("confirmName") ?? "").trim() !== me.membership.workspaceName) {
    return { error: "Type the workspace name exactly to confirm." };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 3) return { error: "Give a short reason." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("delete_workspace", { p_workspace: me.membership.workspaceId, p_reason: reason });
  if (error) return { error: dbMessage(error, "Could not delete the workspace.") };
  if (me.membership.sandboxExpiresAt) {
    // A visitor's own demo copy: its accounts go too, and the visitor is signed out.
    await forgetDeletedCopy(me.membership.workspaceId);
    redirect("/login?notice=copy-deleted");
  }
  redirect("/");
}
