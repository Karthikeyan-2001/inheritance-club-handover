import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUpload } from "../parsers/index";
import { buildExtractionPrompt, chunkEvents, deliverableGrounded, postProcess, type PipelineEvent } from "./extract";
import { fakeExtract } from "./fake-extract";

const ev = (id: string, text: string, over: Partial<PipelineEvent> = {}): PipelineEvent => ({
  id, author: "Arun", ts: "2026-03-02T14:12:00Z", text, threadId: "wa:2026-03-02", sourceType: "whatsapp", ...over,
});

describe("chunkEvents", () => {
  it("keeps a thread together and does not mix source types", () => {
    const events = [
      ev("a", "x", { threadId: "d1" }), ev("b", "y", { threadId: "d1" }),
      ev("c", "z", { threadId: "d2" }),
      ev("t", "card", { sourceType: "trello", threadId: "card1" }),
    ];
    expect(chunkEvents(events).map((c) => c.events.map((e) => e.id))).toEqual([["a", "b", "c"], ["t"]]);
  });

  it("never puts messages of different visibility in one chunk, even on the same chat day", () => {
    const events = [
      ev("a", "x", { accessLevel: "committee" }),
      ev("b", "y", { accessLevel: "finance" }),
      ev("c", "z", { accessLevel: "private", uploaderId: "u1" }),
      ev("d", "w", { accessLevel: "private", uploaderId: "u2" }),
      ev("e", "v", { accessLevel: "committee" }),
    ];
    expect(chunkEvents(events).map((c) => c.events.map((e) => e.id))).toEqual([["a", "e"], ["b"], ["c"], ["d"]]);
  });

  it("starts a new chunk at the event or size limit, splitting only oversized threads", () => {
    const many = Array.from({ length: 5 }, (_, i) => ev(`e${i}`, "hello", { threadId: i < 3 ? "d1" : "d2" }));
    expect(chunkEvents(many, 3).map((c) => c.events.length)).toEqual([3, 2]);
    expect(chunkEvents(many, 2).map((c) => c.events.length)).toEqual([2, 1, 2]);
    const big = [ev("a", "a".repeat(100), { threadId: "d1" }), ev("b", "b".repeat(100), { threadId: "d2" })];
    expect(chunkEvents(big, 60, 150).map((c) => c.events.length)).toEqual([1, 1]);
  });
});

describe("buildExtractionPrompt", () => {
  it("gives each event a short reference and shows IST times", () => {
    const { user, refs } = buildExtractionPrompt({ events: [ev("id-1", "line one\nline two")] });
    expect(user).toContain("[m1] 2 Mar 2026, 7:42 pm IST | Chat | Arun: line one\n    line two");
    expect(refs.get("m1")?.id).toBe("id-1");
  });
});

