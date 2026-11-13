import { expect, test, type Page } from "@playwright/test";

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const count = (page: Page, table: string) => page.getByTestId(`count-${table}`);

test("signed-out visitors are invited to load a demo club", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Load demo club" })).toBeVisible();
});

test("the login page offers your own demo club and the four shared accounts with credentials", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Explore a built handover" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start from your own files" })).toBeVisible();
  for (const name of ["Arun", "Dr. Meena", "Kavya", "Divya"]) {
    await expect(page.getByRole("button", { name: `Sign in as ${name}` })).toBeVisible();
  }
  await expect(page.getByText("kavya.demo@example.com")).toBeVisible();
});

test("roles see different rows: incoming lead vs advisor", async ({ page }) => {
  await signInAs(page, "Kavya");
  await expect(page.getByRole("button", { name: /Signed in as Kavya, Incoming lead/ })).toBeVisible();
  // The incoming lead reads approved versions, not the working ledger.
  await expect(count(page, "obligations")).toHaveText("0");
  await expect(count(page, "audit_log")).toHaveText("0");

  // Switch role with the header menu (mouse).
  await page.getByRole("button", { name: /Switch demo role/ }).click();
  await page.getByRole("menuitem", { name: /Dr\. Meena/ }).click();
  await expect(page.getByRole("button", { name: /Signed in as Dr\. Meena, Faculty advisor/ })).toBeVisible();
  await expect(count(page, "obligations")).toHaveText("6");
  await expect(page.getByTestId("visible-obligations")).toContainText("Robotics club");
});

test("the role switcher works from the keyboard", async ({ page }) => {
  await signInAs(page, "Arun");
  await expect(count(page, "obligations")).toHaveText("5");
  const trigger = page.getByRole("button", { name: /Switch demo role/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  // Opening the menu must not switch account by itself.
  await expect(page.getByRole("menu", { name: /Signed in as Arun/ })).toBeVisible();
  // Focus starts on the first enabled account (the current one is disabled and skipped).
  const item = (name: RegExp) => page.getByRole("menuitem", { name });
  await expect(item(/Dr\. Meena/)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(/Kavya/)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(/Divya/)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Signed in as Divya, Treasurer/ })).toBeVisible();
  await expect(count(page, "obligations")).toHaveText("3");
  await expect(page.getByTestId("visible-obligations")).toContainText("₹2,400");
});

test("signing out returns to the login page", async ({ page }) => {
  await signInAs(page, "Divya");
  await page.getByRole("button", { name: /Switch demo role/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Load demo club" })).toBeVisible();
});
