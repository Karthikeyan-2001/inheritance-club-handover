// SYNTHETIC demo fixture for Phase 1. Every person, club and message here is invented.
// Fixed ids let the RLS tests assert exactly which rows each role can see.
// No path aliases: scripts/seed.ts imports this file directly under Node.

import type { DemoUserKey } from "./demo-users.ts";

type Level = "everyone" | "committee" | "finance" | "private";

const fid = (table: number, n: number) =>
  `d00000${table.toString().padStart(2, "0")}-0000-4000-8000-${n.toString().padStart(12, "0")}`;

export const DEMO_WORKSPACE = {
  id: fid(1, 1),
  name: "Demo Club (SYNTHETIC)",
} as const;

export type FixtureSource = {
  key: string;
  id: string;
  type: "whatsapp" | "trello" | "minutes";
  filename: string;
  access_level: Level;
  uploadedBy: DemoUserKey;
};

export const SOURCES = [
  { key: "S1", id: fid(2, 1), type: "trello", filename: "synthetic-iot-club-board.json", access_level: "everyone", uploadedBy: "arun" },
  { key: "S2", id: fid(2, 2), type: "whatsapp", filename: "WhatsApp Chat with IoT Club Committee.txt", access_level: "committee", uploadedBy: "arun" },
  { key: "S3", id: fid(2, 3), type: "minutes", filename: "finance-sync-2026-02-10.md", access_level: "finance", uploadedBy: "arun" },
  { key: "S4", id: fid(2, 4), type: "whatsapp", filename: "WhatsApp Chat with Bala Lab Incharge.txt", access_level: "private", uploadedBy: "arun" },
  { key: "S5", id: fid(2, 5), type: "whatsapp", filename: "WhatsApp Chat with HoD Office.txt", access_level: "private", uploadedBy: "meena" },
] as const satisfies readonly FixtureSource[];

type SourceKey = (typeof SOURCES)[number]["key"];

export type FixtureEvent = {
  key: string;
  id: string;
  source: SourceKey;
  author: string;
  ts: string;
  text: string;
  access_level: Level;
};

export const EVENTS = [
  { key: "E1", id: fid(3, 1), source: "S1", author: "Arun", ts: "2026-01-08T10:00:00+05:30", access_level: "everyone",
    text: "Card: Book IoT lab for Feb workshop. Checklist: get permission letter signed by HoD before booking the lab (needed every semester)." },
  { key: "E2", id: fid(3, 2), source: "S2", author: "Arun", ts: "2026-02-02T19:42:00+05:30", access_level: "committee",
    text: "Sure da, we will send the participation certificates to all workshop speakers by 15 March." },
  { key: "E3", id: fid(3, 3), source: "S1", author: "Priya", ts: "2026-01-09T21:15:00+05:30", access_level: "everyone",
    text: "Comment: Lab booking pannalama? Remember HoD permission letter first, last sem they rejected us without it." },
  { key: "E4", id: fid(3, 4), source: "S3", author: "Minutes", ts: "2026-02-10T16:00:00+05:30", access_level: "finance",
    text: "Agreed: reimburse speaker travel of ₹2,400 to Mr. R. Ganesan once he submits the bills." },
  { key: "E5", id: fid(3, 5), source: "S4", author: "Arun", ts: "2026-02-20T11:05:00+05:30", access_level: "private",
    text: "Sir, I will return the 6 DHT22 sensors before semester end, promise." },
  { key: "E6", id: fid(3, 6), source: "S4", author: "Arun", ts: "2026-02-21T09:30:00+05:30", access_level: "private",
    text: "I'll cover the cost of the broken soldering station from my side, sir." },
  { key: "E7", id: fid(3, 7), source: "S5", author: "Dr. Meena", ts: "2026-03-01T14:20:00+05:30", access_level: "private",
    text: "The hall booking clash with the Robotics club is still unresolved; I will take it up with the HoD myself." },
  { key: "E8", id: fid(3, 8), source: "S2", author: "Priya", ts: "2026-03-18T20:10:00+05:30", access_level: "committee",
    text: "Speakers are still asking for their certificates, nobody has sent them yet." },
  { key: "E9", id: fid(3, 9), source: "S1", author: "Arun", ts: "2026-03-16T08:00:00+05:30", access_level: "everyone",
    text: "Card moved to Done: Send certificates to workshop speakers." },
] as const satisfies readonly FixtureEvent[];

type EventKey = (typeof EVENTS)[number]["key"];

export type FixtureObligation = {
  key: string;
  id: string;
  kind: "commitment" | "recurring";
  description: string;
  owed_by: string;
  owed_to: string;
  due_text: string | null;
  due_date: string | null;
  approval_required: string | null;
  approver: string | null;
  status: "open" | "fulfilled" | "no_evidence" | "contradicted";
  trust_state: "corroborated" | "sourced" | "inferred" | "contradicted" | "gap";
  review_state: "draft" | "accepted" | "rejected" | "edited";
  /** Level the item is inserted with; the DB raises it to the most restrictive cited event. */
  access_level: Level;
};

