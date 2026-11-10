// Render the Round 2 project document (docs/round2-report/report.html) to PDF with the
// Playwright Chromium the end-to-end tests already use.
//   node scripts/render-report.ts
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const html = resolve("docs/round2-report/report.html");
const out = resolve("docs/Inheritance_Round2_Project.pdf");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
await page.pdf({
  path: out,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="width:100%;font-family:Helvetica,Arial,sans-serif;font-size:7px;color:#8a847a;padding:0 18mm;display:flex;justify-content:space-between">' +
    "<span>Inheritance · CodersInPune Hackathon · Round 2 project document · Team PCIe 6.0</span>" +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
});
await browser.close();
console.log(`Wrote ${out}`);
