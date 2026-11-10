import "server-only";
import { cookies } from "next/headers";
import { TOUR_COOKIE, serializeTour, type TourState } from "@/lib/tour/tour";

const WEEK = 7 * 24 * 60 * 60;

/** Remember where the visitor is in the guided tour. Not a secret: it only names a stop. */
export async function setTourCookie(state: TourState): Promise<void> {
  (await cookies()).set(TOUR_COOKIE, serializeTour(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: WEEK,
  });
}

export async function clearTourCookie(): Promise<void> {
  (await cookies()).delete(TOUR_COOKIE);
}
