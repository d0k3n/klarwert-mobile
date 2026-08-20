import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const webDir = resolve(process.cwd(), "web");
const html = readFileSync(resolve(webDir, "index.html"), "utf8");
const css = readFileSync(resolve(webDir, "style.css"), "utf8");
const dashboard = readFileSync(resolve(webDir, "dashboard.js"), "utf8");

test("monthly P/L uses an accessible calendar heatmap", () => {
  assert.match(html, /id="monthly-pl-heatmap"[^>]*role="grid"/);
  assert.match(html, /id="monthly-pl-grid"[^>]*role="rowgroup"/);
  assert.match(html, /id="month-label"[^>]*aria-live="polite"/);
  assert.doesNotMatch(html, /id="monthly-pl-chart"/);
  assert.match(dashboard, /setAttribute\("aria-label", formatMonthlyDayLabel\(day\)\)/);
  assert.match(dashboard, /button\.tabIndex = dayIndex === 1 \? 0 : -1/);
  assert.match(dashboard, /grid\.addEventListener\("click", handleMonthlyGridClick\)/);
  assert.match(dashboard, /tooltip\.textContent = button\.dataset\.pl == null[\s\S]*?formatPLValue\(Number\(button\.dataset\.pl\)\)/);
  assert.match(dashboard, /button\.setAttribute\("aria-describedby", tooltip\.id\)/);
});

test("monthly P/L heatmap stays a seven-column responsive grid", () => {
  assert.match(css, /\.pl-heatmap-weekdays, \.pl-heatmap-row\s*\{[\s\S]*?grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.pl-day\s*, \.pl-day-empty\s*\{[\s\S]*?aspect-ratio:\s*1/);
  assert.match(css, /\.pl-day:focus-visible\s*\{[\s\S]*?outline:/);
  assert.match(css, /\.pl-day-tooltip\s*\{[\s\S]*?position:\s*absolute/);
});
