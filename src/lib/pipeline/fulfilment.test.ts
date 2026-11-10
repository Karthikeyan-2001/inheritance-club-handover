import { describe, expect, it } from "vitest";
import type { PipelineEvent } from "./extract";
import { buildFollowupPrompt, contextRelated, noteGrounded, postProcessFollowup, type FollowupOutput, type FollowupTarget } from "./fulfilment";

const ev = (id: string, ts: string | null, text: string, over: Partial<PipelineEvent> = {}): PipelineEvent => ({
  id, author: "Arun", ts, text, threadId: "wa:x", sourceType: "whatsapp", ...over,
});

const promise = ev("p", "2026-03-02T19:42:00+05:30", "Sure da, we will send the participation certificates to all workshop speakers by 15 March.");
const done = ev("d", "2026-03-16T09:30:00+05:30", "Done, moved the certificates card to Done on Trello.");
const notDone = ev("n", "2026-03-18T20:10:00+05:30", "Speakers are still asking for their certificates, nobody has sent them yet.", { author: "Priya" });
const earlier = ev("e", "2026-02-20T10:00:00+05:30", "Certificates template is done.");
const undated = ev("u", null, "Certificates sent.");
const minutes = ev("m", "2026-03-07T00:00:00+05:30", "Speaker travel of ₹2,400 to Mr. R. Ganesan will be reimbursed after he submits bills.", { sourceType: "minutes" });

const target: FollowupTarget = {
  obligationId: "o1", kind: "commitment", description: "Send participation certificates", owedBy: "Arun", owedTo: "Workshop speakers",
  dueText: "by 15 March", cadence: null, approver: null, sourceEventIds: ["p"], sourceQuotes: ["we will send the participation certificates"],
};

const { user, refs } = buildFollowupPrompt(target, [notDone, done, promise, earlier, undated, minutes]);
const refOf = (id: string) => [...refs.entries()].find(([, e]) => e.id === id)![0];

describe("buildFollowupPrompt", () => {
  it("states the commitment and points at the promise among records in time order", () => {
    expect(user).toContain("Commitment: Send participation certificates");
    expect(user).toContain("Promised by: Arun. Owed to: Workshop speakers. Due: by 15 March.");
    expect(user).toContain(`The promise is in ${refOf("p")}: "we will send the participation certificates"`);
    expect(user.indexOf("Certificates template")).toBeLessThan(user.indexOf("participation certificates to all"));
    expect(refOf("e")).toBe("m1");
  });

  it("describes a recurring duty without asking about fulfilment", () => {
    const r = buildFollowupPrompt({ ...target, kind: "recurring", description: "Get the HoD's permission letter", cadence: "every semester", approver: "HoD" }, [promise]);
    expect(r.user).toContain("Recurring duty: Get the HoD's permission letter");
    expect(r.user).toContain("How often: every semester. Approval from: HoD.");
  });
});

