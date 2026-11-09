import { describe, expect, it } from "vitest";
import { instantToIstIso, istDateOf, istIso, localWallClockToIstIso } from "./time";

describe("istIso", () => {
  it("formats wall-clock parts with the +05:30 offset", () => {
    expect(istIso(2026, 10, 24, 10, 14, 5)).toBe("2026-10-24T10:14:05+05:30");
    expect(istIso(2026, 1, 2)).toBe("2026-01-02T00:00:00+05:30");
  });
  it("accepts leap days and rejects impossible dates", () => {
    expect(istIso(2028, 2, 29)).toBe("2028-02-29T00:00:00+05:30");
    expect(() => istIso(2026, 2, 29)).toThrow(RangeError);
    expect(() => istIso(2026, 13, 1)).toThrow(RangeError);
    expect(() => istIso(2026, 4, 31)).toThrow(RangeError);
    expect(() => istIso(2026, 4, 30, 24)).toThrow(RangeError);
  });
  it("sorts lexicographically in time order", () => {
    const a = istIso(2026, 3, 9, 23, 59);
    const b = istIso(2026, 3, 10, 0, 0);
    expect(a < b).toBe(true);
  });
});

describe("instantToIstIso", () => {
  it("converts a UTC instant to IST wall-clock time", () => {
    expect(instantToIstIso(new Date("2026-10-24T09:05:00.000Z"))).toBe("2026-10-24T14:35:00+05:30");
  });
  it("rolls over midnight into the next IST day", () => {
    expect(instantToIstIso(new Date("2026-03-15T20:00:00.000Z"))).toBe("2026-03-16T01:30:00+05:30");
  });
  it("rejects invalid dates", () => {
    expect(() => instantToIstIso(new Date("nope"))).toThrow(RangeError);
  });
});

describe("localWallClockToIstIso", () => {
  it("reads a Date's local fields as IST wall-clock time", () => {
    expect(localWallClockToIstIso(new Date(2026, 9, 24, 10, 14, 0))).toBe("2026-10-24T10:14:00+05:30");
  });
});

describe("istDateOf", () => {
  it("returns the IST calendar date", () => {
    expect(istDateOf("2026-10-24T23:59:59+05:30")).toBe("2026-10-24");
  });
});
