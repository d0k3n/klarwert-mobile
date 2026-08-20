import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const webDir = resolve(process.cwd(), "web");
const css = readFileSync(resolve(webDir, "style.css"), "utf8");
const html = readFileSync(resolve(webDir, "index.html"), "utf8");

test("tables use a touch-friendly horizontal scroll container", () => {
  assert.match(css, /\.table-wrapper\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /overscroll-behavior-x:\s*contain/);
  assert.match(css, /touch-action:\s*pan-x\s+pan-y/);
});

test("wide tables preserve an intrinsic width instead of clipping cells", () => {
  assert.match(css, /table\s*\{[\s\S]*?width:\s*max-content/);
  assert.match(css, /min-width:\s*100%/);
  assert.match(css, /th, td\s*\{\s*white-space:\s*nowrap/);
});

test("recent transactions is inside the same scroll treatment as other tables", () => {
  const txTable = html.indexOf('id="transactions-table"');
  assert.notEqual(txTable, -1);
  const wrapperStart = html.lastIndexOf('<div class="table-wrapper">', txTable);
  const sectionStart = html.lastIndexOf("<section>", txTable);
  assert.ok(wrapperStart > sectionStart, "transactions table should have a local scroll wrapper");
});
