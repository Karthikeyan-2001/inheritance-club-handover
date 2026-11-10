"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/form-state";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const Id = z.uuid("Invalid request.");

const AckInput = z.object({
  version: Id,
  obligation: Id,
  action: z.enum(["accept", "question", "decline"]),
  note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
});

const DONE = { accept: "Accepted.", question: "Your question is recorded.", decline: "Declined. The outgoing team can see why." } as const;

/** Record the incoming lead's answer on one approved item. RLS allows only the incoming lead, only on items they can read. */
export async function acknowledge(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Please sign in first." };
  const input = AckInput.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const { action, note } = input.data;
  if (action !== "accept" && !note) return { error: "Add a note: say what your question is, or why you decline." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("acks").insert({
    version_id: input.data.version,
    obligation_id: input.data.obligation,
    user_id: viewer.userId,
    action,
    note: note || null,
  });
  if (error) {
    return { error: error.code === "42501" ? "Only the incoming lead can answer an item, and only one they can read." : error.code === "23514" ? error.message : "Could not save your answer." };
  }
  refresh();
  return { ok: DONE[action] };
}

const SealInput = z.object({
  obligation: Id,
  holder: z.enum(["advisor", "outgoing_lead"]),
  topic: z.string().trim().min(3, "Give the placeholder a short topic.").max(80, "Keep the topic under 80 characters."),
});

/** Add a sealed placeholder: the holder and a short topic only. The topic is shown to every member, so it must hold no source text. */
export async function sealPlaceholder(_prev: FormState, formData: FormData): Promise<FormState> {
  const viewer = await getViewer();
  if (!viewer?.membership) return { error: "Please sign in first." };
  const input = SealInput.safeParse(Object.fromEntries(formData));
  if (!input.success) return { error: input.error.issues[0]?.message ?? "Invalid request." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("sealed_items").insert({
    workspace_id: viewer.membership.workspaceId,
    obligation_id: input.data.obligation,
    holder_role: input.data.holder,
    topic_label: input.data.topic,
    approved_by: viewer.userId,
  });
  if (error) return { error: error.code === "42501" ? "Only the outgoing lead or the faculty advisor can seal an item." : "Could not add the placeholder." };
  refresh();
  return { ok: "Placeholder added. Everyone can see that something is held back, and by whom." };
}
