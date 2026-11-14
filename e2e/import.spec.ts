import { expect, test, type Page } from "@playwright/test";

const MINI = "data/scenarios/mini";

async function signInAs(page: Page, name: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in as ${name}` }).click();
  await expect(page).toHaveURL("/");
}

const readyRow = (page: Page, filename: string) =>
  page.getByRole("list", { name: "Files ready to import" }).getByRole("listitem").filter({ hasText: filename });

async function search(page: Page, text: string) {
  await page.goto("/messages");
  await page.getByLabel("Contains").fill(text);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/q=/);
}

test.describe.serial("import flow", () => {
  test("the outgoing lead imports three files and sees what was read", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await expect(page.getByRole("navigation", { name: "Workflow steps" }).getByRole("link", { name: /Add files/ })).toHaveAttribute("aria-current", "step");

    await page.getByLabel("Files to import").setInputFiles([
      `${MINI}/whatsapp-committee.txt`,
      `${MINI}/trello-board.json`,
      `${MINI}/minutes.md`,
    ]);
    await expect(readyRow(page, "whatsapp-committee.txt")).toContainText("Group chat with 5 people.");
    await readyRow(page, "minutes.md").getByLabel("Who may see it").selectOption("finance");

    const importButton = page.getByRole("button", { name: /^Import 3 files$/ });
    await expect(importButton).toBeDisabled(); // authorisation not yet confirmed
    await page.getByLabel("I am authorised to use this data.").check();
    await importButton.click();

    await expect(page.getByText("What was read (3 of 3 imported)")).toBeVisible({ timeout: 20_000 });
    const chat = page.getByTestId("import-result").filter({ hasText: "whatsapp-committee.txt" });
    await expect(chat).toContainText("Left out: 3 system lines, 1 deleted messages, 1 attachments without text.");
    await expect(chat).toContainText("IST");
    await expect(page.getByTestId("source-row").filter({ hasText: "minutes.md" })).toContainText("Finance");
  });

  test("importing the same file again is refused with a clear message", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await page.getByLabel("Files to import").setInputFiles(`${MINI}/trello-board.json`);
    await page.getByLabel("I am authorised to use this data.").check();
    await page.getByRole("button", { name: /^Import 1 file$/ }).click();
    await expect(page.getByTestId("import-result")).toContainText("already been imported");
  });

  test("a one-to-one chat starts as private", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await page.getByLabel("Files to import").setInputFiles({
      name: "WhatsApp Chat with Bala.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("02/03/2026, 7:10 pm - Arun: Sir, I will return it by Friday.\n02/03/2026, 7:12 pm - Bala: Ok.\n"),
    });
    await expect(readyRow(page, "Bala").getByLabel("Who may see it")).toHaveValue("private");
    await expect(readyRow(page, "Bala")).toContainText("one-to-one chat");
  });

  test("the timeline shows imported messages in IST; the incoming lead cannot see finance minutes", async ({ page }) => {
    await signInAs(page, "Arun");
    await search(page, "nobody has sent them yet");
    const timeline = page.getByTestId("timeline");
    await expect(timeline).toContainText("Speakers are still asking for their certificates");
    await expect(timeline).toContainText("8:10 pm");
    await expect(timeline).toContainText("18 Mar 2026");

    await search(page, "Moved card");
    await expect(page.getByTestId("timeline")).toContainText("Marked done on Trello");

    await signInAs(page, "Kavya");
    await search(page, "₹2,400");
    await expect(page.getByText("No entries match these filters.")).toBeVisible();

    await signInAs(page, "Divya");
    await search(page, "₹2,400");
    await expect(page.getByTestId("timeline")).toContainText("Speaker travel of ₹2,400 to Mr. R. Ganesan");
  });

  test("the incoming lead cannot import, but sees the files their role may read", async ({ page }) => {
    await signInAs(page, "Kavya");
    await page.goto("/import");
    await expect(page.getByText("Only the outgoing lead or the faculty advisor can import files.")).toBeVisible();
    await expect(page.getByLabel("Files to import")).toHaveCount(0);
    await expect(page.getByTestId("source-row").filter({ hasText: "whatsapp-committee.txt" })).toBeVisible();
    await expect(page.getByTestId("source-row").filter({ hasText: "minutes.md" })).toHaveCount(0);
  });

  test("the outgoing lead adds an alias and removes a file with a reason", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await page.getByLabel("Name to use").fill("Rohan");
    await page.getByLabel("Other ways it is written (comma separated)").fill("Ro, Rohan K");
    await page.getByRole("button", { name: "Add alias" }).click();
    await expect(page.getByRole("list", { name: "Aliases" })).toContainText("Ro, Rohan K");

    const row = page.getByTestId("source-row").filter({ hasText: "whatsapp-committee.txt" });
    await row.getByText("Remove this file…").click();
    await row.getByLabel("Reason (kept in the audit log)").fill("Uploaded the wrong export");
    await row.getByRole("button", { name: "Remove file and its messages" }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Remove whatsapp-committee.txt?");
    await page.getByRole("button", { name: "Yes, remove the file" }).click();
    await expect(page.getByTestId("source-row").filter({ hasText: "whatsapp-committee.txt" })).toHaveCount(0);
  });

  test("the demo club explains why it cannot be deleted", async ({ page }) => {
    await signInAs(page, "Arun");
    await page.goto("/import");
    await expect(page.getByText(/This is the shared demo club, so it cannot be deleted here/)).toBeVisible();
  });
});
