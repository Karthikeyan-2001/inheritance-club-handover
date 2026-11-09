import { describe, expect, it } from "vitest";
import { contentTokens, sentenceContaining, sentences, stem } from "./text";

describe("stem", () => {
  it("joins the word forms that link a promise to its follow-up", () => {
    expect(stem("returned")).toBe(stem("return"));
    expect(stem("posters")).toBe(stem("poster"));
    expect(stem("printing")).toBe(stem("printed"));
    expect(stem("certificates")).toBe(stem("certificate"));
    expect(stem("class")).toBe("class");
  });
});

describe("contentTokens", () => {
  it("keeps content words and amounts, drops filler and stopwords", () => {
    const t = contentTokens("Sure da, I'll return the 8 borrowed ESP32 boards to Bala sir by Friday. ₹2,400 pending");
    expect(t).toEqual(new Set(["return", "borrow", "esp32", "board", "bala", "sir", "friday", "400", "pend"]));
  });
});

describe("sentences", () => {
  it("returns exact substrings, line by line", () => {
    const text = "Posters printed, collecting tomorrow morning. Ok!\nLast sem they rejected us without it.";
    const s = sentences(text);
    expect(s).toEqual(["Posters printed, collecting tomorrow morning.", "Ok!", "Last sem they rejected us without it."]);
    for (const x of s) expect(text).toContain(x);
  });

  it("finds the sentence holding some words, ignoring case and spacing", () => {
    expect(sentenceContaining("Hi all. IoT Fest is our  annual event. Book early.", "our annual EVENT")).toBe("IoT Fest is our  annual event.");
    expect(sentenceContaining("Nothing here.", "annual")).toBeNull();
    expect(sentenceContaining("Anything.", " ")).toBeNull();
  });
});
