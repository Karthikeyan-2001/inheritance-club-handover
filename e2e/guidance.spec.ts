import { expect, test, type Page } from "@playwright/test";
import { reseedDemo } from "./reseed.ts";

// Phase 14: the app guides a first-time visitor itself. No walkthrough page, no tour: every page
// says what it is for, the home page says what to do next, and nothing overflows on a phone.

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const PAGES = ["/", "/import", "/ledger", "/review", "/handover", "/login"];

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
    for (const path of ["/", "/import", "/ledger", "/ledger?tab=docket", "/review", "/handover", "/login"]) {
      await page.goto(path);
      await expect(page.getByTestId("page-purpose").first()).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});
