import { expect, test, type Page } from "@playwright/test";
import { reseedDemo } from "./reseed.ts";

// The handover on the seeded demo club (version 1 is approved): the incoming lead reads who is
// waiting, the calendar and the sealed placeholders, and answers an item; the advisor sees it.
test.describe.configure({ mode: "serial" });

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const local = !process.env.E2E_BASE_URL;

test.describe("handover", () => {
  test.skip(!local, "changes data: runs against a local stack only");
  test.beforeAll(async () => {
    await reseedDemo();
  });

  test("signed out, it asks you to sign in", async ({ page }) => {
    await page.goto("/handover");
    await expect(page.getByText("Sign in to see the handover.")).toBeVisible();
  });

  test("the incoming lead sees who is waiting, the calendar and a placeholder, but not sealed details", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/handover");
    await expect(page.getByRole("heading", { name: "People waiting on you" })).toBeVisible();
    await expect(page.getByTestId("handover-summary")).toContainText("Version 1");
    await expect(page.getByTestId("waiting-group").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Calendar of recurring duties" })).toBeVisible();
    await expect(page.getByTestId("calendar-month").first()).toBeVisible();
    // The advisor's private item is a placeholder: topic and holder only, no details.
    await expect(page.getByTestId("sealed-item")).toContainText("Hall booking dispute");
    await expect(page.getByTestId("sealed-item")).toContainText("held by the faculty advisor");
    await expect(page.getByText("hall booking clash")).toHaveCount(0);
  });

  test("a question needs a note, the answer is recorded, and a later answer replaces it", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/handover");
    const card = page.getByTestId("handover-item").first();
    await card.getByRole("button", { name: "Ask a question" }).click();
    await expect(card.getByRole("alert")).toContainText("Add a note");
    await card.getByLabel(/Note/).fill("Who is the contact for this?");
    await card.getByRole("button", { name: "Ask a question" }).click();
    await expect(card.getByTestId("ack-state")).toContainText("Question raised");
    await expect(card.getByTestId("ack-state")).toContainText("Who is the contact for this?");
    await card.getByRole("button", { name: "Accept" }).click();
    await expect(card.getByTestId("ack-state")).toContainText("Accepted");
  });

  test("the advisor sees the incoming lead's answers and can add a placeholder, but cannot answer", async ({ page }) => {
    await signInAs(page, "Dr. Meena");
    await page.goto("/handover");
    await expect(page.getByTestId("handover-summary")).toContainText("1 accepted");
    await expect(page.getByText("Add a sealed placeholder")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  });
});
