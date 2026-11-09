import { describe, expect, it } from "vitest";
import { formatBytes, formatIst, formatIstDate, istDayKey } from "./format";

describe("formatIst", () => {
  it("shows UTC values from Postgres in IST", () => {
    expect(formatIst("2026-10-24T04:44:00+00:00")).toBe("24 Oct 2026, 10:14 am IST");
  });
  it("shows +05:30 values unchanged", () => {
    expect(formatIst("2026-10-24T22:05:00+05:30")).toBe("24 Oct 2026, 10:05 pm IST");
  });
  it("handles midnight and missing values", () => {
    expect(formatIst("2026-10-24T18:31:00Z")).toBe("25 Oct 2026, 12:01 am IST");
    expect(formatIst(null)).toBe("No date");
    expect(formatIst("nope")).toBe("Invalid date");
  });
});

describe("formatIstDate and istDayKey", () => {
  it("use the IST calendar day, not UTC", () => {
    expect(formatIstDate("2026-10-24T20:00:00Z")).toBe("25 Oct 2026");
    expect(istDayKey("2026-10-24T20:00:00Z")).toBe("2026-10-25");
    expect(istDayKey("2026-10-24T10:00:00+05:30")).toBe("2026-10-24");
  });
});

describe("formatBytes", () => {
  it("is human readable", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(186_715)).toBe("182.3 KB");
    expect(formatBytes(3_900_000)).toBe("3.7 MB");
  });
});

describe("formatIstTime", () => {
  it("shows the IST clock time", async () => {
    const { formatIstTime } = await import("./format");
    expect(formatIstTime("2026-10-24T04:44:00Z")).toBe("10:14 am");
    expect(formatIstTime(null)).toBe("");
  });
});
