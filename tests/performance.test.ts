import { test } from "node:test";
import assert from "node:assert/strict";

import { xirr, compute_performance } from "../src/performance.ts";
import { run_engine } from "../src/engine.ts";
import { makeDf, dt } from "./helpers.ts";

test("xirr single flow pair", () => {
  const flows = [
    { d: dt("2025-01-01"), amount: -1000 },
    { d: dt("2026-01-01"), amount: 1100 },
  ];
  const r = xirr(flows);
  assert.ok(r !== null);
  assert.ok(Math.abs(r - 0.1) < 0.001);
});

test("xirr no sign change returns null", () => {
  const flows = [
    { d: dt("2025-01-01"), amount: -1000 },
    { d: dt("2025-06-01"), amount: -500 },
  ];
  assert.equal(xirr(flows), null);
});

test("compute performance win stats", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "DEPOSIT", amount: 3000, transaction_id: "d1" },
    { datetime: dt("2025-01-02"), tx_type: "BUY", name: "W", symbol: "W", asset_class: "STOCK", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0, transaction_id: "b1" },
    { datetime: dt("2025-02-01"), tx_type: "SELL", name: "W", symbol: "W", asset_class: "STOCK", shares: 10, price: 110, amount: 1100, fee: 0, tax: 0, transaction_id: "s1" },
    { datetime: dt("2025-01-03"), tx_type: "BUY", name: "L", symbol: "L", asset_class: "STOCK", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0, transaction_id: "b2" },
    { datetime: dt("2025-02-02"), tx_type: "SELL", name: "L", symbol: "L", asset_class: "STOCK", shares: 10, price: 90, amount: 900, fee: 0, tax: 0, transaction_id: "s2" },
  ]);
  const result = run_engine(df);
  const perf = compute_performance(df, result);
  assert.equal(perf.winners, 1);
  assert.equal(perf.losers, 1);
  assert.equal(perf.win_rate, 50);
  assert.equal(perf.avg_win, 100);
  assert.equal(perf.avg_loss, -100);
  assert.equal(perf.terminal_value, 3000);
  assert.ok(perf.xirr !== null);
});
