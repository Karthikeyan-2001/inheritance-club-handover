import { expect, test, type Page } from "@playwright/test";
import { reseedDemo } from "./reseed.ts";

// The whole review flow on the seeded demo club (version 1 is already approved):
// the outgoing lead edits and marks ready, the advisor rules and approves, the incoming lead reads.
test.describe.configure({ mode: "serial" });

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const local = !process.env.E2E_BASE_URL;

test.describe("review", () => {
  test.skip(!local, "changes data: runs against a local stack only");
  test.beforeAll(async () => {
    await reseedDemo();
  });

  test("the outgoing lead edits an item with a reason, and the advisor's mark must be renewed", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
    const status = page.getByTestId("signoff-status");
    await expect(status).toContainText("Marked ready for the advisor");

    const card = page.getByTestId("review-item").filter({ hasText: "Return 6 DHT22 sensors" });
    await card.getByText("Edit this item").click();
    const edit = card.locator("details");
    await edit.getByLabel("Due (as written)").fill("by 20 April");
    // A reason is required: the browser refuses an empty one.
    await edit.getByRole("button", { name: "Save the edit" }).click();
    await expect(edit.getByLabel("Reason")).toBeFocused();
    await edit.getByLabel("Reason").fill("The lab in-charge moved the date");
    await edit.getByRole("button", { name: "Save the edit" }).click();
    await expect(edit.getByRole("status")).toContainText("Saved. The item now counts as edited.");

    // The edit changes what would be handed over, so the earlier mark no longer matches.
    await expect(status).toContainText("the draft has changed since");
    await expect(page.getByTestId("pending-diff")).toContainText("Return 6 DHT22 sensors");
    await expect(page.getByTestId("pending-diff")).toContainText("by 20 April");

    const signoff = page.getByTestId("signoff");
    await signoff.getByLabel("Note for the advisor").fill("Corrected the sensor due date");
    await signoff.getByRole("button", { name: "Mark ready for the advisor" }).click();
    await expect(signoff.getByRole("status")).toContainText("Marked ready.");
    await expect(status).toContainText("Marked ready for the advisor");
  });

  test("each role is offered only its own sign-off step", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/review");
    await expect(page.getByTestId("signoff").getByRole("button", { name: "Approve this version" })).toHaveCount(0);
    await expect(page.getByTestId("signoff").getByRole("button", { name: "Mark ready for the advisor" })).toBeEnabled();
    await signInAs(page, "Dr. Meena");
    await page.goto("/review");
    await expect(page.getByTestId("signoff").getByRole("button", { name: "Mark ready for the advisor" })).toHaveCount(0);
    await expect(page.getByTestId("signoff").getByRole("button", { name: "Approve this version" })).toBeEnabled();
  });

  test("the advisor rules on the conflict and approves version 2", async ({ page }) => {
    await signInAs(page, "Dr. Meena");
    await page.goto("/review?tab=conflicts");
    const conflict = page.getByTestId("conflict").first();
    await expect(conflict).toContainText("Awaiting a ruling");
    await conflict.getByLabel("Not done", { exact: true }).check();
    await conflict.getByLabel("Reason for the ruling").fill("The chat message is the later of the two");
    await conflict.getByRole("button", { name: "Record the ruling" }).click();
    await expect(conflict.getByRole("status")).toContainText("Ruling recorded: Not done.");
    await expect(conflict).toContainText("Advisor’s ruling: Not done");
    await expect(conflict).toContainText("the item stays contradicted");

    await page.goto("/review?tab=draft");
    const signoff = page.getByTestId("signoff");
    // The ruling is the advisor's own, so it did not invalidate the lead's mark.
    await expect(page.getByTestId("signoff-status")).toContainText("Marked ready for the advisor");
    await signoff.getByLabel("Reason for approving").fill("Checked the quotes and the ruling");
    await signoff.getByRole("button", { name: "Approve this version" }).click();
    await expect(signoff.getByRole("status")).toContainText("Approved. A new version now exists");
    await page.goto("/review?tab=versions");
    await expect(page.getByTestId("versions")).toContainText("Version 2");
    await expect(page.getByTestId("versions")).toContainText("Version 1");
  });

  test("the incoming lead sees the approved version and its changes, and nothing restricted", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/ledger");
    await expect(page.getByTestId("working-ledger-notice")).toBeVisible();
    await page.getByRole("link", { name: "See approved versions" }).click();
    await expect(page.getByRole("navigation", { name: "Review sections" }).getByRole("link")).toHaveCount(1);
    await page.getByRole("link", { name: "Version 2" }).click();
    const changes = page.getByRole("region", { name: "Changes" });
    await expect(changes).toContainText("What changed from version 1");
    await expect(changes).toContainText("by 20 April");
    await expect(changes).toContainText("Advisor’s ruling: none → Not done");
    const items = page.getByTestId("version-items");
    await expect(items).toContainText("Return 6 DHT22 sensors"); // released to the incoming lead
    await expect(items).toContainText("Send participation certificates");
    await expect(items).not.toContainText("₹2,400"); // finance
    await expect(items).not.toContainText("Robotics club"); // the advisor's private item
    await expect(page.getByTestId("version-conflict")).toContainText("Advisor’s ruling: Not done");
    // Kavya cannot reach the review tools.
    await page.goto("/review?tab=draft");
    await expect(page.getByTestId("signoff")).toHaveCount(0);
  });

  test("the history lists each action with its actor and reason", async ({ page }) => {
    await signInAs(page, "Dr. Meena");
    await page.goto("/review?tab=history");
    const rows = page.getByTestId("history-row");
    // Newest first: version 2, then the seeded version 1.
    await expect(rows.filter({ hasText: "Approved a version" })).toHaveCount(2);
    await expect(rows.filter({ hasText: "Approved a version" }).first()).toContainText("Faculty advisor");
    await expect(rows.filter({ hasText: "Ruled on a conflict" })).toContainText("The chat message is the later of the two");
    await expect(rows.filter({ hasText: "Marked the draft ready" }).first()).toContainText("Outgoing lead");
    const edit = rows.filter({ hasText: "Edited" });
    await expect(edit).toContainText("The lab in-charge moved the date");
    await expect(edit).toContainText("by 20 April");
  });

  test("a version that does not exist says so", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/review/versions/99");
    await expect(page.getByText("There is no version 99 in this workspace.")).toBeVisible();
  });
});
