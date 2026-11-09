import { expect, test, type Page } from "@playwright/test";

// Runs against the offline fake language model (LLM_PROVIDER=fake, set in playwright.config.ts).

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const CHAT = [
  "05/03/2026, 7:00 pm - Arun: I will send the lab inventory list to Bala sir by Friday.",
  "05/03/2026, 7:05 pm - Rohan: Maybe I'll check the spare sensors, will see.",
  "05/03/2026, 7:10 pm - Priya: ok",
  "05/03/2026, 7:12 pm - Priya: Reminder: the lab inventory audit happens every semester, and Bala sir needs the list a week ahead.",
  "06/03/2026, 6:00 pm - Arun: I will print the sponsor banner for the Robotics club by Monday.",
  "07/03/2026, 11:00 am - Arun: Sent the lab inventory list to Bala sir.",
].join("\n");

// One promise in the chat and again in the minutes; done by one record, disputed by another person.
const KIT_CHAT = [
  "06/03/2026, 6:30 pm - Arun: I will return the soldering kit to the Robotics club by Monday.",
  "08/03/2026, 10:00 am - Arun: Returned the soldering kit to the Robotics club.",
  "09/03/2026, 5:00 pm - Priya: The Robotics club says the soldering kit is still not returned.",
].join("\n");
const KIT_MINUTES = "# Committee minutes (SYNTHETIC)\n\n## 2026-03-07: Committee meeting\n\n### Actions\n\n- Arun to return the soldering kit to the Robotics club by Monday.\n";

async function importFile(page: Page, name: string, mimeType: string, body: string, level = "committee") {
  await page.goto("/import");
  await page.getByLabel("Files to import").setInputFiles({ name, mimeType, buffer: Buffer.from(body) });
  await page.getByLabel("Who may see it").selectOption(level);
  await page.getByLabel("I am authorised to use this data.").check();
  await page.getByRole("button", { name: /^Import 1 file$/ }).click();
  await expect(page.getByText("What was read (1 of 1 imported)")).toBeVisible({ timeout: 20_000 });
}

