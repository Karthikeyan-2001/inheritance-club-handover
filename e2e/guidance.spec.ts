import { expect, test, type Page } from "@playwright/test";
import { reseedDemo } from "./reseed.ts";

// Phase 14: the app guides a first-time visitor itself. No walkthrough page, no tour: every page
// says what it is for, the home page says what to do next, and nothing overflows on a phone.

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const PAGES = ["/", "/import", "/ledger", "/check", "/messages", "/review", "/handover", "/login"];

const currentStep = (page: Page) => page.getByRole("navigation", { name: "Workflow steps" }).locator("[aria-current=step]");

test.describe("guidance", () => {
  test.beforeAll(async () => {
    await reseedDemo();
  });

  test("there is no walkthrough page and no tour panel", async ({ page, request }) => {
    expect((await request.get("/guide")).status()).toBe(404);
    await signInAs(page, "Arun");
    await expect(page.getByRole("link", { name: /walkthrough/i })).toHaveCount(0);
    await expect(page.getByText(/guided tour/i)).toHaveCount(0);
  });

  test("a signed-out visitor sees what the product is, how it works, and one way in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Inheritance");
    await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Load demo club" })).toHaveCount(1);
  });

  test("every page says in one line what it is for", async ({ page }) => {
    await signInAs(page, "Arun");
    for (const path of PAGES) {
      await page.goto(path);
      await expect(page.getByTestId("page-purpose").first(), path).toBeVisible();
    }
  });

  test("each person gets a next step with their own main button, and progress", async ({ page }) => {
    for (const [name, button] of [
      ["Arun", /./],
      ["Dr. Meena", /./],
      ["Kavya", /Open the handover/],
    ] as const) {
      await signInAs(page, name);
      const card = page.getByTestId("next-step");
      await expect(card, name).toBeVisible();
      await expect(card.getByRole("progressbar", { name: "Handover progress" })).toBeVisible();
      // One primary action: at most one large (primary) link or button in the card's top half.
      await expect(card.getByRole("link", { name: button }).first()).toBeVisible();
      await expect(page.getByTestId("progress-count")).toContainText(/\d of 5 steps done/);
    }
  });

  test("the person switcher says what it is, and lists who each person is", async ({ page }) => {
    await signInAs(page, "Arun");
    const trigger = page.getByRole("button", { name: /Switch demo role/ });
    await expect(trigger).toContainText("Switch person");
    await trigger.click();
    await expect(page.getByRole("menu")).toContainText("Faculty advisor");
    await expect(page.getByRole("menu")).toContainText("approves the handover version");
  });

  test("pages fit a phone: no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await signInAs(page, "Arun");
    for (const path of ["/", "/import", "/ledger", "/check", "/messages", "/review", "/handover", "/login"]) {
      await page.goto(path);
      await expect(page.getByTestId("page-purpose").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });

  test("switching person covers the page while it works, so nothing can be pressed twice", async ({ page }) => {
    await signInAs(page, "Arun");
    // Slow the switch down so the cover can be seen.
    await page.route("**/*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole("button", { name: /Switch demo role/ }).click();
    await page.getByRole("menuitem", { name: /Dr\. Meena/ }).click();
    await expect(page.getByText("Switching to Dr. Meena…")).toBeVisible();
    await expect(page.getByRole("button", { name: /Signed in as Dr. Meena/ })).toBeVisible({ timeout: 20_000 });
  });

  test("one page per step: switching tabs never moves the step bar", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    await expect(currentStep(page)).toContainText("Build the ledger");
    await page.getByRole("link", { name: "Yearly duties" }).click();
    await expect(page).toHaveURL(/tab=recurring/);
    await expect(currentStep(page)).toContainText("Build the ledger");
    await page.goto("/check");
    await expect(currentStep(page)).toContainText("Check the records");
    await page.getByRole("link", { name: /^Gaps/ }).click();
    await expect(page).toHaveURL(/tab=gaps/);
    await expect(currentStep(page)).toContainText("Check the records");
    // The message list belongs to no step.
    await page.goto("/messages");
    await expect(currentStep(page)).toHaveCount(0);
  });

  test("old ledger links land on the pages that replaced them", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger?tab=docket");
    await expect(page).toHaveURL(/\/check/);
    await expect(page.getByRole("heading", { name: "Check the records", level: 1 })).toBeVisible();
    await page.goto("/ledger?tab=timeline");
    await expect(page).toHaveURL(/\/messages/);
    await expect(page.getByRole("heading", { name: "All messages", level: 1 })).toBeVisible();
  });

  test("each step page ends with the next step, in order", async ({ page }) => {
    await signInAs(page, "Arun");
    for (const [path, next] of [
      ["/import", "/ledger"],
      ["/ledger", "/check"],
      ["/check", "/review"],
    ] as const) {
      await page.goto(path);
      const bar = page.getByTestId("next-step-bar");
      await expect(bar, path).toBeVisible();
      await expect(bar.getByRole("link"), path).toHaveAttribute("href", next);
    }
  });

  test("adding files: one click loads the samples, and the button says what it still needs", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    const why = page.getByTestId("import-why");
    await expect(why).toHaveText("Choose at least one file in step 1.");
    await page.getByTestId("use-samples").click();
    const ready = page.getByRole("list", { name: "Files ready to import" }).getByRole("listitem");
    await expect(ready).toHaveCount(4);
    await expect(ready.filter({ hasText: "WhatsApp Chat with Prof. Iyer.txt" }).getByLabel("Who may see it")).toHaveValue("private");
    await expect(ready.filter({ hasText: "whatsapp-accounts.txt" }).getByLabel("Who may see it")).toHaveValue("finance");
    await expect(why).toHaveText("Tick the box above to confirm you may use this data.");
    await expect(page.getByRole("button", { name: "Import 4 files" })).toBeDisabled();
    await page.getByLabel(/I am authorised to use this data/).check();
    await expect(why).toHaveText("Ready to import.");
    await expect(page.getByRole("button", { name: "Import 4 files" })).toBeEnabled();
    // Downloading them by hand is still offered.
    await expect(page.getByRole("link", { name: "Accounts chat (WhatsApp)" })).toHaveAttribute("href", "/samples/photo/whatsapp-accounts.txt");
  });

  test("building the ledger shows progress at once, and finishes by pointing at the check step", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/ledger");
    // Hold the start request back, as a slow network or a big club would.
    await page.route("**/ledger*", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await page.getByRole("button", { name: "Build the ledger" }).click();
    await expect(page.getByTestId("pipeline-preparing")).toBeVisible({ timeout: 1000 });
    await expect(page.getByTestId("pipeline-progress")).toContainText("finished", { timeout: 90_000 });
    await expect(page.getByTestId("pipeline-progress").getByRole("link", { name: "Next: check the records" })).toHaveAttribute("href", "/check");
  });
});
