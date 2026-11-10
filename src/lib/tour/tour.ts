// The guided demo tour: an ordered list of stops per track, and pure helpers over them.
// Server actions (src/app/actions/tour.ts) move between stops and switch role; the tour
// panel (src/components/tour/) renders the current stop and highlights its target.

import type { DemoUserKey } from "../demo/demo-users.ts";
import type { Step } from "../steps.ts";

export type TourTrack = "built" | "files";
export const TOUR_TRACKS: readonly TourTrack[] = ["built", "files"];
export const TOUR_COOKIE = "inheritance_tour";

export const TRACK_LABELS: Record<TourTrack, string> = {
  built: "Explore a built handover",
  files: "Build one from your own files",
};

/** How the "go to this stop" action finds a page whose address depends on the data. */
export type TourResolver = "first-evidence";

export type TourStop = {
  id: string;
  /** The workflow step the stop belongs to, or null for the opening and closing stops. */
  step: Step | null;
  title: string;
  body: readonly string[];
  /** Something to do on this page. Optional; the tour never waits for it. */
  tryThis?: string;
  /** The page. With `prefix`, any page under it counts (the evidence pages). */
  path: string;
  tab?: string;
  prefix?: boolean;
  resolve?: TourResolver;
  /** Who the stop is seen as. The tour signs in as this account when it moves here. */
  as: DemoUserKey;
  /** A CSS selector for the element the stop talks about (the first match). Ringed and scrolled into view. */
  highlight?: string;
};

const PIPELINE = 'section[aria-labelledby="pipeline-heading"]';
const FIRST_COMMITMENT = '[data-testid="commitments"] > li:first-child';
const SOURCES = 'ul:has(> [data-testid="source-row"])';
const COUNTS = 'tr:has(> [data-testid="count-obligations"])';
const SIGNOFF = '[data-testid="signoff"]';
const WAITING = '[data-testid="waiting-group"]';

const evidenceStop: TourStop = {
  id: "evidence",
  step: "Verify",
  title: "Step 3, Verify: every claim opens on its source",
  body: [
    "This is the original message behind one quote, with the quoted words highlighted and the messages either side of it for context.",
    "Before any item was stored, code (not the model) checked that its quote really appears in this message. Items whose quote failed the check were dropped and counted.",
  ],
  tryThis: "Go back to the ledger and press Open source message on any other quote.",
  path: "/ledger/evidence/",
  prefix: true,
  resolve: "first-evidence",
  as: "arun",
  highlight: '[data-testid="source-message"]',
};

const docketStop: TourStop = {
  id: "docket",
  step: "Verify",
  title: "Records that disagree",
  body: [
    "The Docket lists items where two records contradict each other, for example a Trello card moved to Done while the chat says it was not done. Both quotes are shown side by side.",
    "A contradicted item is never quietly settled one way. It waits for the advisor to rule on it.",
  ],
  path: "/ledger",
  tab: "docket",
  as: "arun",
  highlight: '[data-testid="docket"] > li:first-child',
};

const gapsStop: TourStop = {
  id: "gaps",
  step: "Verify",
  title: "What is missing",
  body: [
    "Gaps are promises with no follow-up in any record, and duties with no stated approver or date. They are shown as No evidence kept, never guessed as done or pending.",
  ],
  path: "/ledger",
  tab: "gaps",
  as: "arun",
  highlight: '[data-testid="gaps"] > li:first-child',
};

