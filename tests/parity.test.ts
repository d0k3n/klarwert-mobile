import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseCSV } from "../src/csv.ts";
import {
  run_engine,
  compute_derivative_executions,
  compute_card_transactions,
  auto_detect_knocked,
  apply_prices,
  compute_income,
  compute_spending,
  uncategorized_vendors,
} from "../src/engine.ts";
import { compute_performance } from "../src/performance.ts";
import { build_tax_report } from "../src/tax_report.ts";
import { expectDeepEqual } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));

function loadReference(): any {
  return JSON.parse(readFileSync(join(here, "fixtures", "reference.json"), "utf-8"));
}

function loadFixture(): string {
  return readFileSync(join(here, "fixtures", "transactions.csv"), "utf-8");
}

const fixtureText = loadFixture();
const reference = loadReference();

test("parity: row count matches Python reference", () => {
  const df = parseCSV(fixtureText);
  assert.equal(df.length, reference.row_count);
});

test("parity: run_engine matches Python reference", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  const d = df.map((r) => ({ ...r }));
  d.forEach((r) => (r.knocked = r.tx_type === "BUY" && auto.has(r.transaction_id)));
  const result = run_engine(d);
  expectDeepEqual(reference.result, result, "engine result");
});

test("parity: auto_detect_knocked matches", () => {
  const df = parseCSV(fixtureText);
  const auto = [...auto_detect_knocked(df)].sort();
  expectDeepEqual(reference.auto_knocked, auto, "auto knocked ids");
});

test("parity: performance matches", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  const d = df.map((r) => ({ ...r }));
  d.forEach((r) => (r.knocked = r.tx_type === "BUY" && auto.has(r.transaction_id)));
  const result = run_engine(d);
  const perf = compute_performance(d, result);
  expectDeepEqual(reference.performance, perf, "performance");
});

test("parity: tax reports match for all years", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  const d = df.map((r) => ({ ...r }));
  d.forEach((r) => (r.knocked = r.tx_type === "BUY" && auto.has(r.transaction_id)));
  const result = run_engine(d);
  for (const [yearStr, expected] of Object.entries(reference.tax)) {
    const report = build_tax_report(d, result.lot_matches, Number(yearStr));
    expectDeepEqual(expected, report, `tax report ${yearStr}`);
  }
});

test("parity: income matches", () => {
  const df = parseCSV(fixtureText);
  expectDeepEqual(reference.income, compute_income(df), "income");
});

test("parity: spending matches", () => {
  const df = parseCSV(fixtureText);
  expectDeepEqual(reference.spending, compute_spending(df), "spending");
});

test("parity: card transactions match", () => {
  const df = parseCSV(fixtureText);
  expectDeepEqual(reference.cards, compute_card_transactions(df), "cards");
});

test("parity: derivative executions match", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  expectDeepEqual(reference.derivative_executions, compute_derivative_executions(df, auto), "derivatives");
});

test("parity: uncategorized vendors match", () => {
  const df = parseCSV(fixtureText);
  expectDeepEqual(reference.uncategorized_vendors, uncategorized_vendors(df), "vendors");
});

test("parity: valued positions match (no prices)", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  const d = df.map((r) => ({ ...r }));
  d.forEach((r) => (r.knocked = r.tx_type === "BUY" && auto.has(r.transaction_id)));
  const result = run_engine(d);
  const valued = apply_prices(result.open_positions, {});
  expectDeepEqual(reference.valued, valued, "valued positions");
});
