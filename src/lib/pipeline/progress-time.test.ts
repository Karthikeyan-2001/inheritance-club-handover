import { describe, expect, it } from "vitest";
import { timeLeft } from "./progress";

describe("timeLeft", () => {
  it("says nothing until two steps have finished", () => {
    expect(timeLeft(0, 10, 5000)).toBeNull();
    expect(timeLeft(1, 10, 5000)).toBeNull();
  });
  it("estimates from the average step so far", () => {
    // 2 steps in 60 s: 30 s each, 18 left → 9 minutes.
    expect(timeLeft(2, 20, 60_000)).toBe("About 9 minutes left");
    expect(timeLeft(4, 6, 60_000)).toBe("Less than a minute left");
  });
  it("stops once every step is done", () => {
    expect(timeLeft(10, 10, 60_000)).toBeNull();
  });
});
