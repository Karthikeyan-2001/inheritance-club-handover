import { cookies } from "next/headers";
import { ROLE_LABELS } from "@/lib/access";
import { DEMO_USERS } from "@/lib/demo/demo-users";
import { getViewer } from "@/lib/session";
import { TOUR_COOKIE, TOURS, TRACK_LABELS, currentStop, parseTourCookie } from "@/lib/tour/tour";
import { TourDock } from "./tour-dock";

function person(key: string) {
  const u = DEMO_USERS.find((d) => d.key === key);
  return { name: u?.name ?? key, role: u ? ROLE_LABELS[u.role] : "" };
}

/** The guided tour, when one is running and the visitor is signed in. Must sit inside <Suspense> (it reads cookies). */
export async function TourPanel() {
  const state = parseTourCookie((await cookies()).get(TOUR_COOKIE)?.value);
  if (!state) return null;
  let viewer;
  try {
    viewer = await getViewer();
  } catch {
    return null;
  }
  if (!viewer) return null;

  const stop = currentStop(state);
  const stops = TOURS[state.track];
  const next = stops[state.index + 1];
  const as = person(stop.as);
  // A non-demo account (no key) is never switched; it follows the tour as itself.
  const rightPerson = !viewer.demoKey || viewer.demoKey === stop.as;
  const nextSwitches = next && viewer.demoKey && next.as !== stop.as;
  return (
    <TourDock
      track={state.track}
      trackLabel={TRACK_LABELS[state.track]}
      index={state.index}
      total={stops.length}
      stop={stop}
      asName={as.name}
      asRole={as.role}
      rightPerson={rightPerson}
      nextAsName={nextSwitches ? person(next.as).name : null}
    />
  );
}
