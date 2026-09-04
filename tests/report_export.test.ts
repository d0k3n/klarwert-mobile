import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const html = readFileSync(resolve(root, "web", "index.html"), "utf8");
const dashboard = readFileSync(resolve(root, "web", "dashboard.js"), "utf8");
const report = readFileSync(resolve(root, "src", "report.ts"), "utf8");
const api = readFileSync(resolve(root, "src", "api.ts"), "utf8");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function constArray(source: string, name: string): string {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?;`));
  assert.ok(match, `${name} must be a top-level allowlist`);
  return match[1];
}

function objectFunction(source: string, name: string): string {
  const match = source.match(new RegExp(`${name}:\\s*async\\s*\\([^)]*\\)\\s*=>\\s*\\{([\\s\\S]*?)^\\s{2}\\},`, "m"));
  assert.ok(match, `${name} must be an async native bridge function`);
  return match[1];
}

test("PDF report has a narrow dashboard-only allowlist with no tables", () => {
  const cards = constArray(report, "CARD_SECTIONS");
  const charts = constArray(report, "CHART_SECTIONS");
  const heatmap = report.match(/const\s+MONTHLY_HEATMAP_SELECTOR\s*=\s*["']([^"']+)["']/)?.[1];

  assert.deepEqual(
    [...cards.matchAll(/selector:\s*["']([^"']+)["']/g)].map((match) => match[1]),
    ["#summary-cards", "#summary-by-asset-class", "#annual-projection-cards"],
    "only dashboard card groups belong in the report"
  );
  assert.deepEqual(
    [...charts.matchAll(/selector:\s*["']([^"']+)["']/g)].map((match) => match[1]),
    [
      "#weekly-pl-chart", "#pl-evolution-chart", "#allocation-chart", "#dividend-chart",
      "#income-chart", "#cash-flow-chart", "#spending-category-chart", "#spending-monthly-chart",
    ],
    "only dashboard visualizations belong in the report"
  );
  assert.equal(heatmap, "#monthly-pl-heatmap");

  const reportSelectors = `${cards}\n${charts}\n${heatmap}`;
  assert.doesNotMatch(
    reportSelectors,
    /(table|recon-table|transactions|tax-|closed-|open-positions)/i,
    "report allowlists must never include tabular/detail sections"
  );
});

test("PDF export control and its report bundle load before dashboard handlers", () => {
  assert.match(
    html,
    /<button\b(?=[^>]*\bid="export-pdf-btn")(?=[^>]*\btype="button")(?=[^>]*\bonclick="window\.exportDashboardPdf\(\)")(?=[^>]*\bdisabled\b)[^>]*>/,
    "the export action must remain disabled until a dashboard is available"
  );
  assert.match(
    html,
    /<span\b(?=[^>]*\bid="pdf-export-status")(?=[^>]*\brole="status")(?=[^>]*\baria-live="polite")[^>]*><\/span>/
  );

  const reportScript = html.indexOf('src="report.js"');
  const dashboardScript = html.indexOf('src="dashboard.js"');
  assert.ok(reportScript >= 0 && dashboardScript > reportScript, "report bundle must load before dashboard.js");
  assert.match(packageJson.scripts["build:web"], /build:report/);
  assert.match(packageJson.scripts["build:report"], /src\/report\.ts/);
  assert.match(report, /import\s+\{\s*jsPDF\s*\}\s+from\s+["']jspdf["']/);
});

test("dashboard handler guards repeat clicks and passes PDF Base64 to the native bridge", () => {
  const handler = dashboard.match(/window\.exportDashboardPdf\s*=\s*async function \(\)\s*\{([\s\S]*?)^\};/m)?.[1];

  assert.ok(handler, "window.exportDashboardPdf handler should exist");
  assert.match(handler, /if\s*\([^)]*pdfExportInProgress[^)]*\)\s*return/);
  assert.match(handler, /pdfExportInProgress\s*=\s*true/);
  assert.match(handler, /pdfExportInProgress\s*=\s*false/);
  assert.match(handler, /\.disabled\s*=\s*true/);
  assert.match(handler, /\.disabled\s*=\s*false/);
  assert.match(handler, /KlarwertReport\.exportDashboardPdf\s*\(\s*\{/);
  assert.match(
    handler,
    /shareBase64:\s*\((\w+),\s*(\w+)\)\s*=>\s*window\.KlarwertNative\.sharePdf\(\1,\s*\2\)/,
    "the native callback must preserve the filename and Base64 argument order"
  );
  assert.match(handler, /pdf-export-status/);
  assert.match(handler, /catch\s*\(/);
});

test("native PDF sharing writes Base64 bytes without text encoding", () => {
  const sharePdf = objectFunction(api, "sharePdf");

  assert.match(api, /sharePdf:\s*\(filename: string, base64: string\)\s*=>\s*Promise<void>/);
  assert.match(sharePdf, /Filesystem\.writeFile\(\{\s*path:\s*filename,\s*data:\s*base64,\s*directory:\s*Directory\.Cache\s*\}\)/);
  assert.match(sharePdf, /Filesystem\.getUri/);
  assert.match(sharePdf, /Share\.share/);
  assert.doesNotMatch(sharePdf, /Encoding\.UTF8|TextEncoder|TextDecoder|new Blob|atob|btoa/);
});
