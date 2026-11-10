import { expect, test, type Page } from "@playwright/test";

// "Load demo club": a visitor's own copy of the synthetic club, with four accounts of its own.
// What happens in a copy stays in it; the shared accounts never see it.
test.describe.configure({ mode: "serial" });

const local = !process.env.E2E_BASE_URL;
const COPY_NAME = "Demo Club (SYNTHETIC, your copy)";

async function loadCopy(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Load demo club" }).click();
  await expect(page).toHaveURL(/\/\?welcome=copy$/, { timeout: 30_000 });
  await expect(page.getByRole("status")).toContainText("Your own demo club is ready");
}

async function switchTo(page: Page, name: RegExp) {
  await page.getByRole("button", { name: /Switch demo role/ }).click();
  await expect(page.getByRole("menu")).toContainText("Switch role in your demo club");
  await page.getByRole("menuitem", { name }).click();
}

const badge = (page: Page) => page.getByText(/Your demo club · kept until/);

test.describe("demo club per visitor", () => {
  test.skip(!local, "creates accounts and data: runs against a local stack only");

  test("a copy is private: roles switch inside it, and the shared club never sees its answers", async ({ page }) => {
    await loadCopy(page);
    await expect(page.getByRole("button", { name: /Signed in as Arun, Outgoing lead/ })).toBeVisible();
    await expect(badge(page)).toBeVisible();
    await expect(page.getByTestId("count-obligations")).toHaveText("5");

    // The incoming lead of this copy answers an item.
    await switchTo(page, /Kavya/);
    await expect(page.getByRole("button", { name: /Signed in as Kavya, Incoming lead/ })).toBeVisible();
    await expect(badge(page)).toBeVisible();
    await page.goto("/handover");
    const card = page.getByTestId("handover-item").first();
    await card.getByLabel(/Note/).fill("Asked only in my own copy");
    await card.getByRole("button", { name: "Ask a question" }).click();
    await expect(card.getByTestId("ack-state")).toContainText("Asked only in my own copy");

    // This copy's advisor sees it.
    await switchTo(page, /Dr\. Meena/);
    await expect(page.getByRole("button", { name: /Signed in as Dr\. Meena, Faculty advisor/ })).toBeVisible();
    await expect(page.getByText("Asked only in my own copy").first()).toBeVisible();

    // The shared advisor does not.
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in as Dr. Meena" }).click();
    await expect(page).toHaveURL("/");
    await expect(badge(page)).toHaveCount(0);
    await page.goto("/handover");
    await expect(page.getByRole("heading", { name: "People waiting on the incoming lead" })).toBeVisible();
    await expect(page.getByText("Asked only in my own copy")).toHaveCount(0);

    // The signed cookie brings the visitor back to their copy, as its outgoing lead.
    await page.goto("/login");
    await page.getByRole("button", { name: "Return to your demo club" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("button", { name: /Signed in as Arun, Outgoing lead/ })).toBeVisible();
    await expect(badge(page)).toBeVisible();
  });

  test("deleting your copy removes it and its accounts, and signs you out", async ({ page }) => {
    await loadCopy(page);
    await page.goto("/import");
    await page.getByText("Delete this workspace…").click();
    await expect(page.getByText("its four accounts are deleted too")).toBeVisible();
    await page.getByLabel("Type the workspace name to confirm").fill(COPY_NAME);
    await page.getByLabel("Reason", { exact: true }).fill("Finished trying the demo");
    await page.getByRole("button", { name: "Delete workspace permanently" }).click();
    await expect(page).toHaveURL("/login?notice=copy-deleted");
    await expect(page.getByRole("status")).toContainText("were deleted");
    // No copy to return to any more.
    await expect(page.getByRole("button", { name: "Load demo club" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Return to your demo club" })).toHaveCount(0);
  });
});
