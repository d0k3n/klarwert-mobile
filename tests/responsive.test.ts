import { test } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function readWebFile(name: string): Promise<string> {
  return readFile(resolve(repoRoot, "web", name), "utf8");
}

test("web viewport remains usable across safe-area and orientation changes", async () => {
  const html = await readWebFile("index.html");
  const css = await readWebFile("style.css");

  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /name="viewport"[^>]*viewport-fit=cover/);
  assert.match(css, /env\(safe-area-inset-(?:top|right|bottom|left)\)/);
  assert.match(css, /@media\s*\(orientation:\s*landscape\)/);
  assert.match(css, /@media\s*\(max-width:\s*768px\)/);
});

test("charts are explicitly resized after viewport rotation", async () => {
  const dashboard = await readWebFile("dashboard.js");

  assert.match(dashboard, /addEventListener\("resize"/);
  assert.match(dashboard, /addEventListener\("orientationchange"/);
  assert.match(dashboard, /scheduleChartResize/);
});

test("Klarwert branding includes a responsive logo asset", async () => {
  const html = await readWebFile("index.html");
  const css = await readWebFile("style.css");
  const logoPath = resolve(repoRoot, "web", "assets", "klarwert-logo.png");

  await access(logoPath);
  assert.match(html, /rel="icon"[^>]*href="assets\/klarwert-logo\.png"/);
  assert.match(html, /class="app-logo"[^>]*src="assets\/klarwert-logo\.png"[^>]*alt=""/);
  assert.match(css, /\.page-header \.app-logo\s*\{[\s\S]*?object-fit:\s*contain/);
});