describe("postProcessFollowup", () => {
  const out = (followups: FollowupOutput["followups"], context: FollowupOutput["context"] = []) => postProcessFollowup({ followups, context }, refs, target);

  it("keeps verified, later follow-ups and maps them to relations", () => {
    const r = out([
      { message: refOf("d"), quote: "Done, moved the certificates card to Done", kind: "done" },
      { message: refOf("n"), quote: "nobody has sent them yet", kind: "not_done" },
      { message: `[${refOf("n")}]`, quote: "Speakers are still asking for their certificates", kind: "implies_done" },
    ]);
    expect(r.dropped).toEqual({});
    expect(r.evidence.map((e) => [e.event.id, e.relation, e.inferred])).toEqual([
      ["d", "fulfils", false],
      ["n", "contradicts", false],
      ["n", "fulfils", true],
    ]);
  });

  it("drops and counts follow-ups that cannot count", () => {
    const r = out([
      { message: "m99", quote: "Certificates sent", kind: "done" },
      { message: refOf("d"), quote: "Certificates were emailed to all speakers", kind: "done" }, // paraphrase
      { message: refOf("p"), quote: "we will send the participation certificates", kind: "done" }, // the promise itself
      { message: refOf("e"), quote: "Certificates template is done", kind: "done" }, // before the promise
      { message: refOf("u"), quote: "Certificates sent.", kind: "done" }, // undated
      { message: refOf("d"), quote: "Done, moved the certificates card", kind: "done" },
      { message: refOf("d"), quote: "DONE, moved the  certificates card", kind: "done" }, // duplicate
    ]);
    expect(r.evidence).toHaveLength(1);
    expect(r.dropped).toEqual({ unknown_message: 1, quote_not_found: 1, cites_promise: 1, before_promise: 1, undated: 1, duplicate: 1 });
  });

  it("does not count a hedge or a question as a report of completion", () => {
    const hedge = ev("h", "2026-03-17T10:00:00+05:30", "Maybe the certificates were sent already?");
    const question = ev("q", "2026-03-17T11:00:00+05:30", "Were the certificates sent already?");
    const r2 = buildFollowupPrompt(target, [promise, hedge, question]);
    const r = postProcessFollowup(
      {
        followups: [
          { message: "m2", quote: "Maybe the certificates were sent already", kind: "done" },
          // The quote leaves out the hedge, but its sentence has it.
          { message: "m2", quote: "the certificates were sent already", kind: "done" },
          { message: "m3", quote: "Were the certificates sent already?", kind: "implies_done" },
        ],
        context: [],
      },
      r2.refs,
      target,
    );
    expect(r.evidence).toHaveLength(0);
    expect(r.dropped).toEqual({ non_binding: 2, question: 1 });
  });

  it("with no readable promise, no follow-up can be placed in time", () => {
    const r = postProcessFollowup({ followups: [{ message: refOf("d"), quote: "Done, moved the certificates card", kind: "done" }], context: [] }, refs, { ...target, sourceEventIds: ["gone"] });
    expect(r.dropped).toEqual({ before_promise: 1 });
  });

  it("keeps grounded context from any time, at most five, and drops ungrounded notes", () => {
    const reimburse = { ...target, description: "Reimburse speaker travel", owedTo: "Mr. R. Ganesan" };
    const out = (_f: FollowupOutput["followups"], context: FollowupOutput["context"]) => postProcessFollowup({ followups: [], context }, refs, reimburse);
    const ctx = (over: Partial<FollowupOutput["context"][number]>): FollowupOutput["context"][number] => ({
      message: refOf("m"), quote: "will be reimbursed after he submits bills", kind: "dependency", note: "Mr. R. Ganesan must submit bills first.", ...over,
    });
    const r = out([], [
      ctx({}),
      ctx({ note: "Ganesan is owed ₹2,400." , kind: "contact"}),
      ctx({ note: "Mr. Ganesan's bank is Brightwave Bank.", kind: "contact" }), // names something not in the message
      ctx({ note: "Ganesan is owed ₹5,000.", kind: "risk" }), // a number not in the message
      ctx({ note: "", kind: "decision" }),
      ctx({ kind: "dependency" }), // duplicate
    ]);
    expect(r.context.map((c) => c.note)).toEqual(["Mr. R. Ganesan must submit bills first.", "Ganesan is owed ₹2,400."]);
    expect(r.dropped).toEqual({ ungrounded_note: 2, no_note: 1, duplicate: 1 });

    const many = out([], Array.from({ length: 7 }, (_, i) => ctx({ quote: ["Speaker travel", "will be reimbursed", "after he submits bills", "Mr. R. Ganesan", "of ₹2,400 to Mr", "travel of ₹2,400", "he submits bills"][i] })));
    expect(many.context).toHaveLength(5);
    expect(many.dropped.over_limit).toBe(2);
  });

  describe("implied completion from a more restricted record (P6)", () => {
    const committeePromise = ev("cp", "2026-03-01T10:00:00+05:30", "I will hand over the camera and the cupboard keys to Kavya.", { accessLevel: "committee" });
    const financeHint = ev("fh", "2026-03-20T10:00:00+05:30", "The passbook stays in the cupboard with the keys.", { accessLevel: "finance", sourceType: "minutes" });
    const financeDone = ev("fd", "2026-03-21T10:00:00+05:30", "Arun handed over the camera and the keys today.", { accessLevel: "finance", sourceType: "minutes" });
    const committeeHint = ev("ch", "2026-03-22T10:00:00+05:30", "Kavya opened the cupboard with her keys.", { accessLevel: "committee" });
    const privateHint = (uploader: string) => ev(`pv-${uploader}`, "2026-03-23T10:00:00+05:30", "The keys are with Kavya now.", { accessLevel: "private", uploaderId: uploader });
    const t: FollowupTarget = { ...target, description: "Hand over the camera and keys", owedTo: "Kavya", sourceEventIds: ["cp"], sourceQuotes: ["I will hand over the camera and the cupboard keys to Kavya"] };
    const run = (events: PipelineEvent[], followups: FollowupOutput["followups"], over: Partial<FollowupTarget> = {}) => {
      const p = buildFollowupPrompt({ ...t, ...over }, events);
      const at = (id: string) => [...p.refs.entries()].find(([, e]) => e.id === id)![0];
      return postProcessFollowup({ followups: followups.map((f) => ({ ...f, message: at(f.message) })), context: [] }, p.refs, { ...t, ...over });
    };

    it("drops an implied quote from a record some of the item's readers cannot read", () => {
      const r = run([committeePromise, financeHint], [{ message: "fh", quote: "The passbook stays in the cupboard", kind: "implies_done" }]);
      expect(r.evidence).toEqual([]);
      expect(r.dropped).toEqual({ inferred_from_restricted: 1 });
    });

    it("still keeps a plain 'done' from a more restricted record, and implied quotes at the same or a lower level", () => {
      const r = run([committeePromise, financeDone, committeeHint], [
        { message: "fd", quote: "Arun handed over the camera and the keys today", kind: "done" },
        { message: "ch", quote: "Kavya opened the cupboard with her keys", kind: "implies_done" },
      ]);
      expect(r.dropped).toEqual({});
      expect(r.evidence.map((e) => [e.event.id, e.relation, e.inferred])).toEqual([["fd", "fulfils", false], ["ch", "fulfils", true]]);
    });

    it("treats another person's private file as more restricted, and one's own as not", () => {
      const own = ev("op", "2026-03-01T10:00:00+05:30", "I will hand over the camera and the cupboard keys to Kavya.", { accessLevel: "private", uploaderId: "arun" });
      const ok = run([own, privateHint("arun")], [{ message: "pv-arun", quote: "The keys are with Kavya now", kind: "implies_done" }], { sourceEventIds: ["op"] });
      expect(ok.evidence).toHaveLength(1);
      const other = run([own, privateHint("meena")], [{ message: "pv-meena", quote: "The keys are with Kavya now", kind: "implies_done" }], { sourceEventIds: ["op"] });
      expect(other.dropped).toEqual({ inferred_from_restricted: 1 });
    });
  });
});

