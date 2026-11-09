import { expect, test } from "@playwright/test";

test("home page loads and names the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Inheritance");
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
});

test("health route returns ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", service: "inheritance" });
});
