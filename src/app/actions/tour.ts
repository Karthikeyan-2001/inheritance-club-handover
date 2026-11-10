"use server";

import { redirect } from "next/navigation";
import { switchDemoUser } from "@/lib/demo/switch-user";
import { safeNextPath } from "@/lib/safe-next";
import { getViewer } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentStop, stopHref, tourState, type TourState, type TourStop } from "@/lib/tour/tour";
import { clearTourCookie, setTourCookie } from "@/lib/tour/tour-cookie";

/** The first verified quote the (new) session may read, preferring a corroborated promise. Through RLS. */
async function firstEvidenceHref(): Promise<string> {
  const supabase = await createSupabaseServerClient();
  const base = () =>
    supabase
      .from("evidence")
      .select("id, obligations!inner(kind, trust_state)")
      .eq("verified", true)
      .eq("relation", "supports")
      .eq("obligations.kind", "commitment")
      .limit(1);
  const { data: best } = await base().eq("obligations.trust_state", "corroborated");
  const id = best?.[0]?.id ?? (await base()).data?.[0]?.id;
  // Nothing built yet: the ledger page, where the tour panel offers to go back a step.
  return id ? `/ledger/evidence/${id}` : "/ledger";
}

async function hrefFor(stop: TourStop): Promise<string> {
  if (stop.resolve === "first-evidence") return firstEvidenceHref();
  return stopHref(stop);
}

/**
 * Move the tour to a stop: remember it, sign in as the account the stop is seen as (in the
 * visitor's own copy, or among the shared accounts), and open its page. Every sign-in is a
 * real session, so each page is read under that role's RLS.
 */
async function go(state: TourState): Promise<never> {
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    redirect("/login?error=sign-in-failed");
  }
  if (!viewer) redirect("/login");

  const stop = currentStop(state);
  if (viewer.demoKey && viewer.demoKey !== stop.as) {
    const problem = await switchDemoUser(stop.as, viewer.membership?.sandboxExpiresAt ? "mine" : "shared");
    if (problem) redirect(`/login?error=${problem}`);
  }

  await setTourCookie(state);
  redirect(await hrefFor(stop));
}

/** Start a track at its first stop. */
export async function startTour(form: FormData): Promise<void> {
  const state = tourState(form.get("track"), 0);
  if (!state) redirect("/guide");
  await go(state);
}

/** Back, Next, or "return to this step". The form names the track and the stop. */
export async function goToTourStop(form: FormData): Promise<void> {
  const state = tourState(form.get("track"), form.get("index"));
  if (!state) redirect("/guide");
  await go(state);
}

/** Leave the tour and stay on the page. */
export async function endTour(form: FormData): Promise<void> {
  await clearTourCookie();
  redirect(safeNextPath(form.get("next")));
}
