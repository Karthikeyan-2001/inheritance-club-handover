// Render a project document (an HTML file with its images beside it) to PDF with the
// Playwright Chromium the end-to-end tests already use. The footer repeats the HTML <title>.
//   node scripts/render-report.ts <report.html> <output.pdf>
//   node scripts/render-report.ts docs/archive/round2/report.html docs/Inheritance_Round2_Project.pdf
// PDFs under docs/ are git-ignored: they are submitted, not committed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const [htmlArg, outArg] = process.argv.slice(2);
if (!htmlArg || !outArg) {
  console.error("Usage: node scripts/render-report.ts <report.html> <output.pdf>");
  process.exit(1);
}
const html = resolve(htmlArg);
const out = resolve(outArg);
const title = /<title>([^<]*)<\/title>/.exec(readFileSync(html, "utf8"))?.[1]?.trim() ?? "Inheritance";
const escaped = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");

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
    `<span>${escaped}</span>` +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
  margin: { top: "18mm", bottom: "20mm", left: "18mm", right: "18mm" },
});
await browser.close();
console.log(`Wrote ${out}`);