describe("noteGrounded", () => {
  it("allows plain wording but not names or numbers absent from the cited message and the item", () => {
    expect(noteGrounded("Ask Bala sir to sign the register.", "Returned all 8 boards, Bala sir signed the register", "")).toBe(true);
    expect(noteGrounded("Contact Mr. Ganesan.", "Speaker travel to Mr. R. Ganesan", "")).toBe(true);
    expect(noteGrounded("Contact Brightwave Labs.", "Speaker travel to Mr. R. Ganesan", "")).toBe(false);
    expect(noteGrounded("Brightwave Labs is the sponsor.", "they said yes", "Sponsorship proposal to Brightwave Labs")).toBe(true);
    expect(noteGrounded("Pay 2400 rupees.", "₹2,400 to be paid", "")).toBe(true);
    expect(noteGrounded("Pay 3000 rupees.", "₹2,400 to be paid", "")).toBe(false);
  });
});

describe("contextRelated", () => {
  // Notes from the first live eval (2026-11-09, claude-haiku-5-5) on the mini scenario.
  const sponsorship = "I'll send the sponsorship proposal to Brightwave Labs by 20 January Sponsorship proposal Brightwave Labs";
  const boards = "Return borrowed ESP32 boards Bala sir I'll return the borrowed ESP32 boards to Bala sir by Friday";
  const lab = "Get the HoD's permission letter approved before booking the lab HoD";

  it("drops a note about another item, even when one word ('Labs') led the retrieval astray", () => {
    expect(contextRelated("The HoD's permission letter was rejected last semester when it was missing.", "Last sem they rejected us without it.", sponsorship)).toBe(false);
  });

  it("keeps notes about the item itself", () => {
    expect(contextRelated("Bala sir is the person the ESP32 boards were borrowed from.", "return the borrowed ESP32 boards to Bala sir by Friday", boards)).toBe(true);
    expect(contextRelated("The HoD rejected the club's lab request last semester when the permission letter was missing.", "Last sem they rejected us without it.", lab)).toBe(true);
    expect(contextRelated("Apply for the letter two weeks before the booking.", "Apply two weeks ahead.", lab)).toBe(true);
  });
});
