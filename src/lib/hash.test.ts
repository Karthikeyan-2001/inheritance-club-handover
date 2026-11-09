import { describe, expect, it } from "vitest";
import { sha256Hex } from "./hash";

describe("sha256Hex", () => {
  it("matches a known digest and treats strings and bytes alike", () => {
    const expected = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    expect(sha256Hex("abc")).toBe(expected);
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(expected);
  });
});
