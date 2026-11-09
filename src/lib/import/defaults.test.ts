import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chatAuthors, suggestAccessLevel } from "./defaults";

const LRM = "‎";

describe("chatAuthors", () => {
  it("finds Android and iPhone authors and ignores system lines", () => {
    const android = [
      "24/10/2026, 9:58 am - Priya created group \"X\"",
      "24/10/2026, 10:01 am - Priya: hi",
      "24/10/2026, 10:02 am - +91 00000 00001: hello",
      "continuation line: with a colon",
    ].join("\n");
    expect(chatAuthors(android)).toEqual(new Set(["Priya", "+91 00000 00001"]));

    const iphone = [
      `[24/10/2026, 9:58:12 am] Club: ${LRM}Messages and calls are end-to-end encrypted.`,
      "[24/10/2026, 10:01:30 am] Priya: Welcome",
      `[24/10/2026, 10:09:55 am] Kavya: ${LRM}image omitted`,
    ].join("\n");
    expect(chatAuthors(iphone)).toEqual(new Set(["Priya"]));
  });

  it("counts the people in the sample group chat", () => {
    expect(chatAuthors(readFileSync("data/samples/whatsapp-android.txt", "utf8"))).toEqual(new Set(["Priya", "Arun", "Kavya", "+91 00000 00001", "Divya"]));
  });
});

describe("suggestAccessLevel", () => {
  it("makes one-to-one chats private", () => {
    const dm = "24/10/2026, 10:01 am - Arun: Sir, I will return the sensors\n24/10/2026, 10:05 am - Bala: ok";
    expect(suggestAccessLevel("WhatsApp Chat with Bala.txt", dm)).toMatchObject({ level: "private" });
  });
  it("keeps group chats at committee", () => {
    expect(suggestAccessLevel("group.txt", readFileSync("data/samples/whatsapp-android.txt", "utf8"))).toMatchObject({
      level: "committee",
      reason: "Group chat with 5 people.",
    });
  });
  it("makes money-related files finance-only", () => {
    expect(suggestAccessLevel("Finance sync minutes.md").level).toBe("finance");
    expect(suggestAccessLevel("budget-2026.docx").level).toBe("finance");
    expect(suggestAccessLevel("Treasurer chat.txt", "x").level).toBe("finance");
  });
  it("defaults boards and minutes to committee", () => {
    expect(suggestAccessLevel("board.json").level).toBe("committee");
    expect(suggestAccessLevel("minutes.docx").level).toBe("committee");
  });
});