test.describe.serial("building the ledger", () => {
  test("the outgoing lead builds the ledger: commitments, follow-up and the hedge left out", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await page.getByLabel("Files to import").setInputFiles({ name: "inventory-chat.txt", mimeType: "text/plain", buffer: Buffer.from(CHAT) });
    await page.getByLabel("Who may see it").selectOption("committee");
    await page.getByLabel("I am authorised to use this data.").check();
    await page.getByRole("button", { name: /^Import 1 file$/ }).click();
    await expect(page.getByText("What was read (1 of 1 imported)")).toBeVisible({ timeout: 20_000 });

    await page.goto("/ledger");
    await expect(page.getByRole("link", { name: "Commitments" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Build the ledger" }).click();
    const progress = page.getByTestId("pipeline-progress");
    await expect(progress).toContainText("finished", { timeout: 90_000 });
    await expect(progress).toContainText("hedged, not a firm promise");
    await expect(progress).toContainText(/Follow-up: checked \d+ of \d+ items/);

    const list = page.getByTestId("commitments");
    const done = list.getByRole("listitem").filter({ hasText: "lab inventory list" }).first();
    await expect(done).toContainText("“I will send the lab inventory list to Bala sir by Friday”");
    await expect(done).toContainText("The promise");
    await expect(done).toContainText("Says it was done");
    await expect(done).toContainText("“Sent the lab inventory list to Bala sir.”");
    await expect(done.getByText("Done", { exact: true })).toBeVisible();
    await expect(done).toContainText("Trust: Sourced");
    await expect(done).toContainText("Draft");
    await expect(done).toContainText("quote checked against the message");

    const banner = list.getByRole("listitem").filter({ hasText: "sponsor banner" }).first();
    await expect(banner).toContainText("No evidence kept");
    await expect(list).not.toContainText("spare sensors");
  });

  test("the Recurring tab shows the duty with its cadence and lead time", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger?tab=recurring");
    await expect(page.getByRole("link", { name: "Recurring" })).toHaveAttribute("aria-current", "page");
    const duty = page.getByTestId("recurring").getByRole("listitem").filter({ hasText: "inventory audit" }).first();
    await expect(duty).toContainText("Every semester");
    await expect(duty).toContainText("a week ahead");
    await expect(duty).toContainText("States the duty");
    await expect(duty).toContainText("Not derivable from the records");
  });

  test("running it again finds nothing new and reuses saved answers", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Build the ledger" }).click();
    const progress = page.getByTestId("pipeline-progress");
    await expect(progress).toContainText("finished", { timeout: 90_000 });
    await expect(progress).toContainText("found 0 new commitments");
    await expect(progress).toContainText("0 new recurring duties");
    await expect(progress).toContainText("reused saved answers");
  });

  test("the incoming lead sees committee items but cannot run the pipeline", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/ledger");
    await expect(page.getByText("Only the outgoing lead or the faculty advisor can run this.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Build the ledger" })).toHaveCount(0);
    await expect(page.getByTestId("commitments")).toContainText("lab inventory list");
    await page.goto("/ledger?tab=recurring");
    await expect(page.getByTestId("recurring")).toContainText("inventory audit");
  });

  test("an item recorded twice is linked, and a done-versus-not-done conflict lands in the Docket", async ({ page }) => {
    await signInAs(page, "Arun");
    await importFile(page, "kit-chat.txt", "text/plain", KIT_CHAT);
    await importFile(page, "kit-minutes.md", "text/markdown", KIT_MINUTES);
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Build the ledger" }).click();
    const progress = page.getByTestId("pipeline-progress");
    await expect(progress).toContainText("finished", { timeout: 90_000 });
    await expect(progress).toContainText(/Matching: \d+ items? linked/);

    const kit = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "“I will return the soldering kit" }).first();
    await expect(kit).toContainText("Trust: Contradicted");
    await expect(kit).toContainText("One record says it was done and another says it was not.");
    await expect(kit.getByTestId("links")).toContainText("Also in");

    await page.getByRole("link", { name: "Docket", exact: true }).click();
    await expect(page.getByRole("link", { name: "Docket", exact: true })).toHaveAttribute("aria-current", "page");
    const entry = page.getByTestId("docket").getByRole("listitem").filter({ hasText: "soldering kit" }).first();
    await expect(entry).toContainText("WhatsApp, 8 Mar 2026: says it was done. WhatsApp, 9 Mar 2026: says it was not.");
    await expect(entry).toContainText("“Returned the soldering kit to the Robotics club.”");
    await expect(entry).toContainText("“The Robotics club says the soldering kit is still not returned.”");
    await expect(entry).toContainText("Awaiting a ruling");
    await expect(page.getByTestId("docket").getByRole("listitem").filter({ hasText: "soldering kit" })).toHaveCount(1);
  });

  test("the incoming lead sees the same conflict, because both records are committee-level", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/ledger?tab=docket");
    await expect(page.getByTestId("docket")).toContainText("still not returned");
  });

  test("a quote opens its source message with the quote highlighted and the messages around it", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    const kit = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "“I will return the soldering kit" }).first();
    await kit.getByRole("link", { name: "Open source message" }).first().click();
    await expect(page).toHaveURL(/\/ledger\/evidence\//);
    await expect(page.getByRole("heading", { name: "Source message" })).toBeVisible();
    await expect(page.getByTestId("source-message").locator("mark")).toHaveText(/return the soldering kit to the Robotics club by Monday/i);
    await expect(page.getByTestId("source-thread")).toContainText("Returned the soldering kit to the Robotics club.");
    await expect(page.getByText("The quote was checked against this message by code.")).toBeVisible();
    await page.getByRole("link", { name: "Back to the item" }).click();
    await expect(page).toHaveURL(/tab=commitments#item-/);
  });

  test("a contradicted item and its Docket entry link to each other", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    const kit = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "“I will return the soldering kit" }).first();
    await kit.getByRole("link", { name: "See this conflict in the Docket" }).click();
    await expect(page).toHaveURL(/tab=docket#docket-/);
    const entry = page.getByTestId("docket").getByRole("listitem").filter({ hasText: "soldering kit" }).first();
    await entry.getByRole("link", { name: "Open the item in the ledger" }).click();
    await expect(page).toHaveURL(/tab=commitments#item-/);
    await expect(page.getByRole("link", { name: "Commitments" })).toHaveAttribute("aria-current", "page");
  });

  test("the Gaps tab lists what has no evidence and what would close it", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    await page.getByRole("link", { name: "Gaps" }).click();
    await expect(page.getByRole("link", { name: "Gaps" })).toHaveAttribute("aria-current", "page");
    const banner = page.getByTestId("gaps").getByRole("listitem").filter({ hasText: "sponsor banner" }).first();
    await expect(banner).toContainText("No evidence kept of what happened after the promise.");
    await expect(banner).toContainText("To close it:");
    const duty = page.getByTestId("gaps").getByRole("listitem").filter({ hasText: "inventory audit" }).first();
    await expect(duty).toContainText("No next date can be derived");
    await expect(page.getByTestId("gaps")).not.toContainText("lab inventory list");
  });

  test("one legend explains the trust labels", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    const legend = page.getByTestId("trust-legend");
    await legend.getByText("What the trust labels mean").click();
    for (const word of ["Corroborated", "Sourced", "Inferred", "Contradicted", "Gap: no evidence kept"]) {
      await expect(legend.getByText(word, { exact: true })).toBeVisible();
    }
    await expect(page.getByTestId("commitments")).not.toContainText("Backed by one record only.");
  });

  test("a quote from a finance-level file cannot be opened by the incoming lead", async ({ page, browser }) => {
    await signInAs(page, "Arun");
    await importFile(page, "budget-chat.txt", "text/plain", "10/03/2026, 5:00 pm - Arun: I will pay the vendor invoice for the printer by Friday.", "finance");
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Build the ledger" }).click();
    await expect(page.getByTestId("pipeline-progress")).toContainText("finished", { timeout: 90_000 });
    const item = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "vendor invoice" }).first();
    const href = await item.getByRole("link", { name: "Open source message" }).first().getAttribute("href");
    expect(href).toMatch(/^\/ledger\/evidence\//);
    await page.goto(href!);
    await expect(page.getByTestId("source-message")).toContainText("vendor invoice");

    const other = await browser.newContext();
    const kavya = await other.newPage();
    await signInAs(kavya, "Kavya");
    await kavya.goto(href!);
    await expect(kavya.getByText("That quote is not available to your role.")).toBeVisible();
    await expect(kavya.locator("body")).not.toContainText("vendor invoice");
    await other.close();
  });
});
