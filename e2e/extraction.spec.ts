import { expect, test, type Page } from "@playwright/test";

// Runs against the offline fake model (LLM_PROVIDER=fake, set in playwright.config.ts).

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const CHAT = [
  "05/03/2026, 7:00 pm - Arun: I will send the lab inventory list to Bala sir by Friday.",
  "05/03/2026, 7:05 pm - Rohan: Maybe I'll check the spare sensors, will see.",
  "05/03/2026, 7:10 pm - Priya: ok",
].join("\n");

test.describe.serial("finding commitments", () => {
  test("the outgoing lead imports a chat and finds its commitment, with the hedge left out", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await page.getByLabel("Files to import").setInputFiles({ name: "inventory-chat.txt", mimeType: "text/plain", buffer: Buffer.from(CHAT) });
    await page.getByLabel("Who may see it").selectOption("committee");
    await page.getByLabel("I am authorised to use this data.").check();
    await page.getByRole("button", { name: /^Import 1 file$/ }).click();
    await expect(page.getByText("What was read (1 of 1 imported)")).toBeVisible({ timeout: 20_000 });

    await page.goto("/ledger");
    await expect(page.getByRole("link", { name: "Commitments" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("button", { name: "Find commitments" }).click();
    const progress = page.getByTestId("extraction-progress");
    await expect(progress).toContainText("finished", { timeout: 60_000 });
    await expect(progress).toContainText("hedged, not a firm promise");

    const item = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "lab inventory list" }).first();
    await expect(item).toContainText("“I will send the lab inventory list to Bala sir by Friday”");
    await expect(item).toContainText("Trust: Sourced");
    await expect(item).toContainText("Draft");
    await expect(item).toContainText("quote checked against the message");
    await expect(page.getByTestId("commitments")).not.toContainText("spare sensors");
  });

  test("running it again finds nothing new and reuses saved answers", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    await page.getByRole("button", { name: "Find commitments" }).click();
    const progress = page.getByTestId("extraction-progress");
    await expect(progress).toContainText("finished", { timeout: 60_000 });
    await expect(progress).toContainText("Found 0 new commitments");
    await expect(progress).toContainText("reused saved answers");
  });

  test("the incoming lead sees committee commitments but cannot run extraction", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/ledger");
    await expect(page.getByText("Only the outgoing lead or the faculty advisor can run this.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Find commitments" })).toHaveCount(0);
    await expect(page.getByTestId("commitments")).toContainText("lab inventory list");
  });
});
