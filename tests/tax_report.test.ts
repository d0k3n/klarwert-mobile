import { test } from "node:test";
import assert from "node:assert/strict";

import { run_engine } from "../src/engine.ts";
import { build_tax_report } from "../src/tax_report.ts";
import { makeDf, dt } from "./helpers.ts";

function makeTaxDf() {
  return makeDf([
    { datetime: dt("2025-06-01"), type: "BUY", tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -501, fee: 1, tax: 0, transaction_id: "b1" },
    { datetime: dt("2026-02-01"), type: "SELL", tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 599, fee: 1, tax: 0, transaction_id: "s1" },
    { datetime: dt("2026-03-01"), type: "DIVIDEND", tx_type: "DIVIDEND", name: "X", symbol: "X", asset_class: "STOCK", shares: 0, price: 0, amount: 20, fee: 0, tax: -3, transaction_id: "d1", currency: "EUR", original_currency: "USD" },
    { datetime: dt("2026-04-01"), type: "INTEREST_PAYMENT", tx_type: "INTEREST", name: "", symbol: "", asset_class: "", shares: 0, price: 0, amount: 5, fee: 0, tax: 0, transaction_id: "i1", currency: "EUR", original_currency: "" },
  ]);
}

test("year filtering and disposal aggregation", () => {
  const df = makeTaxDf();
  const result = run_engine(df);
  const report = build_tax_report(df, result.lot_matches, 2026);
  assert.equal(report.year, 2026);
  assert.equal(report.disposals.length, 1);
  const d = report.disposals[0];
  assert.ok(d.date.startsWith("2026-02-01"));
  assert.equal(d.shares, 10);
  assert.equal(d.proceeds, 600);
  assert.equal(d.cost_basis, 501);
  assert.equal(d.fees, 1);
  assert.equal(d.gain, 98);
  assert.ok(d.acquired.startsWith("2025-06-01"));
  assert.equal(report.disposal_totals.gain, 98);
});

test("2025 has no disposals", () => {
  const df = makeTaxDf();
  const result = run_engine(df);
  const report = build_tax_report(df, result.lot_matches, 2025);
  assert.deepEqual(report.disposals, []);
  assert.equal(report.disposal_totals.gain, 0);
});

test("dividends and income totals", () => {
  const df = makeTaxDf();
  const result = run_engine(df);
  const report = build_tax_report(df, result.lot_matches, 2026);
  assert.equal(report.dividends.length, 1);
  const div = report.dividends[0];
  assert.equal(div.gross, 20);
  assert.equal(div.wht, 3);
  assert.equal(div.net, 17);
  assert.equal(div.currency, "USD");
  assert.deepEqual(report.dividend_totals, { gross: 20, wht: 3, net: 17 });
  assert.equal(report.interest, 5);
  assert.equal(report.saveback, 0);
});
