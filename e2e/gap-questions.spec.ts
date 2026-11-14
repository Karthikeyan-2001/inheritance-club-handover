import { expect, test, type Page } from "@playwright/test";

// Round 3, improvement 2: gap questions for the outgoing lead, in a visitor's own copy of the
// built year club. The minimum that counts as delivered: answer a gap, see its trust change,
// approve, and the incoming lead sees it in the next version.
const local = !process.env.E2E_BASE_URL;

async function loadCopy(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore a built handover" }).click();
  await expect(page).toHaveURL(/\/\?welcome=copy$/, { timeout: 60_000 });
}

async function switchTo(page: Page, who: "Dr. Meena" | "Kavya") {
  await page.getByRole("button", { name: /Switch demo role/ }).click();
  await page.getByRole("menuitem", { name: new RegExp(who.replace(".", "\\.")) }).click();
  await expect(page.getByRole("button", { name: new RegExp(`Signed in as ${who.replace(".", "\\.")}`) })).toBeVisible({ timeout: 20_000 });
}

test.describe("gap questions", () => {
  test.skip(!local, "creates a demo copy and changes its data: runs against a local stack only");
  test.setTimeout(180_000);

  test("answer a gap, see its trust change, approve, and the incoming lead reads it in the next version", async ({ page }) => {
    await loadCopy(page);

    // The home page sends the outgoing lead to the questions.
    const next = page.getByTestId("next-step");
    await expect(next).toContainText(/Answer \d+ questions about the gaps/);
    await next.getByRole("link", { name: "Answer the questions" }).click();
    await expect(page).toHaveURL(/\/check\?tab=questions/);
    await expect(page.getByRole("navigation", { name: "Check sections" })).toContainText(/Questions for you \(\d+\)/);

    const card = page.getByTestId("gap-question").filter({ hasText: /demo kits/i });
    await expect(card).toHaveAttribute("data-state", "open");
    await expect(card).toContainText("Was this done?");
    const save = card.getByRole("button", { name: "Save the answer" });
    await expect(save).toBeDisabled();
    await card.getByLabel("It was not done").check();
    await card.getByLabel("In your own words (optional)").fill("The kits are still boxed in the lab cupboard.");
    // The exact message that will be saved in Arun's name.
    await expect(card.getByTestId("answer-preview")).toContainText("“Not done: set up the demo kits. The kits are still boxed in the lab cupboard.”");
    // A more restricted level would hide the item from the incoming lead, and the form says so.
    await card.getByLabel("Who may read your answer").selectOption("finance");
    await expect(card.getByTestId("level-warning")).toContainText("moves to Finance: the incoming lead and members will no longer see it");
    await card.getByLabel("Who may read your answer").selectOption("everyone");
    await expect(card.getByTestId("level-warning")).toHaveCount(0);
    await save.click();

    // The trust rule has run: a promise in one file and "not done" in another corroborate.
    const notice = page.getByTestId("question-notice");
    await expect(notice).toContainText("It is now Open, trust Corroborated");
    await expect(notice).toContainText("accept it again in Review");
    await expect(page.getByTestId("gap-question").filter({ hasText: /demo kits/i })).toHaveAttribute("data-state", "answered");

    // On the ledger the quote is labelled as the lead's statement.
    await page.goto("/ledger");
    const item = page.getByTestId("commitments").getByRole("listitem").filter({ hasText: "Not done: set up the demo kits" }).first();
    await expect(item.getByTestId("stated-badge")).toHaveText("Stated by the outgoing lead");

    // Review: the item changed since it was accepted, so it is accepted again, then marked ready.
    await page.goto("/review?tab=draft");
    const changed = page.getByTestId("group-changed").getByTestId("review-item").filter({ hasText: /demo kits/i }).first();
    const again = page.getByRole("button", { name: "Accept again", exact: true });
    const form = changed.locator("form").filter({ has: again });
    await form.getByLabel("Reason", { exact: true }).fill("The lead's answer checked");
    await form.getByRole("button", { name: "Accept again", exact: true }).click();
    await expect(page.getByTestId("group-changed").getByTestId("review-item")).toHaveCount(0);
    const signoff = page.getByTestId("signoff");
    await signoff.getByLabel("Note for the advisor").fill("Answered the demo kits gap");
    await signoff.getByRole("button", { name: "Mark ready for the advisor" }).click();
    await expect(signoff.getByRole("status")).toContainText("Marked ready.");

    // The advisor reads the questions but cannot answer them, then approves version 2.
    await switchTo(page, "Dr. Meena");
    await page.goto("/check?tab=questions");
    await expect(page.getByTestId("questions-summary")).toContainText("Only the outgoing lead answers these.");
    await expect(page.getByRole("button", { name: "Save the answer" })).toHaveCount(0);
    await page.goto("/review?tab=draft");
    await signoff.getByLabel("Reason for approving").fill("Answer checked against its message");
    await signoff.getByRole("button", { name: "Approve this version" }).click();
    await expect(signoff.getByRole("status")).toContainText("Approved. A new version now exists");

    // The incoming lead sees the stated answer in version 2.
    await switchTo(page, "Kavya");
    await page.goto("/handover");
    await expect(page.getByTestId("handover-summary")).toContainText("Version 2");
    const handed = page.getByTestId("handover-item").filter({ hasText: /demo kits/i }).first();
    await expect(handed).toContainText("Not done: set up the demo kits. The kits are still boxed in the lab cupboard.");
    await expect(handed.getByTestId("handover-stated")).toContainText("Stated by the outgoing lead (Arun");
    await page.goto("/review/versions/2");
    await expect(page.getByTestId("diff-changed").filter({ hasText: /demo kits/i }).getByTestId("diff-stated")).toBeVisible();
  });
});