const BUILT: readonly TourStop[] = [
  {
    id: "welcome",
    step: null,
    title: "Your demo club is ready",
    body: [
      "This is a year of a made-up IoT club's records. They have already been imported, built into a ledger and approved as version 1, so you start with a finished handover rather than an empty screen.",
      "This tour goes through the five steps in order (Connect, Reconstruct, Verify, Review, Handover) and shows what each one did. You are Arun, the outgoing lead. When a step is seen by someone else, the tour signs you in as them.",
    ],
    tryThis: "These counts are what the database returns to Arun's own session. You will compare them with another role at the end.",
    path: "/",
    as: "arun",
    highlight: COUNTS,
  },
  {
    id: "connect",
    step: "Connect",
    title: "Step 1, Connect: the sources and who may read them",
    body: [
      "Five files were imported: a volunteers chat (everyone), a committee chat and the Trello board (committee), finance minutes (finance), and Dr. Meena's private chat (private). Each file's access level was chosen when it was imported.",
      "Arun sees four files. Dr. Meena's private chat is not hidden on screen: the database never returns it to him.",
    ],
    path: "/import",
    as: "arun",
    highlight: SOURCES,
  },
  {
    id: "build",
    step: "Reconstruct",
    title: "Step 2, Reconstruct: building the ledger",
    body: [
      "In your own club you would press Build the ledger here. The model reads only messages Arun may read, a few at a time, and proposes promises and duties. Code checks every one before it is stored.",
      "For this club the build already ran once, through this same path, so you do not have to wait for it.",
    ],
    path: "/ledger",
    as: "arun",
    highlight: PIPELINE,
  },
  {
    id: "commitments",
    step: "Reconstruct",
    title: "A promise, and how far to trust it",
    body: [
      "Each card is a promise: who owes whom, what, by when, and what happened next. The badge is its trust state, set by a fixed rule and never by the model.",
      "Corroborated means two independent records agree. Sourced means one verified quote. Inferred means completion is only implied, and it is never shown as fact. Contradicted means the records disagree. A gap means no evidence was kept.",
    ],
    tryThis: "Open the trust legend above the list to see the rule in full.",
    path: "/ledger",
    tab: "commitments",
    as: "arun",
    highlight: FIRST_COMMITMENT,
  },
  {
    id: "recurring",
    step: "Reconstruct",
    title: "Duties that come round again",
    body: [
      "Recurring duties are things the club does every semester or every year, with the approval each one needs, when it is next due, and when to start so the approval arrives in time.",
    ],
    path: "/ledger",
    tab: "recurring",
    as: "arun",
    highlight: '[data-testid="recurring"] > li:first-child',
  },
  evidenceStop,
  docketStop,
  gapsStop,
  {
    id: "review-drafts",
    step: "Review",
    title: "Step 4, Review: a person checks what the model found",
    body: [
      "Version 1 is already approved, but a few items are still drafts. The model found them and a person has to check them. Some are the model's mistakes, for example a report of something done, read as a promise.",
      "Nothing in Draft reaches the incoming lead. Accepting or rejecting needs a reason, and every action is written to the audit log.",
    ],
    tryThis: "Accept or reject one or two drafts.",
    path: "/review",
    tab: "draft",
    as: "arun",
    highlight: '[data-testid="group-draft"] [data-testid="review-item"]',
  },
  {
    id: "mark-ready",
    step: "Review",
    title: "The outgoing lead signs off first",
    body: [
      "When Arun is happy with the ledger, he marks it ready for the advisor. The mark covers exactly what he saw. If anything changes afterwards, he has to mark it again.",
    ],
    tryThis: "Press Mark ready for the advisor. The next steps need it.",
    path: "/review",
    tab: "draft",
    as: "arun",
    highlight: SIGNOFF,
  },
  {
    id: "conflicts",
    step: "Review",
    title: "The advisor rules on disagreements",
    body: [
      "You are now Dr. Meena, the faculty advisor. She sees every file, including her own private chat.",
      "On Conflicts she can rule on each disagreement. A ruling records her decision. It does not change the item's trust state, which still comes from the records.",
    ],
    tryThis: "Rule on one conflict.",
    path: "/review",
    tab: "conflicts",
    as: "meena",
    highlight: '[data-testid="conflict"]',
  },
  {
    id: "approve",
    step: "Review",
    title: "The advisor approves a version",
    body: [
      "Approving Arun's current mark makes version 2. Approved versions can never be edited, only replaced by a newer one.",
      "If the panel says the mark is missing or out of date, go back to the Mark ready step.",
    ],
    tryThis: "Press Approve this version.",
    path: "/review",
    tab: "draft",
    as: "meena",
    highlight: SIGNOFF,
  },
  {
    id: "history",
    step: "Review",
    title: "Every review action is on record",
    body: [
      "The History tab lists every review action: who did it, what they did, the reason they gave, and the item before and after.",
    ],
    path: "/review",
    tab: "history",
    as: "meena",
    highlight: '[data-testid="history-row"]',
  },
  {
    id: "handover",
    step: "Handover",
    title: "Step 5, Handover: what the incoming lead receives",
    body: [
      "You are now Kavya, the incoming lead. She never sees the working ledger, only what has been approved.",
      "People waiting on you groups the open promises by the person owed. For each one, Kavya can accept it, ask a question or decline it.",
    ],
    tryThis: "Ask a question on one item. Arun replies to it at the end of this step.",
    path: "/handover",
    as: "kavya",
    highlight: WAITING,
  },
  {
    id: "calendar",
    step: "Handover",
    title: "The calendar of recurring duties",
    body: [
      "Each recurring duty appears under the month it is due, with whose approval it needs and a Start now flag when the lead time has begun.",
    ],
    path: "/handover",
    as: "kavya",
    highlight: '[data-testid="calendar-month"]',
  },
  {
    id: "sealed",
    step: "Handover",
    title: "Sealed items",
    body: [
      "A sealed placeholder tells Kavya that a finance or private matter exists without showing any of its text. Placeholders come from a separate table that holds no source text at all.",
    ],
    path: "/handover",
    as: "kavya",
    highlight: 'section[aria-labelledby="sealed-h"]',
  },
  {
    id: "reply",
    step: "Handover",
    title: "The outgoing lead answers",
    body: [
      "You are Arun again. He sees Kavya's answers on each item and can reply to her questions and declines. Replies are kept with the item and audited.",
    ],
    tryThis: "If you asked a question as Kavya, reply to it here.",
    path: "/handover",
    as: "arun",
    highlight: WAITING,
  },
  {
    id: "roles",
    step: null,
    title: "Same club, different role",
    body: [
      "You are now Divya, the treasurer. Compare these counts with Arun's at the start of the tour. Divya reads finance items. Kavya reads approved versions only. Only Dr. Meena reads her private chat.",
      "These differences come from Postgres row-level security on every table, not from hiding things on screen. That is the end of the tour. Switch roles from the menu at the top right, or start the other tour from the Walkthrough page.",
    ],
    path: "/",
    as: "divya",
    highlight: COUNTS,
  },
];

