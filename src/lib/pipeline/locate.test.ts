import { describe, expect, it } from "vitest";
import { highlightSegments, locateQuote } from "./locate";
import { verifyQuote } from "./verify";

describe("locateQuote", () => {
  const text = "Sure da, we will send the participation certificates to all workshop speakers by 15 March.";
  it("finds a verbatim quote", () => {
    const s = locateQuote(text, "we will send the participation certificates");
    expect(s && text.slice(s.start, s.end)).toBe("we will send the participation certificates");
  });
  it("ignores case and spacing in the quote", () => {
    const s = locateQuote(text, "WE WILL   SEND the participation");
    expect(s && text.slice(s.start, s.end)).toBe("we will send the participation");
  });
  it("matches across a line break and curly punctuation in the source", () => {
    const src = "Arun: I’ll cover the cost\nof the broken   soldering station — today";
    const s = locateQuote(src, "I'll cover the cost of the broken soldering station - today");
    expect(s && src.slice(s.start, s.end)).toBe("I’ll cover the cost\nof the broken   soldering station — today");
  });
  it("returns null when the quote is not in the message", () => {
    expect(locateQuote(text, "we will email the speakers")).toBeNull();
    expect(locateQuote(text, "   ")).toBeNull();
  });
  it("agrees with the verifier on what is a substring", () => {
    for (const q of ["we will send the participation certificates", "send THE  participation", "by 15 march.", "nothing like this here"]) {
      expect(locateQuote(text, q) !== null).toBe(verifyQuote(q, text).ok);
    }
  });
});

describe("highlightSegments", () => {
  it("splits around the quote and keeps all the text", () => {
    const text = "Before. I will print the banner by Monday. After.";
    const segs = highlightSegments(text, "I will print the banner by Monday");
    expect(segs.map((s) => s.text).join("")).toBe(text);
    expect(segs.filter((s) => s.mark).map((s) => s.text)).toEqual(["I will print the banner by Monday"]);
  });
  it("shows the whole message unmarked when the quote cannot be placed", () => {
    expect(highlightSegments("Just this.", "something else entirely")).toEqual([{ text: "Just this.", mark: false }]);
  });
});
