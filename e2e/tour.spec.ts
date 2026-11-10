import { expect, test, type Page } from "@playwright/test";
import { DEMO_USERS } from "../src/lib/demo/demo-users.ts";
import { TOURS } from "../src/lib/tour/tour.ts";

// The guided tour in a visitor's own copy: it starts when the copy is loaded, walks every
// stop of the built track (switching role where a stop says so), rings each stop's element
// on the real page, survives wandering off, and can be left.
test.describe.configure({ mode: "serial" });

const local = !process.env.E2E_BASE_URL;
const tour = (page: Page) => page.getByTestId("tour");
const nameOf = (key: string) => DEMO_USERS.find((u) => u.key === key)!.name;

test.describe("guided tour", () => {
  test.skip(!local, "creates accounts and data: runs against a local stack only");

  test("walks every stop of the built handover, as the right person, with its element ringed", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore a built handover" }).click();
    await expect(page).toHaveURL(/\/\?welcome=copy$/, { timeout: 60_000 });

    const stops = TOURS.built;
    for (const [i, stop] of stops.entries()) {
      await expect(tour(page)).toHaveAttribute("data-stop", stop.id, { timeout: 30_000 });
      await expect(page.getByTestId("tour-title")).toHaveText(stop.title);
      await expect(tour(page)).toContainText(`${i + 1} / ${stops.length}`);
      await expect(page.getByTestId("tour-away")).toHaveCount(0);
      await expect(page.getByRole("button", { name: new RegExp(`Signed in as ${nameOf(stop.as).replace(".", "\\.")},`) })).toBeVisible();
      if (stop.prefix) await expect(page).toHaveURL(new RegExp(stop.path));
      if (stop.highlight) {
        await expect(page.locator("[data-tour-highlight]"), `${stop.id} highlight`).toHaveCount(1);
        await expect(page.locator(stop.highlight).first()).toHaveAttribute("data-tour-highlight", "");
      }
      if (i < stops.length - 1) await tour(page).getByRole("button", { name: /^Next/ }).click();
    }

    await tour(page).getByRole("button", { name: "Finish tour" }).click();
    await expect(tour(page)).toHaveCount(0);
    await expect(page.locator("[data-tour-highlight]")).toHaveCount(0);
  });

  test("wandering off, coming back, going back, and exiting", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Explore a built handover" }).click();
    await expect(page).toHaveURL(/\/\?welcome=copy$/, { timeout: 60_000 });
    await tour(page).getByRole("button", { name: "Next" }).click();
    await expect(tour(page)).toHaveAttribute("data-stop", "connect");

    // Off the stop's page: the panel says so and offers the way back.
    await page.goto("/ledger?tab=timeline");
    await expect(page.getByTestId("tour-away")).toContainText("You have left this stop's page");
    await tour(page).getByRole("button", { name: "Return to this stop" }).click();
    await expect(page).toHaveURL("/import");
    await expect(page.getByTestId("tour-away")).toHaveCount(0);

    // Hidden, it keeps its place; Back returns to the first stop.
    await tour(page).getByRole("button", { name: "Hide" }).click();
    await expect(page.getByTestId("tour-title")).toHaveCount(0);
    await tour(page).getByRole("button", { name: "Show" }).click();
    await tour(page).getByRole("button", { name: "Back" }).click();
    await expect(tour(page)).toHaveAttribute("data-stop", "welcome");

    // Switching role by hand: the panel names who the stop is seen as.
    await page.getByRole("button", { name: /Switch demo role/ }).click();
    await page.getByRole("menuitem", { name: /Kavya/ }).click();
    await expect(page.getByRole("button", { name: /Signed in as Kavya,/ })).toBeVisible();
    await expect(page.getByTestId("tour-away")).toContainText("This stop is seen as Arun");
    await tour(page).getByRole("button", { name: "Return to this stop" }).click();
    await expect(page.getByRole("button", { name: /Signed in as Arun,/ })).toBeVisible();

    await tour(page).getByRole("button", { name: "Exit tour" }).click();
    await expect(tour(page)).toHaveCount(0);
    await page.goto("/ledger");
    await expect(tour(page)).toHaveCount(0);

    // Restart from the walkthrough page.
    await page.goto("/guide");
    await page.getByRole("button", { name: "Tour building from files" }).click();
    await expect(page).toHaveURL("/import");
    await expect(tour(page)).toHaveAttribute("data-stop", "import");
  });

  test("an empty club starts the build-from-files tour on Connect", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Start from your own files" }).click();
    await expect(page).toHaveURL("/import?welcome=empty", { timeout: 60_000 });
    await expect(tour(page)).toHaveAttribute("data-stop", "import");
    await expect(page.locator('main form:has(input[type="file"])')).toHaveAttribute("data-tour-highlight", "");
  });
});