const FILES: readonly TourStop[] = [
  {
    id: "import",
    step: "Connect",
    title: "Step 1, Connect: import the sample files",
    body: [
      "Your club is empty and you are Arun, the outgoing lead. Download the photography club's four sample files from this page, choose them all, and set each one to the access level shown next to its link.",
      "Tick the authorisation box and import. The access level decides who may ever read each file and anything built from it.",
    ],
    tryThis: "Import all four files, then press Next.",
    path: "/import",
    as: "arun",
    highlight: 'main form:has(input[type="file"])',
  },
  {
    id: "imported",
    step: "Connect",
    title: "What was read",
    body: [
      "Each imported file is listed with its level and how many messages were read from it. Removing a file also removes its messages, and that is audited too.",
    ],
    path: "/import",
    as: "arun",
    highlight: SOURCES,
  },
  {
    id: "build",
    step: "Reconstruct",
    title: "Step 2, Reconstruct: build the ledger",
    body: [
      "Press Build the ledger. The model (Claude Haiku, through one adapter) reads only messages Arun may read, a few at a time, and the progress bar shows each stage. It takes two or three minutes.",
      "Everything the model proposes is checked by code before it is stored, and arrives as a draft.",
    ],
    tryThis: "Press Build the ledger and wait for it to finish.",
    path: "/ledger",
    as: "arun",
    highlight: PIPELINE,
  },
  {
    id: "commitments",
    step: "Reconstruct",
    title: "Read the ledger",
    body: [
      "Each card is a promise (who owes whom, what, by when) or a recurring duty (how often, whose approval, when to start). The badge is its trust state, set by a fixed rule and never by the model.",
    ],
    tryThis: "Open the Recurring tab too.",
    path: "/ledger",
    tab: "commitments",
    as: "arun",
    highlight: FIRST_COMMITMENT,
  },
  evidenceStop,
  docketStop,
  gapsStop,
  {
    id: "review-drafts",
    step: "Review",
    title: "Step 4, Review: check every draft",
    body: [
      "Everything the build found is a draft. Accept the items that are right and reject the ones that are wrong. Each action needs a reason and is written to the audit log.",
    ],
    tryThis: "Accept or reject the drafts, then press Mark ready for the advisor.",
    path: "/review",
    tab: "draft",
    as: "arun",
    highlight: '[data-testid="group-draft"] [data-testid="review-item"]',
  },
  {
    id: "approve",
    step: "Review",
    title: "The advisor approves",
    body: [
      "You are now Dr. Meena, the faculty advisor. Approving Arun's mark makes version 1. Approved versions can never be edited, only replaced.",
      "If the panel says the mark is missing, go back one step and mark the ledger ready as Arun.",
    ],
    tryThis: "Press Approve this version.",
    path: "/review",
    tab: "draft",
    as: "meena",
    highlight: SIGNOFF,
  },
  {
    id: "handover",
    step: "Handover",
    title: "Step 5, Handover: what the incoming lead receives",
    body: [
      "You are now Kavya, the incoming lead. She sees the approved version only: the people waiting on her, a calendar of recurring duties, and sealed placeholders for matters she may not read.",
    ],
    tryThis: "Accept one item and ask a question on another.",
    path: "/handover",
    as: "kavya",
    highlight: WAITING,
  },
  {
    id: "reply",
    step: "Handover",
    title: "The outgoing lead answers",
    body: [
      "You are Arun again. He sees Kavya's answers and can reply to her questions. That is the end of the tour. Switch roles from the menu at the top right to compare what each one can read.",
    ],
    path: "/handover",
    as: "arun",
    highlight: WAITING,
  },
];

