import { expect, test } from "@playwright/test";

test("home page loads and names the product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Inheritance");
  await expect(page.getByText(/synthetic/i).first()).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workflow steps" })).toBeVisible();
});

test("health route reports ok with a reachable database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ status: "ok", service: "inheritance", db: "ok" });
});

test("the daily cron route refuses callers without Vercel's secret", async ({ request }) => {
  const none = await request.get("/api/cron/daily");
  expect(none.status()).toBe(401);
  const wrong = await request.get("/api/cron/daily", { headers: { authorization: "Bearer guess" } });
  expect(wrong.status()).toBe(401);
});