export const OBLIGATIONS = [
  { key: "O1", id: fid(4, 1), kind: "recurring", description: "Get the HoD's permission letter before booking the IoT lab",
    owed_by: "Club committee", owed_to: "ECE department", due_text: "Every semester, before booking", due_date: null,
    approval_required: "Permission letter signed by the HoD", approver: "HoD, ECE",
    status: "open", trust_state: "corroborated", review_state: "accepted", access_level: "everyone" },
  { key: "O2", id: fid(4, 2), kind: "commitment", description: "Send participation certificates to workshop speakers",
    owed_by: "Arun", owed_to: "Workshop speakers", due_text: "by 15 March", due_date: "2026-03-15",
    approval_required: null, approver: null,
    status: "contradicted", trust_state: "contradicted", review_state: "accepted", access_level: "everyone" },
  { key: "O3", id: fid(4, 3), kind: "commitment", description: "Reimburse speaker travel of ₹2,400",
    owed_by: "Treasurer", owed_to: "Mr. R. Ganesan", due_text: "Once bills are submitted", due_date: null,
    approval_required: null, approver: null,
    status: "open", trust_state: "sourced", review_state: "accepted", access_level: "everyone" },
  { key: "O4", id: fid(4, 4), kind: "commitment", description: "Return 6 DHT22 sensors to the lab in-charge",
    owed_by: "Arun", owed_to: "Mr. Bala (lab in-charge)", due_text: "before semester end", due_date: null,
    approval_required: null, approver: null,
    status: "open", trust_state: "sourced", review_state: "accepted", access_level: "everyone" },
  { key: "O5", id: fid(4, 5), kind: "commitment", description: "Pay for the broken soldering station",
    owed_by: "Arun", owed_to: "Mr. Bala (lab in-charge)", due_text: null, due_date: null,
    approval_required: null, approver: null,
    status: "open", trust_state: "sourced", review_state: "draft", access_level: "everyone" },
  { key: "O6", id: fid(4, 6), kind: "commitment", description: "Resolve the hall booking clash with the Robotics club",
    owed_by: "Dr. Meena", owed_to: "Robotics club", due_text: null, due_date: null,
    approval_required: null, approver: null,
    status: "open", trust_state: "sourced", review_state: "accepted", access_level: "everyone" },
] as const satisfies readonly FixtureObligation[];

type ObligationKey = (typeof OBLIGATIONS)[number]["key"];

export type FixtureEvidence = {
  key: string;
  id: string;
  obligation: ObligationKey;
  event: EventKey;
  quote: string;
  relation: "supports" | "fulfils" | "contradicts" | "past_instance";
};

export const EVIDENCE = [
  { key: "EV1", id: fid(5, 1), obligation: "O1", event: "E1", relation: "supports", quote: "get permission letter signed by HoD before booking the lab" },
  { key: "EV2", id: fid(5, 2), obligation: "O1", event: "E3", relation: "supports", quote: "Remember HoD permission letter first" },
  { key: "EV3", id: fid(5, 3), obligation: "O2", event: "E2", relation: "supports", quote: "we will send the participation certificates to all workshop speakers by 15 March" },
  { key: "EV4", id: fid(5, 4), obligation: "O2", event: "E9", relation: "fulfils", quote: "Card moved to Done: Send certificates to workshop speakers" },
  { key: "EV5", id: fid(5, 5), obligation: "O2", event: "E8", relation: "contradicts", quote: "nobody has sent them yet" },
  { key: "EV6", id: fid(5, 6), obligation: "O3", event: "E4", relation: "supports", quote: "reimburse speaker travel of ₹2,400 to Mr. R. Ganesan" },
  { key: "EV7", id: fid(5, 7), obligation: "O4", event: "E5", relation: "supports", quote: "I will return the 6 DHT22 sensors before semester end" },
  { key: "EV8", id: fid(5, 8), obligation: "O5", event: "E6", relation: "supports", quote: "I'll cover the cost of the broken soldering station" },
  { key: "EV9", id: fid(5, 9), obligation: "O6", event: "E7", relation: "supports", quote: "I will take it up with the HoD myself" },
] as const satisfies readonly FixtureEvidence[];

export const CONTEXT_ITEMS = [
  { key: "C1", id: fid(6, 1), obligation: "O1", kind: "decision", access_level: "committee",
    text: "January meeting: request the permission letter at least two weeks before the lab date." },
  { key: "C2", id: fid(6, 2), obligation: "O3", kind: "contact", access_level: "finance",
    text: "Accounts office handles reimbursements; submit original bills with the claim form." },
] as const satisfies readonly {
  key: string; id: string; obligation: ObligationKey;
  kind: "decision" | "contact" | "risk" | "dependency"; access_level: Level; text: string;
}[];

export const DOCKET_ENTRIES = [
  { key: "D1", id: fid(7, 1), claimA: "E9", claimB: "E8",
    summary: "Trello card says the speaker certificates were sent; the committee chat two days later says they were not." },
] as const satisfies readonly { key: string; id: string; claimA: EventKey; claimB: EventKey; summary: string }[];

export const SEALED_ITEMS = [
  { key: "SI1", id: fid(8, 1), obligation: "O6", holder_role: "advisor", topic_label: "Hall booking dispute", approvedBy: "meena" },
] as const satisfies readonly {
  key: string; id: string; obligation: ObligationKey; holder_role: "advisor" | "outgoing_lead";
  topic_label: string; approvedBy: DemoUserKey;
}[];

export const ALIASES = [
  { key: "AL1", id: fid(9, 1), canonical: "Mr. Bala", variants: ["Bala sir", "lab incharge", "Bala"], kind: "person" },
] as const satisfies readonly { key: string; id: string; canonical: string; variants: readonly string[]; kind: "person" | "org" }[];

/** Releases are applied through release_item() as the given user, so they are audited. */
export const RELEASES = [
  { obligation: "O4", toRole: "incoming_lead", by: "arun", reason: "Kavya needs to know the sensors are owed back to the lab." },
] as const satisfies readonly { obligation: ObligationKey; toRole: "incoming_lead"; by: DemoUserKey; reason: string }[];

export function byKey<T extends { key: string }>(rows: readonly T[], key: string): T {
  const row = rows.find((r) => r.key === key);
  if (!row) throw new Error(`fixture key not found: ${key}`);
  return row;
}