export const TOURS: Record<TourTrack, readonly TourStop[]> = { built: BUILT, files: FILES };

export type TourState = { track: TourTrack; index: number };

export function isTourTrack(v: unknown): v is TourTrack {
  return typeof v === "string" && (TOUR_TRACKS as readonly string[]).includes(v);
}

/** A valid state, or null. Indexes outside the track are refused, not clamped. */
export function tourState(track: unknown, index: unknown): TourState | null {
  if (!isTourTrack(track)) return null;
  const n = typeof index === "number" ? index : typeof index === "string" && /^\d+$/.test(index) ? Number(index) : NaN;
  if (!Number.isInteger(n) || n < 0 || n >= TOURS[track].length) return null;
  return { track, index: n };
}

export function serializeTour(s: TourState): string {
  return `${s.track}:${s.index}`;
}

export function parseTourCookie(value: string | undefined | null): TourState | null {
  if (!value) return null;
  const [track, index, ...rest] = value.split(":");
  if (rest.length) return null;
  return tourState(track, index);
}

export function currentStop(s: TourState): TourStop {
  return TOURS[s.track][s.index];
}

export function tourLength(track: TourTrack): number {
  return TOURS[track].length;
}

/** The address of a stop, when it does not depend on the data (see `resolve`). */
export function stopHref(stop: TourStop): string {
  return stop.tab ? `${stop.path}?tab=${stop.tab}` : stop.path;
}

const DEFAULT_TAB: Record<string, string> = { "/ledger": "commitments", "/review": "draft" };

/** Whether the page at `pathname` (with `tab`) is the stop's page. A missing tab is the page's default tab. */
export function isOnStop(stop: TourStop, pathname: string, tab: string | null | undefined): boolean {
  if (stop.prefix) return pathname.startsWith(stop.path);
  if (pathname !== stop.path) return false;
  const fallback = DEFAULT_TAB[stop.path];
  return (tab || fallback) === (stop.tab ?? fallback);
}
