// Exactly which fixture rows each viewer may read. This is the contract the RLS policies
// must satisfy; see the visibility table in README / docs for the reasoning.

import type { Viewer } from "./support.ts";

type Table =
  | "sources" | "events" | "obligations" | "evidence"
  | "context_items" | "docket_entries" | "sealed_items" | "aliases";

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`);

export const EXPECTED: Record<Table, Record<Viewer, string[]>> = {
  sources: {
    meena: range("S", 1, 5),
    arun: range("S", 1, 4), // not Dr. Meena's private DM (S5)
    divya: ["S1", "S2", "S3"],
    kavya: ["S1", "S2"],
    member: ["S1"],
  },
  events: {
    meena: range("E", 1, 9),
    arun: ["E1", "E2", "E3", "E4", "E5", "E6", "E8", "E9"],
    divya: ["E1", "E2", "E3", "E4", "E8", "E9"],
    kavya: ["E1", "E2", "E3", "E8", "E9"],
    member: ["E1", "E3", "E9"],
  },
  obligations: {
    meena: range("O", 1, 6),
    arun: range("O", 1, 5),
    divya: ["O1", "O2", "O3"],
    kavya: ["O1", "O2", "O4"], // O4 is private but released to incoming_lead
    member: ["O1"],
  },
  evidence: {
    meena: range("EV", 1, 9),
    arun: range("EV", 1, 8),
    divya: range("EV", 1, 6),
    kavya: ["EV1", "EV2", "EV3", "EV4", "EV5", "EV7"], // EV7: quote shared via release
    member: ["EV1", "EV2"],
  },
  context_items: {
    meena: ["C1", "C2"],
    arun: ["C1", "C2"],
    divya: ["C1", "C2"],
    kavya: ["C1"],
    member: [],
  },
  docket_entries: {
    meena: ["D1"],
    arun: ["D1"],
    divya: ["D1"],
    kavya: ["D1"],
    member: [], // one side of the conflict is committee-only
  },
  sealed_items: {
    meena: ["SI1"], arun: ["SI1"], divya: ["SI1"], kavya: ["SI1"], member: ["SI1"],
  },
  aliases: {
    meena: ["AL1"], arun: ["AL1"], divya: ["AL1"], kavya: ["AL1"], member: ["AL1"],
  },
};
