// Where a club stands in the handover, and the one thing each person should do next.
// Pure: the home page gathers the facts through the viewer's own session (so RLS decides
// what is counted) and this turns them into words. A role that cannot read the working
// ledger (incoming lead, member) gets counts of zero there, so its guidance rests on the
// approved versions only.

import type { AppRole } from "./access.ts";

export type JourneyFacts = {
  role: AppRole;
  /** Source files the viewer may read. */
  files: number;
  /** Items in the working ledger the viewer may read. */
  items: number;
  /** Of those, items still waiting for a check (draft, or accepted but changed since). */
  toReview: number;
  accepted: number;
  /** The advisor's and lead's view of the mark: set only for reviewers. */
  signoff: { isCurrent: boolean; markedAt: string } | null;
  /** The newest approved version, if any. */
  version: { number: number; createdAt: string; itemCount: number } | null;
  /** Items in that version the incoming lead has answered. */
  answered: number;
  unruledConflicts: number;
  /** Gaps in what the viewer can read (as on the check page). */
  gaps: number;
  /** Gap questions still waiting for the outgoing lead's answer; counted for that role only. */
  openQuestions: number;
};

export type JourneyStage = { key: string; label: string; href: string; state: "done" | "current" | "todo" };

export type Journey = {
  stages: JourneyStage[];
  /** Whole stages finished, out of stages.length. */
  doneCount: number;
  title: string;
  body: string;
  cta: { label: string; href: string } | null;
  /** When the next step belongs to someone else: who to switch to. */
  switchTo: { key: "arun" | "meena" | "kavya"; label: string } | null;
  /** Something the person can also do, beneath the main button. */
  also: { label: string; href: string }[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Did the lead mark the draft ready after the latest version was approved, and does it still match? */
export function awaitingApproval(f: Pick<JourneyFacts, "signoff" | "version">): boolean {
  if (!f.signoff?.isCurrent) return false;
  if (!f.version) return true;
  return new Date(f.signoff.markedAt).getTime() > new Date(f.version.createdAt).getTime();
}

const STAGES = [
  { key: "files", label: "Add files", href: "/import" },
  { key: "build", label: "Build the ledger", href: "/ledger" },
  { key: "check", label: "Check the records", href: "/check" },
  { key: "approve", label: "Review and approve", href: "/review" },
  { key: "handover", label: "Hand over", href: "/handover" },
] as const;

function stageDone(f: JourneyFacts): boolean[] {
  const v = f.version !== null;
  const answeredAll = v && f.version!.itemCount > 0 && f.answered >= f.version!.itemCount;
  return [
    f.files > 0 || v,
    f.items > 0 || v,
    // Checking the records (conflicts, gaps) comes before reviewing; it is behind you once
    // reviewing has started, and, for the outgoing lead, once the gap questions are answered.
    (f.accepted > 0 || v) && f.openQuestions === 0,
    v,
    answeredAll,
  ];
}

export function journey(f: JourneyFacts): Journey {
  const done = stageDone(f);
  const firstOpen = done.indexOf(false);
  const stages: JourneyStage[] = STAGES.map((s, i) => ({
    ...s,
    state: done[i] ? "done" : i === firstOpen ? "current" : "todo",
  }));
  const doneCount = done.filter(Boolean).length;
  const base = { stages, doneCount, also: [] as Journey["also"] };
  const ask = awaitingApproval(f);
  const v = f.version;

  if (f.role === "outgoing_lead") {
    if (f.files === 0 && !v) {
      return { ...base, title: "Add the club's files", body: "Start by importing the WhatsApp chats, Trello board and meeting minutes. You choose who may see each file.", cta: { label: "Add files", href: "/import" }, switchTo: null };
    }
    if (f.items === 0 && !v) {
      return { ...base, title: "Build the ledger", body: "Your files are in. The next step reads them and lists every promise and recurring duty, each with a checked quote.", cta: { label: "Build the ledger", href: "/ledger" }, switchTo: null };
    }
    // Freshly built and nothing reviewed yet: look at what disagrees or is missing first.
    if (f.accepted === 0 && !v && f.unruledConflicts + f.gaps > 0) {
      return {
        ...base,
        title: "Look at what the ledger found",
        body: `It found ${plural(f.unruledConflicts, "conflict")} between records and ${plural(f.gaps, "gap")} where they say nothing. Look at them first, so nothing is handed over as fact by mistake.`,
        cta: { label: "Check the records", href: "/check" },
        switchTo: null,
        also: [
          ...(f.openQuestions > 0 ? [{ label: `Answer ${plural(f.openQuestions, "question")} about the gaps`, href: "/check?tab=questions" }] : []),
          { label: `Skip to reviewing ${plural(f.toReview, "item")}`, href: "/review?tab=draft" },
        ],
      };
    }
    // What only the outgoing lead can still say, asked before the review (not while a mark waits for the advisor).
    if (f.openQuestions > 0 && !ask) {
      return {
        ...base,
        title: `Answer ${plural(f.openQuestions, "question")} about the gaps`,
        body: "The records do not say whether some promises were kept, or when a duty is due or who approves it. Answer what you know while you can still be asked: each answer is saved as a message from you and becomes a quote on its item. \"I don't know\" is a fine answer.",
        cta: { label: "Answer the questions", href: "/check?tab=questions" },
        switchTo: null,
        also: f.toReview > 0 ? [{ label: `Review ${plural(f.toReview, "item")} instead`, href: "/review?tab=draft" }] : [],
      };
    }
    if (f.toReview > 0) {
      return {
        ...base,
        title: `Review ${plural(f.toReview, "item")}`,
        body: "Read each item against its quote, then accept, edit or reject it. Only accepted items go to the advisor.",
        cta: { label: `Review ${plural(f.toReview, "item")}`, href: "/review?tab=draft" },
        switchTo: null,
        also: [{ label: "See gaps in the records", href: "/check?tab=gaps" }],
      };
    }
    if (ask) {
      return { ...base, title: "Waiting for Dr. Meena to approve", body: "You marked the draft ready. The faculty advisor approves it as a version that can never change. Switch to Dr. Meena to do that yourself in this demo.", cta: null, switchTo: { key: "meena", label: "Dr. Meena" } };
    }
    if (f.accepted > 0 && (!v || !f.signoff?.isCurrent)) {
      return { ...base, title: "Mark the draft ready for the advisor", body: "Every item is checked. Tell the advisor it is ready; they approve it as a version the incoming lead can read.", cta: { label: "Mark ready", href: "/review?tab=draft" }, switchTo: null };
    }
    if (v) {
      const left = v.itemCount - f.answered;
      return {
        ...base,
        title: left > 0 ? `Version ${v.number} is with the incoming lead` : "The incoming lead has answered every item",
        body: left > 0 ? `${f.answered} of ${plural(v.itemCount, "item")} answered so far. Switch to Kavya to answer them as the incoming lead.` : "Read their questions and replies on the handover page.",
        cta: { label: "Open the handover", href: "/handover" },
        switchTo: left > 0 ? { key: "kavya", label: "Kavya" } : null,
      };
    }
    return { ...base, title: "Review the ledger", body: "Nothing is accepted yet.", cta: { label: "Open the review", href: "/review?tab=draft" }, switchTo: null };
  }

  if (f.role === "advisor") {
    if (ask) {
      return { ...base, title: "Approve the version", body: "The outgoing lead marked the draft ready. Approving freezes it as a version the incoming lead can read.", cta: { label: "Review and approve", href: "/review?tab=draft" }, switchTo: null, also: f.unruledConflicts > 0 ? [{ label: `Rule on ${plural(f.unruledConflicts, "conflict")}`, href: "/review?tab=conflicts" }] : [] };
    }
    if (f.unruledConflicts > 0) {
      return { ...base, title: `Rule on ${plural(f.unruledConflicts, "conflict")}`, body: "Some records disagree. Choose which one the handover should state, and say why.", cta: { label: "Open conflicts", href: "/review?tab=conflicts" }, switchTo: null };
    }
    if (v) {
      return { ...base, title: `Version ${v.number} is approved`, body: "Nothing is waiting for you. You can read the handover as the incoming lead will.", cta: { label: "Open the handover", href: "/handover" }, switchTo: null };
    }
    if (f.items === 0) {
      return { ...base, title: "Waiting for the ledger", body: "The outgoing lead has not built it yet. You can add files yourself, or switch to Arun.", cta: { label: "Add files", href: "/import" }, switchTo: { key: "arun", label: "Arun" } };
    }
    return { ...base, title: "Waiting for the outgoing lead", body: "Arun is still checking items. When they mark the draft ready, you can approve it.", cta: { label: "Look at the draft", href: "/review?tab=draft" }, switchTo: { key: "arun", label: "Arun" } };
  }

  if (f.role === "incoming_lead") {
    if (!v) {
      return { ...base, title: "Nothing has been handed over yet", body: "The outgoing committee must approve a version first. Switch to Arun or Dr. Meena to move it along.", cta: { label: "See approved versions", href: "/review?tab=versions" }, switchTo: { key: "arun", label: "Arun" } };
    }
    const left = v.itemCount - f.answered;
    if (left > 0) {
      return { ...base, title: `Answer ${plural(left, "item")}`, body: "For each item, accept it, ask a question or decline it. Your answers are recorded and the outgoing lead can reply.", cta: { label: "Open the handover", href: "/handover" }, switchTo: null };
    }
    return { ...base, title: "You have answered every item", body: "Replies from the outgoing committee appear on the handover page.", cta: { label: "Open the handover", href: "/handover" }, switchTo: null };
  }

  // Treasurer and members read; they do not act on the handover.
  return {
    ...base,
    title: v ? "See what has been handed over" : "Nothing has been handed over yet",
    body: v ? `Version ${v.number} is approved. You can read the items your role may see.` : "A version appears here once the advisor approves it.",
    cta: v ? { label: "Open the handover", href: "/handover" } : { label: "See approved versions", href: "/review?tab=versions" },
    switchTo: null,
  };
}
