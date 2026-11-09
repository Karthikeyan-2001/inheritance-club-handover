import { describe, expect, it } from "vitest";
import { canRead, clearance, mostRestrictive, type AppRole } from "./access";

const ME = "user-me";
const OTHER = "user-other";

describe("clearance", () => {
  it.each<[AppRole, string]>([
    ["advisor", "private"],
    ["outgoing_lead", "finance"],
    ["treasurer", "finance"],
    ["incoming_lead", "committee"],
    ["member", "everyone"],
  ])("%s reads up to %s", (role, level) => {
    expect(clearance(role)).toBe(level);
  });
});

describe("mostRestrictive", () => {
  it("picks the most restrictive level among sources", () => {
    expect(mostRestrictive(["everyone", "finance", "committee"])).toBe("finance");
    expect(mostRestrictive(["committee", "private"])).toBe("private");
  });
  it("defaults to everyone with no sources", () => {
    expect(mostRestrictive([])).toBe("everyone");
  });
});

describe("canRead", () => {
  const base = { userId: ME, privateUploaders: [] as string[], releasedToRole: false };

  it("incoming lead cannot read finance", () => {
    expect(canRead({ ...base, role: "incoming_lead", level: "finance" })).toBe(false);
  });

  it("treasurer reads finance but not private", () => {
    expect(canRead({ ...base, role: "treasurer", level: "finance" })).toBe(true);
    expect(canRead({ ...base, role: "treasurer", level: "private", privateUploaders: [ME] })).toBe(false);
  });

  it("outgoing lead reads private items only from their own uploads", () => {
    expect(canRead({ ...base, role: "outgoing_lead", level: "private", privateUploaders: [ME] })).toBe(true);
    expect(canRead({ ...base, role: "outgoing_lead", level: "private", privateUploaders: [OTHER] })).toBe(false);
    expect(canRead({ ...base, role: "outgoing_lead", level: "private", privateUploaders: [ME, OTHER] })).toBe(false);
    expect(canRead({ ...base, role: "outgoing_lead", level: "private", privateUploaders: [] })).toBe(false);
  });

  it("an explicit release opens an item to that role", () => {
    expect(canRead({ ...base, role: "incoming_lead", level: "private", releasedToRole: true })).toBe(true);
  });

  it("advisor reads everything", () => {
    expect(canRead({ ...base, role: "advisor", level: "private", privateUploaders: [OTHER] })).toBe(true);
  });
});
