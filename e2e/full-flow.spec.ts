import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The whole flow a judge would follow, on the second synthetic scenario (a photography club),
// in a visitor's own empty demo club: Connect (four files at four levels, one of them Word minutes and
// one a private chat), Build the ledger (offline fake model), Review (accept, mark ready),
// Approve (advisor), Handover (incoming lead answers). Then every page is read as every role
// and searched for text that role may not see. Runs against a local stack only.
test.describe.configure({ mode: "serial" });

const local = !process.env.E2E_BASE_URL;
const DIR = "data/scenarios/photo/";
const FILES = [
  { name: "whatsapp-committee.txt", level: "committee", mime: "text/plain" },
  { name: "whatsapp-accounts.txt", level: "finance", mime: "text/plain" },
  { name: "WhatsApp Chat with Prof. Iyer.txt", level: "private", mime: "text/plain" },
  { name: "minutes.docx", level: "committee", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
] as const;

type Who = "Arun" | "Dr. Meena" | "Kavya" | "Divya";
const ALL: Who[] = ["Arun", "Dr. Meena", "Kavya", "Divya"];
/** Restricted text and who may read it: the scenario's finance and private text. */
const RESTRICTED: { text: string; allowed: Who[] }[] = [
  { text: "₹18,500", allowed: ["Arun", "Dr. Meena", "Divya"] },
  { text: "₹6,750", allowed: ["Arun", "Dr. Meena", "Divya"] },
  { text: "₹2,200", allowed: ["Arun", "Dr. Meena", "Divya"] },
  { text: "scholarship", allowed: ["Arun", "Dr. Meena"] }, // Arun's private chat with the advisor
];
const PAGES = [
  "/", "/import",
  "/ledger?tab=commitments", "/ledger?tab=recurring", "/check", "/check?tab=gaps", "/messages",
  "/review?tab=draft", "/review?tab=conflicts", "/review?tab=versions", "/review?tab=history", "/review/versions/1",
  "/handover",
];

async function loadCopy(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Start from your own files" }).click();
  await expect(page).toHaveURL(/\/import\?welcome=empty$/, { timeout: 30_000 });
}

async function switchTo(page: Page, who: Who) {
  await page.getByRole("button", { name: /Switch demo role/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(who.replace(".", "\\.")) }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Signed in as ${who.replace(".", "\\.")}`) })).toBeVisible();
}

async function accept(page: Page, group: "group-draft" | "group-changed", text: string | null, reason: string) {
  const card = (text ? page.getByTestId(group).getByTestId("review-item").filter({ hasText: text }) : page.getByTestId(group).getByTestId("review-item")).first();
  // A card has several reason boxes (link verdicts, review, edit); use the one with the Accept button.
  const button = page.getByRole("button", { name: group === "group-changed" ? "Accept again" : "Accept", exact: true });
  const form = card.locator("form").filter({ has: button });
  await form.getByLabel("Reason", { exact: true }).fill(reason);
  await form.getByRole("button", { name: group === "group-changed" ? "Accept again" : "Accept", exact: true }).click();
}

test.describe("the whole flow on a second synthetic club", () => {
  test.skip(!local, "creates a demo copy and changes its data: runs against a local stack only");
  test.setTimeout(180_000);
  // One visitor, one browser session across the steps (the copy's accounts live in its cookies).
  let page: Page;
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });
  test.afterAll(async () => {
    await page.close();
  });

  test("Connect: the outgoing lead imports four files at four levels, Word minutes included", async () => {
    await loadCopy(page);
    await page.goto("/import");
    await page.getByLabel("Files to import").setInputFiles(FILES.map((f) => ({ name: f.name, mimeType: f.mime, buffer: readFileSync(DIR + f.name) })));
    const list = page.getByRole("list", { name: "Files ready to import" });
    for (const f of FILES) await list.getByRole("listitem").filter({ hasText: f.name }).getByLabel("Who may see it").selectOption(f.level);
    await page.getByLabel("I am authorised to use this data.").check();
    await page.getByRole("button", { name: /^Import 4 files$/ }).click();
    await expect(page.getByText("What was read (4 of 4 imported)")).toBeVisible({ timeout: 30_000 });
  });

  test("Reconstruct: building the ledger finds the promises, the conflict and the gaps", async () => {
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Build the ledger" }).click();
    await expect(page.getByTestId("pipeline-progress")).toContainText("finished", { timeout: 150_000 });

    await page.goto("/ledger");
    const list = page.getByTestId("commitments");
    await expect(list.getByRole("listitem").filter({ hasText: "borrowed tripods" }).first()).toContainText("Contradicted");
    await expect(list.getByRole("listitem").filter({ hasText: "photo archive" }).first()).toContainText("No evidence kept");
    await expect(list.getByRole("listitem").filter({ hasText: "exhibition poster" }).first()).toContainText("Likely done (inferred)");
    // The outgoing lead reads his own private chat's item.
    await expect(list).toContainText("scholarship committee");
    // The hedge without its "Maybe" is still left out.
    await expect(list).not.toContainText("convocation");
    await page.goto("/ledger?tab=recurring");
    await expect(page.getByTestId("recurring")).toContainText("equipment log");
  });

  test("Review: the outgoing lead accepts items and marks the draft ready", async () => {
    await page.goto("/review?tab=draft");
    for (const text of ["borrowed tripods", "club camera", "photo archive", "Pixel Hub invoice", "scholarship committee", "equipment log"]) {
      await accept(page, "group-draft", text, "Checked against the quotes");
      await expect(page.getByTestId("group-accepted")).toContainText(text);
    }
    // Nothing was accepted before this run in an empty club, but keep the loop for safety.
    while ((await page.getByTestId("group-changed").getByTestId("review-item").count()) > 0) {
      const before = await page.getByTestId("group-changed").getByTestId("review-item").count();
      await accept(page, "group-changed", null, "The new run's evidence checked");
      await expect(page.getByTestId("group-changed").getByTestId("review-item")).toHaveCount(before - 1);
    }
    const signoff = page.getByTestId("signoff");
    await signoff.getByLabel("Note for the advisor").fill("Photography club items checked");
    await signoff.getByRole("button", { name: "Mark ready for the advisor" }).click();
    await expect(signoff.getByRole("status")).toContainText("Marked ready.");
  });

  test("Approve: the advisor approves version 1", async () => {
    await switchTo(page, "Dr. Meena");
    await page.goto("/review?tab=draft");
    const signoff = page.getByTestId("signoff");
    await signoff.getByLabel("Reason for approving").fill("Quotes checked");
    await signoff.getByRole("button", { name: "Approve this version" }).click();
    await expect(signoff.getByRole("status")).toContainText("Approved. A new version now exists");
  });

  test("Handover: the incoming lead sees the committee items, not the finance or private ones, and answers", async () => {
    await switchTo(page, "Kavya");
    await page.goto("/handover");
    await expect(page.getByTestId("handover-summary")).toContainText("Version 1");
    const tripods = page.getByTestId("handover-item").filter({ hasText: "borrowed tripods" }).first();
    await expect(tripods).toBeVisible();
    const camera = page.getByTestId("handover-item").filter({ hasText: "club camera" }).first();
    await camera.getByRole("button", { name: "Accept" }).click();
    await expect(camera.getByTestId("ack-state")).toContainText("Accepted");
    await expect(page.getByText("Pixel Hub invoice")).toHaveCount(0);
    await expect(page.getByText("scholarship")).toHaveCount(0);
    await tripods.getByLabel(/Note/).fill("Who has the tripods now?");
    await tripods.getByRole("button", { name: "Ask a question" }).click();
    await expect(tripods.getByTestId("ack-state")).toContainText("Who has the tripods now?");
  });

  test("Questions go back: the outgoing lead replies, and the incoming lead reads the reply", async () => {
    await switchTo(page, "Arun");
    await page.goto("/handover");
    const tripods = page.getByTestId("handover-item").filter({ hasText: "Who has the tripods now?" }).first();
    await tripods.getByLabel("Reply to the incoming lead").fill("Two are with the lab; I return the third on Friday.");
    await tripods.getByRole("button", { name: "Send reply" }).click();
    await expect(tripods.getByTestId("ack-reply")).toContainText("Two are with the lab");
    await switchTo(page, "Kavya");
    await page.goto("/handover");
    const mine = page.getByTestId("handover-item").filter({ hasText: "Who has the tripods now?" }).first();
    await expect(mine.getByTestId("ack-reply")).toContainText("The outgoing lead replied");
  });

  test("No leaks: every page and every source message, as every role, holds only what that role may read", async () => {
    const leaks: string[] = [];
    const seen = new Map<string, Set<Who>>(RESTRICTED.map((r) => [r.text, new Set<Who>()]));
    // Every source-message link the advisor (who reads everything) is shown. Each role then opens
    // them directly, as someone guessing URLs would: the page must not show what RLS hides.
    await switchTo(page, "Dr. Meena");
    const evidence = new Set<string>();
    for (const from of ["/ledger?tab=commitments", "/ledger?tab=recurring"]) {
      await page.goto(from);
      for (const h of await page.locator('a[href^="/ledger/evidence/"]').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) evidence.add(h);
    }
    expect(evidence.size).toBeGreaterThan(10);

    for (const who of ALL) {
      await switchTo(page, who);
      const check = (where: string, text: string) => {
        for (const r of RESTRICTED) {
          if (!text.includes(r.text)) continue;
          seen.get(r.text)!.add(who);
          if (!r.allowed.includes(who)) leaks.push(`${who} sees "${r.text}" on ${where}`);
        }
      };
      for (const url of [...PAGES, ...evidence]) {
        await page.goto(url);
        // The HTML includes the data sent for client components, not just what is on screen.
        check(url, await page.content());
      }
      // A timeline search for each restricted text (the timeline is paged). The page echoes the
      // search term in its search box and links, so only the results list is checked.
      for (const r of RESTRICTED) {
        const url = `/messages?q=${encodeURIComponent(r.text)}`;
        await page.goto(url);
        const results = page.getByTestId("timeline");
        if ((await results.count()) > 0) check(url, await results.innerHTML());
      }
    }
    expect(leaks).toEqual([]);
    // Not vacuous: everything restricted was seen by someone allowed to see it.
    for (const r of RESTRICTED) expect([r.text, seen.get(r.text)!.size > 0]).toEqual([r.text, true]);
  });
});
