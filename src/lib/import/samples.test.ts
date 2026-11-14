import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_SETS, sampleUrl } from "./samples";

describe("sample files", () => {
  it("every listed sample exists under public/", () => {
    for (const set of SAMPLE_SETS) for (const f of set.files) expect(existsSync(join("public", "samples", set.dir, f.file)), f.file).toBe(true);
  });
  it("the recommended set has four files across three levels", () => {
    const photo = SAMPLE_SETS.find((s) => s.dir === "photo")!;
    expect(photo.files).toHaveLength(4);
    expect(new Set(photo.files.map((f) => f.level))).toEqual(new Set(["committee", "finance", "private"]));
  });
  it("encodes spaces in a sample's URL", () => {
    expect(sampleUrl("photo", "WhatsApp Chat with Prof. Iyer.txt")).toBe("/samples/photo/WhatsApp%20Chat%20with%20Prof.%20Iyer.txt");
  });
});
