import { expect, test, type Page } from "@playwright/test";
import { reseedDemo } from "./reseed.ts";

// How the review page behaves while you work on it: the order of the steps, the filters, the
// confirmation that outlives a card, a save that is slow, and a tab that is slow. Runs on a
// local stack only (it accepts an item); it reseeds the demo first.
test.describe.configure({ mode: "serial" });

const local = !process.env.E2E_BASE_URL;

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

test.describe("review page UX", () => {
  test.skip(!local, "changes data: runs against a local stack only");
  test.beforeAll(async () => {
    await reseedDemo();
  });

  test("the steps run in order and the sign-off comes last, after the items", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review?tab=draft");
    for (const id of ["review-steps", "pending-diff", "signoff"]) await expect(page.getByTestId(id)).toBeVisible();
    const y = async (testId: string) => (await page.getByTestId(testId).boundingBox())?.y ?? Number.NaN;
    const steps = await y("review-steps");
    const items = await page.getByRole("heading", { name: "1. Check each item" }).boundingBox();
    const diff = await y("pending-diff");
    const signoff = await y("signoff");
    expect(steps).toBeLessThan(items!.y);
    expect(items!.y).toBeLessThan(diff);
    expect(diff).toBeLessThan(signoff);
    await expect(page.getByTestId("review-steps")).toContainText("Check each item");
    await expect(page.getByTestId("review-steps")).toContainText("Sign off");
  });

  test("filters switch at once, and open on what still needs checking", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review?tab=draft");
    const toCheck = page.getByRole("button", { name: /^To check/ });
    await expect(toCheck).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("group-draft")).toBeVisible();
    await expect(page.getByTestId("group-accepted")).toBeHidden();
    await page.getByRole("button", { name: /^Accepted/ }).click();
    await expect(page.getByTestId("group-accepted")).toBeVisible();
    await expect(page.getByTestId("group-draft")).toBeHidden();
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.getByTestId("group-draft")).toBeVisible();
    await expect(page.getByTestId("group-accepted")).toBeVisible();
  });

  test("accepting an item leaves a confirmation that stays after the card moves", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review?tab=draft");
    const card = page.getByTestId("group-draft").getByTestId("review-item").first();
    const name = (await card.locator("p.font-medium").first().innerText()).trim();
    await card.getByLabel("Reason").first().fill("Checked against the quotes");
    await card.getByRole("button", { name: "Accept", exact: true }).click();
    // The card leaves "To check", so its own "Accepted." is gone; the notice is not.
    const notice = page.getByTestId("review-notice");
    await expect(notice).toContainText("Accepted.");
    await expect(notice).toContainText(name);
    await expect(page.getByTestId("group-draft").getByTestId("review-item")).toHaveCount(0);
    await expect(page.getByTestId("all-checked")).toBeVisible();
    await expect(page.getByTestId("review-steps")).toContainText("all checked");
    await notice.getByRole("button", { name: "Dismiss this message" }).click();
    await expect(notice).toHaveCount(0);
  });

  test("a save that takes too long says so and offers a reload, instead of spinning for ever", async ({ page }) => {
    test.setTimeout(60_000);
    await signInAs(page, "Arun");
    await page.goto("/review?tab=draft");
    await page.getByRole("button", { name: /^Accepted/ }).click();
    const card = page.getByTestId("group-accepted").getByTestId("review-item").first();
    await card.getByLabel("Reason").first().fill("Sending it back for a second look");
    // Hold the save for longer than the page waits before it says so.
    await page.route("**/review**", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 15_000));
      await route.continue();
    });
    await card.getByRole("button", { name: "Back to draft" }).click();
    await expect(card.getByRole("button", { name: "Working…" })).toBeVisible();
    await expect(card.getByText("This is taking longer than usual")).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole("button", { name: "Reload to check" })).toBeVisible();
    await page.unroute("**/review**");
  });

  test("the tab you press shows a spinner and the content area shows a placeholder while it loads", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review?tab=draft");
    await expect(page.getByTestId("review-steps")).toBeVisible();
    await page.route("**/review?tab=versions**", async (route) => {
      await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    });
    const tab = page.getByRole("navigation", { name: "Review sections" }).getByRole("link", { name: /Approved versions/ });
    await tab.click();
    await expect(tab.locator("svg.animate-spin")).toBeVisible();
    await expect(page).toHaveURL(/tab=versions/);
    await expect(tab).toHaveAttribute("aria-current", "page");
    await expect(tab.locator("svg.animate-spin")).toHaveCount(0);
    await page.unroute("**/review?tab=versions**");
  });
});