describe("postProcess", () => {
  const e1 = ev("e1", "Sure da, we will send the participation certificates to all workshop speakers by 15 March.");
  const e2 = ev("e2", "Maybe I'll check the projector too, will see.", { author: "Rohan" });
  const refs = new Map([["m1", e1], ["m2", e2]]);
  const c = (over: object) => ({ message: "m1", quote: "we will send the participation certificates to all workshop speakers by 15 March", owed_by: "Arun", owed_to: "Workshop speakers", deliverable: "Send participation certificates", due_text: "by 15 March", ...over });

  it("keeps a verified, firm, complete commitment", () => {
    const { kept, dropped } = postProcess({ commitments: [c({})] }, refs);
    expect(dropped).toEqual({});
    expect(kept[0]).toMatchObject({ event: { id: "e1" }, owedTo: "Workshop speakers", dueText: "by 15 March" });
  });

  it("drops a quote that leaves out the hedge in its own sentence, including Tamil-English hedges", () => {
    const ev = (id: string, text: string) => ({ id, author: "Joel", ts: "2026-07-12T18:00:00+05:30", text, threadId: null, sourceType: "whatsapp" as const });
    const local = new Map([
      ["m1", ev("a", "Maybe I'll shoot the convocation too, paarkalaam.")],
      ["m2", ev("b", "I'll shoot the convocation on Friday, paakalam.")],
      ["m3", ev("c", "I'll print the frame list by Monday. The venue might change though.")],
    ]);
    const { kept, dropped } = postProcess(
      {
        commitments: [
          c({ message: "m1", quote: "I'll shoot the convocation too", owed_to: "the club", deliverable: "shoot the convocation" }),
          c({ message: "m2", quote: "I'll shoot the convocation on Friday", owed_to: "the club", deliverable: "shoot the convocation" }),
          c({ message: "m3", quote: "I'll print the frame list by Monday.", owed_to: "the club", deliverable: "print the frame list" }),
        ],
      },
      local,
    );
    expect(dropped).toEqual({ non_binding: 2 });
    // A hedge in a different sentence of the same message does not touch a firm promise.
    expect(kept.map((k) => k.event.id)).toEqual(["c"]);
  });

  it("drops and counts every kind of bad candidate", () => {
    const { kept, dropped } = postProcess(
      {
        commitments: [
          c({ message: "m9" }), // cites a message that does not exist
          c({ quote: "we will email the certificates to the speakers" }), // paraphrase
          c({ quote: "we will" }), // too short
          c({ message: "m2", quote: "Maybe I'll check the projector too", owed_to: "the club" }), // hedged
          c({ owed_to: "unknown" }), // no counterparty
          c({ deliverable: "", due_text: null }), // nothing promised
          c({}), c({ quote: "WE WILL SEND the participation certificates to all workshop speakers by 15 March" }), // duplicate
        ],
      },
      refs,
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toEqual({
      unknown_message: 1, quote_not_found: 1, quote_too_short: 1, non_binding: 1, no_counterparty: 1, no_deliverable: 1, duplicate: 1,
    });
  });

  it("accepts references written with brackets", () => {
    expect(postProcess({ commitments: [c({ message: "[m1]" })] }, refs).kept).toHaveLength(1);
  });
});

describe("deliverableGrounded", () => {
  const chat = "I'll return the borrowed ESP32 boards to Bala sir by Friday.";
  it("accepts a plain paraphrase whose names and numbers are in the message", () => {
    expect(deliverableGrounded("Return borrowed ESP32 boards", chat, "Rohan")).toBe(true);
    expect(deliverableGrounded("Print fest posters", "I will have the fest posters printed by 3 Feb.", "Kavya")).toBe(true);
    expect(deliverableGrounded("Reimburse speaker travel of ₹2,400", "Speaker travel of ₹2,400 to Mr. R. Ganesan will be reimbursed", null)).toBe(true);
    expect(deliverableGrounded("Organise the hackathon", "We'll run the hackathon in March.", "Divya")).toBe(true); // a leading verb is not a name
    expect(deliverableGrounded("Arun sends the boards", "I'll send the boards.", "Arun")).toBe(true); // the speaker
  });

  it("refuses a person, organisation or number the message does not contain", () => {
    expect(deliverableGrounded("Return ESP32 boards to Mr. Bala and Brightwave Labs", chat, "Rohan")).toBe(false);
    expect(deliverableGrounded("Return 8 ESP32 boards", chat, "Rohan")).toBe(false);
    expect(deliverableGrounded("IoT Fest boards", chat, "Rohan")).toBe(false); // a leading name is checked
  });

  it("postProcess keeps the claim but shows the verified quote instead, and counts it", () => {
    const refs = new Map([["m1", ev("x", chat, { author: "Rohan" })]]);
    const { kept, dropped } = postProcess({ commitments: [{
      message: "m1", quote: "I'll return the borrowed ESP32 boards to Bala sir by Friday", owed_by: "Rohan", owed_to: "Bala sir",
      deliverable: "Return 8 ESP32 boards to Brightwave Labs", due_text: "by Friday",
    }] }, refs);
    expect(kept.map((k) => k.deliverable)).toEqual(["I'll return the borrowed ESP32 boards to Bala sir by Friday"]);
    expect(dropped).toEqual({ ungrounded_deliverable: 1 });
  });
});

describe("fake extractor on the mini scenario", () => {
  it("finds the planted commitments and none of the decoys survive post-processing", async () => {
    const dir = "data/scenarios/mini/";
    const events: PipelineEvent[] = [];
    for (const f of ["whatsapp-committee.txt", "minutes.md"]) {
      const r = await parseUpload(f, new Uint8Array(readFileSync(dir + f)));
      r.events.forEach((e, i) => events.push({ id: `${f}:${i}`, author: e.author, ts: e.ts, text: e.text, threadId: e.threadId, sourceType: e.sourceType }));
    }
    const kept = chunkEvents(events).flatMap((chunk) => {
      const { user, refs } = buildExtractionPrompt(chunk);
      const out = fakeExtract({ task: "t", model: "m", system: "", user, schema: null as never, maxTokens: 1, effort: "low" });
      return postProcess(out, refs).kept;
    });
    const quotes = kept.map((k) => k.quote).join(" | ");
    expect(quotes).toContain("we will send the participation certificates");
    expect(quotes).toContain("I'll return the borrowed ESP32 boards");
    expect(quotes).toContain("I will have the fest posters printed by 3 Feb");
    expect(quotes).toContain("I'll send the sponsorship proposal to Brightwave Labs");
    expect(quotes).toContain("Divya to reimburse Mr. Ganesan");
    expect(quotes).not.toMatch(/projector|hackathon/i);
  });
});
