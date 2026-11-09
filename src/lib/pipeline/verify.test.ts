import { describe, expect, it } from "vitest";
import { normaliseForQuote, verifyQuote } from "./verify";

describe("normaliseForQuote", () => {
  it("folds case, whitespace, typographic quotes and dashes", () => {
    expect(normaliseForQuote("  I’ll  Send “the”\n letters — by Friday ")).toBe("i'll send \"the\" letters - by friday");
  });
});

describe("verifyQuote", () => {
  const text = "Sure da, we will send the participation certificates to all workshop speakers by 15 March.";
  it("accepts a verbatim quote, ignoring case and spacing", () => {
    expect(verifyQuote("we will send the participation   certificates", text)).toEqual({ ok: true });
    expect(verifyQuote("WE WILL SEND THE PARTICIPATION CERTIFICATES", text)).toEqual({ ok: true });
  });
  it("accepts straight quotes for a curly apostrophe in the source", () => {
    expect(verifyQuote("I'll cover the cost", "I’ll cover the cost of the broken soldering station")).toEqual({ ok: true });
  });
  it("rejects paraphrases, invented words and stitched quotes", () => {
    expect(verifyQuote("we will email the certificates to the speakers", text)).toEqual({ ok: false, reason: "quote_not_found" });
    expect(verifyQuote("we will send the certificates by 15 March", text)).toEqual({ ok: false, reason: "quote_not_found" });
  });
  it("rejects quotes too short to mean anything", () => {
    expect(verifyQuote("we will", text)).toEqual({ ok: false, reason: "quote_too_short" });
    expect(verifyQuote("  ", text)).toEqual({ ok: false, reason: "quote_too_short" });
  });
  it("allows a short quote when the whole message is short", () => {
    expect(verifyQuote("Done!", "Done!")).toEqual({ ok: true });
  });
});
