import { test } from "node:test";
import assert from "node:assert/strict";

import { run_engine, auto_detect_knocked, compute_derivative_executions, apply_prices, compute_income, compute_spending, compute_card_transactions, category_for_merchant, uncategorized_vendors } from "../src/engine.ts";
import { makeDf, dt } from "./helpers.ts";

test("single buy", () => {
  const df = makeDf([
    { datetime: dt("2025-06-02"), tx_type: "BUY", name: "S&P 500", symbol: "IE00B5BMR087", asset_class: "FUND", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 1);
  const op = result.open_positions[0];
  assert.equal(op.shares, 10);
  assert.equal(op.average_cost, 100);
  assert.equal(op.total_cost, 1000);
  assert.equal(result.closed_positions.length, 0);
});

test("buy then full sell", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "NOVO", symbol: "DK", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 1, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "NOVO", symbol: "DK", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 1, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  assert.equal(result.closed_positions.length, 1);
  const cp = result.closed_positions[0];
  const expected = 10 * 60 - (10 * 50 + 1) - 1;
  assert.ok(Math.abs(cp.total_realized_pl - expected) < 0.011);
});

test("partial sell", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "NOVO", symbol: "DK", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "NOVO", symbol: "DK", asset_class: "STOCK", shares: 4, price: 60, amount: 240, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 1);
  assert.equal(Math.round(result.open_positions[0].shares * 1e4) / 1e4, 6);
  const cp = result.closed_positions[0];
  assert.ok(Math.abs(cp.total_realized_pl - (4 * 60 - 4 * 50)) < 0.011);
});

test("fifo multiple lots", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0 },
    { datetime: dt("2025-06-15"), tx_type: "BUY", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 10, price: 120, amount: -1200, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 15, price: 130, amount: 1950, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 1);
  assert.equal(Math.round(result.open_positions[0].shares * 1e4) / 1e4, 5);
  const expected = 15 * 130 - (10 * 100 + 5 * 120);
  assert.ok(Math.abs(result.closed_positions[0].total_realized_pl - expected) < 0.011);
});

test("cash flow", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 1000 },
    { datetime: dt("2025-06-15"), tx_type: "DIVIDEND", name: "ASML", symbol: "NL", asset_class: "STOCK", amount: 50 },
    { datetime: dt("2025-07-01"), tx_type: "INTEREST", amount: 5 },
  ]);
  const result = run_engine(df);
  const cf = result.cash_flow;
  assert.ok(cf.length >= 2);
  const jun = cf.filter((c) => c.month === "2025-06");
  assert.equal(jun.length, 1);
  assert.equal(jun[0].deposit, 1000);
  assert.equal(jun[0].dividend, 50);
  const jul = cf.filter((c) => c.month === "2025-07");
  assert.equal(jul[0].interest, 5);
});

test("summary", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 2000 },
    { datetime: dt("2025-06-02"), tx_type: "BUY", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 5, price: 200, amount: -1000, fee: 2, tax: 0 },
  ]);
  const s = run_engine(df).summary;
  assert.equal(s.total_deposits, 2000);
  assert.equal(s.total_invested, 1000);
});

test("knocked buy generates negative pl", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 10, price: 50, amount: -500, fee: 2, tax: 0, knocked: true },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  const cp = result.closed_positions[0];
  const expected = -(10 * 50 + 2);
  assert.ok(Math.abs(cp.total_realized_pl - expected) < 0.011);
  assert.equal(cp.total_shares_sold, 10);
  assert.equal(result.monthly_pl.length, 1);
  assert.ok(Math.abs(result.monthly_pl[0].realized_pl - expected) < 0.011);
  assert.deepEqual(result.daily_pl, [{ date: "2025-06-01", realized_pl: Math.round(expected * 100) / 100 }]);
});

test("daily pl by date", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 4, price: 60, amount: 240, fee: 0, tax: 0 },
    { datetime: dt("2025-07-02"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 6, price: 60, amount: 360, fee: 0, tax: 0 },
  ]);
  const daily = Object.fromEntries(run_engine(df).daily_pl.map((d) => [d.date, d.realized_pl]));
  assert.deepEqual(daily, { "2025-07-01": 40, "2025-07-02": 60 });
});

test("daily pl sums equal monthly pl", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "W", symbol: "DE100", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "W", symbol: "DE100", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 300, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "Y", symbol: "Y", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 1, tax: 0, transaction_id: "s1" },
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "Y", symbol: "Y", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  const dailyTotal = result.daily_pl.reduce((a, d) => a + d.realized_pl, 0);
  const monthlyTotal = result.monthly_pl.reduce((a, d) => a + d.realized_pl, 0);
  assert.ok(Math.abs(dailyTotal - monthlyTotal) < 0.011);
});

test("daily pl knocked booked at exercise date", () => {
  const df = makeDf([
    { datetime: dt("2025-01-15"), type: "BUY", tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 2, tax: 0, transaction_id: "b1", knocked: true },
    { datetime: dt("2025-03-06"), type: "WARRANT_EXERCISE", tx_type: "SELL", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 0, amount: 0, fee: 0, tax: 0, transaction_id: "we1" },
  ]);
  const daily = Object.fromEntries(run_engine(df).daily_pl.map((d) => [d.date, d.realized_pl]));
  assert.deepEqual(daily, { "2025-03-06": -(100 * 5 + 2) });
});

test("knocked buy with other lots", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 5, price: 100, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-06-15"), tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 3, price: 80, amount: -240, fee: 0, tax: 0, knocked: true },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 1);
  assert.equal(Math.round(result.open_positions[0].shares * 1e4) / 1e4, 5);
  const cp = result.closed_positions[0];
  assert.ok(Math.abs(cp.total_realized_pl - -(3 * 80)) < 0.011);
});

test("round trip", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 55, amount: 550, fee: 0, tax: 0 },
    { datetime: dt("2025-08-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 5, price: 60, amount: -300, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 1);
  assert.equal(Math.round(result.open_positions[0].shares * 1e4) / 1e4, 5);
  assert.ok(Math.abs(result.closed_positions[0].total_realized_pl - 50) < 0.011);
});

test("auto detect total ko", () => {
  const df = makeDf([
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE001", shares: 1352, transaction_id: "tx1", datetime: dt("2025-06-01") },
    { asset_class: "DERIVATIVE", type: "WARRANT_EXERCISE", tx_type: "SELL", symbol: "DE001", shares: 1352, transaction_id: "tx2", datetime: dt("2025-06-15") },
  ]);
  assert.deepEqual([...auto_detect_knocked(df)], ["tx1"]);
});

test("auto detect hybrid ko", () => {
  const df = makeDf([
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE002", shares: 1000, transaction_id: "tx1", datetime: dt("2025-06-01") },
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE002", shares: 1000, transaction_id: "tx2", datetime: dt("2025-06-05") },
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE002", shares: 1000, transaction_id: "tx3", datetime: dt("2025-06-10") },
    { asset_class: "DERIVATIVE", type: "SELL", tx_type: "SELL", symbol: "DE002", shares: 500, transaction_id: "tx4", datetime: dt("2025-06-12") },
    { asset_class: "DERIVATIVE", type: "WARRANT_EXERCISE", tx_type: "SELL", symbol: "DE002", shares: 2500, transaction_id: "tx5", datetime: dt("2025-06-15") },
  ]);
  assert.deepEqual([...auto_detect_knocked(df)].sort(), ["tx1", "tx2", "tx3"]);
});

test("auto detect no we", () => {
  const df = makeDf([
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE003", shares: 1000, transaction_id: "tx1", datetime: dt("2025-06-01") },
  ]);
  assert.equal(auto_detect_knocked(df).size, 0);
});

test("auto detect all sold regular", () => {
  const df = makeDf([
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE004", shares: 1000, transaction_id: "tx1", datetime: dt("2025-06-01") },
    { asset_class: "DERIVATIVE", type: "SELL", tx_type: "SELL", symbol: "DE004", shares: 1000, transaction_id: "tx2", datetime: dt("2025-06-15") },
  ]);
  assert.equal(auto_detect_knocked(df).size, 0);
});

test("auto detect non derivative ignored", () => {
  const df = makeDf([
    { asset_class: "STOCK", type: "BUY", tx_type: "BUY", symbol: "DE005", shares: 100, transaction_id: "tx1", datetime: dt("2025-06-01") },
    { asset_class: "STOCK", type: "WARRANT_EXERCISE", tx_type: "SELL", symbol: "DE005", shares: 100, transaction_id: "tx2", datetime: dt("2025-06-15") },
  ]);
  assert.equal(auto_detect_knocked(df).size, 0);
});

test("auto detect shares dont match", () => {
  const df = makeDf([
    { asset_class: "DERIVATIVE", type: "BUY", tx_type: "BUY", symbol: "DE006", shares: 1000, transaction_id: "tx1", datetime: dt("2025-06-01") },
    { asset_class: "DERIVATIVE", type: "WARRANT_EXERCISE", tx_type: "SELL", symbol: "DE006", shares: 999, transaction_id: "tx2", datetime: dt("2025-06-15") },
  ]);
  assert.equal(auto_detect_knocked(df).size, 0);
});

test("knocked warrant with tilg discounts pl", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "WARRANT X", symbol: "DE007", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 2, tax: 0, knocked: true },
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "WARRANT X", symbol: "DE007", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 300, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  const cp = result.closed_positions[0];
  const expected = -(100 * 5 + 2) + 300;
  assert.ok(Math.abs(cp.total_realized_pl - expected) < 0.011);
  assert.equal(result.monthly_pl.length, 1);
  assert.equal(result.monthly_pl[0].month, "2025-06");
  assert.ok(Math.abs(result.monthly_pl[0].realized_pl - expected) < 0.011);
});

test("sell fee deducted from realized pl", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 2, tax: 0 },
  ]);
  assert.ok(Math.abs(run_engine(df).closed_positions[0].total_realized_pl - (600 - 500 - 2)) < 0.011);
});

test("buy tax included in cost basis", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 1, tax: 5 },
  ]);
  const op = run_engine(df).open_positions[0];
  const expected = 10 * 50 + 1 + 5;
  assert.ok(Math.abs(op.total_cost - expected) < 0.011);
  assert.ok(Math.abs(op.average_cost - expected / 10) < 0.0001);
});

test("buy tax in realized pl on sell", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 5 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 0, tax: 0 },
  ]);
  assert.ok(Math.abs(run_engine(df).closed_positions[0].total_realized_pl - (600 - (500 + 5))) < 0.011);
});

test("sell tax deducted from realized pl", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 0, tax: 3 },
  ]);
  assert.ok(Math.abs(run_engine(df).closed_positions[0].total_realized_pl - (600 - 500 - 3)) < 0.011);
});

test("knocked buy tax included in loss", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 10, price: 50, amount: -500, fee: 2, tax: 1, knocked: true },
  ]);
  const cp = run_engine(df).closed_positions[0];
  assert.ok(Math.abs(cp.total_realized_pl - -(10 * 50 + 2 + 1)) < 0.011);
});

test("saveback in summary", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 1000 },
    { datetime: dt("2025-07-02"), tx_type: "SAVEBACK", name: "S&P", symbol: "IE", asset_class: "FUND", amount: 5 },
  ]);
  assert.equal(run_engine(df).summary.total_saveback, 5);
});

test("total income in summary", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 1000 },
    { datetime: dt("2025-06-02"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 0, tax: 0 },
    { datetime: dt("2025-07-06"), tx_type: "DIVIDEND", name: "X", symbol: "X", asset_class: "STOCK", amount: 20 },
    { datetime: dt("2025-07-01"), tx_type: "INTEREST", amount: 3 },
    { datetime: dt("2025-07-02"), tx_type: "SAVEBACK", name: "X", symbol: "X", asset_class: "FUND", amount: 2 },
  ]);
  const s = run_engine(df).summary;
  assert.equal(s.total_realized_pl, 100);
  assert.equal(s.total_dividends, 20);
  assert.equal(s.total_interest, 3);
  assert.equal(s.total_saveback, 2);
  assert.ok(Math.abs(s.total_income - 125) < 0.011);
});

test("warrant exercise no duplicate shares sold", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 1.5, amount: -150, fee: 1, tax: 0, knocked: true },
    { datetime: dt("2025-06-15"), tx_type: "SELL", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 0, amount: 0, fee: 0, tax: 0 },
  ]);
  const cp = run_engine(df).closed_positions[0];
  assert.equal(cp.total_shares_sold, 100);
  assert.equal(cp.closed_lots, 1);
});

test("knocked loss booked at exercise month", () => {
  const df = makeDf([
    { datetime: dt("2025-01-15"), type: "BUY", tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 2, tax: 0, transaction_id: "b1", knocked: true },
    { datetime: dt("2025-03-06"), type: "WARRANT_EXERCISE", tx_type: "SELL", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 0, amount: 0, fee: 0, tax: 0, transaction_id: "we1" },
  ]);
  const result = run_engine(df);
  assert.equal(result.monthly_pl.length, 1);
  assert.equal(result.monthly_pl[0].month, "2025-03");
  assert.ok(Math.abs(result.monthly_pl[0].realized_pl - -(100 * 5 + 2)) < 0.011);
});

test("knocked loss cross year goes to disposal year", () => {
  const df = makeDf([
    { datetime: dt("2025-12-20"), type: "BUY", tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 0, tax: 0, transaction_id: "b1", knocked: true },
    { datetime: dt("2026-01-10"), type: "WARRANT_EXERCISE", tx_type: "SELL", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 100, price: 0, amount: 0, fee: 0, tax: 0, transaction_id: "we1" },
  ]);
  assert.equal(run_engine(df).monthly_pl[0].month, "2026-01");
});

test("tilg consumes open lots", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "W", symbol: "DE100", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "W", symbol: "DE100", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 300, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  const cp = result.closed_positions[0];
  assert.ok(Math.abs(cp.total_realized_pl - (300 - 500)) < 0.011);
  assert.equal(cp.total_shares_sold, 100);
  assert.deepEqual(result.monthly_pl, [{ month: "2025-06", realized_pl: -200 }]);
});

test("tilg does not touch lots bought after", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "W", symbol: "DE101", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 0, tax: 0 },
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "W", symbol: "DE101", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 300, fee: 0, tax: 0 },
    { datetime: dt("2025-06-25"), tx_type: "BUY", name: "W", symbol: "DE101", asset_class: "DERIVATIVE", shares: 50, price: 6, amount: -300, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  const op = result.open_positions[0];
  assert.equal(Math.round(op.shares * 1e4) / 1e4, 50);
  assert.equal(op.total_cost, 300);
  assert.ok(Math.abs(result.closed_positions[0].total_realized_pl - -200) < 0.011);
});

test("tilg only isin appears in closed positions", () => {
  const df = makeDf([
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "ORPHAN", symbol: "DE102", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 25, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.closed_positions.length, 1);
  assert.equal(result.closed_positions[0].total_realized_pl, 25);
  assert.deepEqual(result.monthly_pl, [{ month: "2025-06", realized_pl: 25 }]);
});

test("unmatched sell creates short position", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  const op = result.open_positions[0];
  assert.equal(Math.round(op.shares * 1e4) / 1e4, -10);
  assert.equal(op.total_cost, -600);
  assert.equal(result.closed_positions.length, 0);
  assert.equal(result.summary.total_realized_pl, 0);
});

test("short covered by later buy", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  const cp = result.closed_positions[0];
  assert.ok(Math.abs(cp.total_realized_pl - 100) < 0.011);
  assert.equal(cp.total_shares_sold, 10);
  assert.deepEqual(result.monthly_pl, [{ month: "2025-07", realized_pl: 100 }]);
});

test("zero price unmatched sell leaves no short", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "T", symbol: "T", asset_class: "DERIVATIVE", shares: 100, price: 1.5, amount: -150, fee: 1, tax: 0, knocked: true },
    { datetime: dt("2025-06-15"), tx_type: "SELL", name: "T", symbol: "T", asset_class: "DERIVATIVE", shares: 100, price: 0, amount: 0, fee: 0, tax: 0 },
  ]);
  assert.equal(run_engine(df).open_positions.length, 0);
});

test("dust lot cost booked on sell", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10.0005, price: 100, amount: -1000.05, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 100, amount: 1000, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  assert.ok(Math.abs(result.closed_positions[0].total_realized_pl - -0.05) < 0.011);
});

test("leftover dust written off at last event", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 0.0005, price: 1000, amount: -0.5, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.open_positions.length, 0);
  assert.ok(Math.abs(result.closed_positions[0].total_realized_pl - -0.5) < 0.011);
  assert.deepEqual(result.monthly_pl, [{ month: "2025-06", realized_pl: -0.5 }]);
});

test("dividend withholding tax fields", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 6, price: 100, amount: -600, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "DIVIDEND", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 6, price: 0, amount: 1.14, fee: 0, tax: -0.17 },
  ]);
  const result = run_engine(df);
  const p = result.products[0];
  assert.equal(p.total_dividends, 1.14);
  assert.equal(p.total_dividend_tax, 0.17);
  assert.equal(p.total_dividends_net, 0.97);
  const s = result.summary;
  assert.equal(s.total_dividends, 1.14);
  assert.equal(s.total_dividend_tax, 0.17);
  assert.equal(s.total_dividends_net, 0.97);
});

test("dividend for untraded isin creates product", () => {
  const df = makeDf([
    { datetime: dt("2025-07-01"), tx_type: "DIVIDEND", name: "ORPHAN", symbol: "XX", asset_class: "STOCK", shares: 0, price: 0, amount: 5, fee: 0, tax: 0 },
  ]);
  const result = run_engine(df);
  assert.equal(result.products.length, 1);
  const p = result.products[0];
  assert.equal(p.isin, "XX");
  assert.equal(p.total_dividends, 5);
  assert.equal(p.total_trades, 0);
});

test("negative dividend adjustment reduces total", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 6, price: 100, amount: -600, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "DIVIDEND", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 0, price: 0, amount: 10, fee: 0, tax: 0 },
    { datetime: dt("2025-08-01"), tx_type: "DIVIDEND", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 0, price: 0, amount: -2, fee: 0, tax: 0 },
  ]);
  assert.equal(run_engine(df).summary.total_dividends, 8);
});

test("derivative executions include buy tax", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), type: "BUY", tx_type: "BUY", name: "TURBO", symbol: "TURBO", asset_class: "DERIVATIVE", shares: 10, price: 50, amount: -500, fee: 2, tax: 1, transaction_id: "b1", knocked: true },
  ]);
  const entries = compute_derivative_executions(df, new Set(["b1"]));
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.ko_loss, -500);
  assert.equal(e.ko_fees, -2);
  assert.equal(e.ko_tax, -1);
  assert.equal(e.ko_total, -503);
  const eng = run_engine(df);
  assert.ok(Math.abs(eng.closed_positions[0].total_realized_pl - e.ko_total) < 0.011);
});

test("reconciliation balances on full cycle", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 2000 },
    { datetime: dt("2025-06-02"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 1, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 1, tax: 0 },
    { datetime: dt("2025-07-06"), tx_type: "DIVIDEND", name: "X", symbol: "X", asset_class: "STOCK", amount: 20 },
    { datetime: dt("2025-07-10"), tx_type: "CARD", name: "SHOP", amount: -30 },
    { datetime: dt("2025-07-15"), tx_type: "INTEREST", amount: 5 },
  ]);
  const rec = run_engine(df).summary.reconciliation;
  assert.equal(rec.net_deposits, 2000);
  assert.ok(Math.abs(rec.realized_pl - 98) < 0.011);
  assert.ok(Math.abs(rec.cash_balance - 2093) < 0.011);
  assert.equal(rec.open_positions_cost, 0);
  assert.equal(rec.card_spending, 30);
  assert.ok(Math.abs(rec.difference) <= 0.01);
});

test("reconciliation captures standalone fee column", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "DEPOSIT", amount: 2000 },
    { datetime: dt("2025-06-02"), tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 1, tax: 0 },
    { datetime: dt("2025-06-03"), tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 1, tax: 0 },
    { datetime: dt("2025-07-15"), tx_type: "FEE", name: "TR", amount: 0, fee: -5 },
  ]);
  const rec = run_engine(df).summary.reconciliation;
  assert.ok(Math.abs(rec.cash_balance - 2093) < 0.011);
  assert.equal(rec.fees, 5);
  assert.ok(Math.abs(rec.difference) <= 0.01);
});

test("lot matches recorded per lot", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0, transaction_id: "b1" },
    { datetime: dt("2025-06-15"), tx_type: "BUY", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 10, price: 120, amount: -1200, fee: 0, tax: 0, transaction_id: "b2" },
    { datetime: dt("2025-07-01"), tx_type: "SELL", name: "S&P", symbol: "SP", asset_class: "FUND", shares: 15, price: 130, amount: 1950, fee: 0, tax: 0, transaction_id: "s1" },
  ]);
  const matches = run_engine(df).lot_matches;
  assert.equal(matches.length, 2);
  assert.equal(matches[0].sell_id, "s1");
  assert.equal(matches[0].shares, 10);
  assert.equal(matches[0].cost_basis, 1000);
  assert.equal(matches[0].proceeds, 1300);
  assert.equal(matches[0].pl, 300);
  assert.ok(matches[0].lot_datetime.startsWith("2025-06-01"));
  assert.equal(matches[1].shares, 5);
  assert.equal(matches[1].cost_basis, 600);
  assert.ok(matches[1].lot_datetime.startsWith("2025-06-15"));
});

test("lot matches for knocked and tilg", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "W", symbol: "DE200", asset_class: "DERIVATIVE", shares: 100, price: 5, amount: -500, fee: 0, tax: 0, transaction_id: "b1", knocked: true },
    { datetime: dt("2025-06-20"), tx_type: "TILG", name: "W", symbol: "DE200", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 50, fee: 0, tax: 0, transaction_id: "t1" },
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "Y", symbol: "DE201", asset_class: "DERIVATIVE", shares: 10, price: 10, amount: -100, fee: 0, tax: 0, transaction_id: "b2" },
    { datetime: dt("2025-07-01"), tx_type: "TILG", name: "Y", symbol: "DE201", asset_class: "DERIVATIVE", shares: 0, price: 0, amount: 30, fee: 0, tax: 0, transaction_id: "t2" },
  ]);
  const matches = run_engine(df).lot_matches;
  const ko = matches.filter((m) => m.isin === "DE200");
  assert.equal(ko.length, 1);
  assert.equal(ko[0].proceeds, 0);
  assert.equal(ko[0].pl, -500);
  const tilg = matches.filter((m) => m.isin === "DE201");
  assert.equal(tilg.length, 1);
  assert.equal(tilg[0].proceeds, 30);
  assert.equal(tilg[0].cost_basis, 100);
  assert.equal(tilg[0].pl, -70);
  assert.equal(tilg[0].sell_id, "t2");
});

test("apply prices computes unrealized", () => {
  const positions = [
    { isin: "A", name: "A", asset_class: "STOCK", shares: 10, average_cost: 50, total_cost: 500 },
    { isin: "B", name: "B", asset_class: "FUND", shares: 5, average_cost: 100, total_cost: 500 },
  ];
  const valued = apply_prices(positions, { A: 60 });
  const [a, b] = valued.positions;
  assert.equal(a.market_price, 60);
  assert.equal(a.market_value, 600);
  assert.equal(a.unrealized_pl, 100);
  assert.equal(b.market_price, null);
  assert.equal(b.market_value, null);
  assert.equal(b.unrealized_pl, null);
  assert.equal(valued.totals.market_value, 600);
  assert.equal(valued.totals.unrealized_pl, 100);
});

test("apply prices empty prices", () => {
  const valued = apply_prices([{ isin: "A", name: "A", asset_class: "STOCK", shares: 1, average_cost: 10, total_cost: 10 }], {});
  assert.equal(valued.totals.market_value, 0);
  assert.equal(valued.positions[0].market_price, null);
});

test("apply prices accepts legacy flat price", () => {
  const valued = apply_prices([{ isin: "A", name: "A", asset_class: "STOCK", shares: 10, average_cost: 50, total_cost: 500 }], { A: 60 });
  assert.equal(valued.positions[0].market_price, 60);
  assert.equal(valued.totals.market_value, 600);
});

test("apply prices accepts nested price dict", () => {
  const valued = apply_prices(
    [{ isin: "A", name: "A", asset_class: "STOCK", shares: 10, average_cost: 50, total_cost: 500 }],
    { A: { price: 60, source: "yahoo" } }
  );
  assert.equal(valued.positions[0].market_price, 60);
  assert.equal(valued.totals.market_value, 600);
});

test("compute income monthly and history", () => {
  const df = makeDf([
    { datetime: dt("2025-06-15"), tx_type: "DIVIDEND", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 0, price: 0, amount: 10, fee: 0, tax: -1.5, currency: "EUR", original_currency: "USD" },
    { datetime: dt("2025-06-20"), tx_type: "INTEREST", amount: 2, currency: "EUR", original_currency: "" },
    { datetime: dt("2025-07-02"), tx_type: "SAVEBACK", name: "S&P", symbol: "IE", asset_class: "FUND", amount: 3, currency: "EUR", original_currency: "" },
  ]);
  const income = compute_income(df);
  const jun = income.monthly.find((m) => m.month === "2025-06");
  assert.ok(jun);
  assert.equal(jun.dividends, 8.5);
  assert.equal(jun.interest, 2);
  assert.equal(jun.total, 10.5);
  const jul = income.monthly.find((m) => m.month === "2025-07");
  assert.ok(jul);
  assert.equal(jul.saveback, 3);
  assert.equal(income.dividends.length, 1);
  const d = income.dividends[0];
  assert.equal(d.gross, 10);
  assert.equal(d.wht, 1.5);
  assert.equal(d.net, 8.5);
  assert.equal(d.currency, "USD");
});

test("yield on cost for open product", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 10, price: 100, amount: -1000, fee: 0, tax: 0 },
    { datetime: dt("2025-07-01"), tx_type: "DIVIDEND", name: "ABC", symbol: "US1", asset_class: "STOCK", shares: 0, price: 0, amount: 25, fee: 0, tax: 0 },
  ]);
  assert.equal(run_engine(df).products[0].yield_on_cost, 2.5);
});

test("open position weights", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "A", symbol: "A", asset_class: "STOCK", shares: 10, price: 30, amount: -300, fee: 0, tax: 0 },
    { datetime: dt("2025-06-01"), tx_type: "BUY", name: "B", symbol: "B", asset_class: "STOCK", shares: 10, price: 10, amount: -100, fee: 0, tax: 0 },
  ]);
  const weights = Object.fromEntries(run_engine(df).open_positions.map((p) => [p.isin, p.weight]));
  assert.equal(weights.A, 0.75);
  assert.equal(weights.B, 0.25);
});

test("compute spending categories and refunds", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "CARD", name: "INTERMARCHE", amount: -50, mcc_code: "5411" },
    { datetime: dt("2025-06-02"), tx_type: "CARD", name: "RESTAURANT", amount: -30, mcc_code: "5812" },
    { datetime: dt("2025-06-03"), tx_type: "CARD", name: "INTERMARCHE", amount: 10, mcc_code: "5411" },
    { datetime: dt("2025-06-04"), tx_type: "CARD", name: "UNKNOWN SHOP", amount: -5, mcc_code: "" },
  ]);
  const spending = compute_spending(df);
  const byCat = Object.fromEntries(spending.by_category.map((c) => [c.category, c.total]));
  assert.equal(byCat.Groceries, 40);
  assert.equal(byCat.Restaurants, 30);
  assert.equal(byCat.Other, 5);
  const jun = spending.monthly.find((m) => m.month === "2025-06");
  assert.ok(jun);
  assert.equal(jun.total, 75);
});

test("category for merchant rule overrides mcc", () => {
  const rules = [{ pattern: "ISLA", category: "Education" }];
  assert.equal(category_for_merchant("ISLA MADRID", "5812", rules), "Education");
});

test("category for merchant normalized contains longest wins", () => {
  const rules = [
    { pattern: "isla", category: "Education" },
    { pattern: "ISLA CAFE", category: "Coffee" },
  ];
  assert.equal(category_for_merchant("ISLA-CAFE", "", rules), "Coffee");
  assert.equal(category_for_merchant("isla madrid", "", rules), "Education");
});

test("category for merchant falls back to mcc", () => {
  assert.equal(category_for_merchant("INTERMARCHE", "5411", []), "Groceries");
  assert.equal(category_for_merchant("UNKNOWN SHOP", "", []), "Other");
});

test("compute spending applies user rules", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "CARD", name: "ISLA", amount: -500, mcc_code: "" },
    { datetime: dt("2025-06-02"), tx_type: "CARD", name: "INTERMARCHE", amount: -50, mcc_code: "5411" },
  ]);
  const rules = [{ pattern: "isla", category: "Education" }];
  const byCat = Object.fromEntries(compute_spending(df, rules).by_category.map((c) => [c.category, c.total]));
  assert.equal(byCat.Education, 500);
  assert.equal(byCat.Groceries, 50);
  assert.equal("Other" in byCat, false);
});

test("compute card transactions includes rule category", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "CARD", name: "ISLA", amount: -500, mcc_code: "", description: "", transaction_id: "c1" },
  ]);
  const rules = [{ pattern: "isla", category: "Education" }];
  assert.equal(compute_card_transactions(df, rules)[0].category, "Education");
});

test("uncategorized vendors lists only other and respects rules", () => {
  const df = makeDf([
    { datetime: dt("2025-06-01"), tx_type: "CARD", name: "ISLA MADRID", amount: -10, mcc_code: "" },
    { datetime: dt("2025-06-02"), tx_type: "CARD", name: "ISLA MADRID", amount: -5, mcc_code: "" },
    { datetime: dt("2025-06-03"), tx_type: "CARD", name: "INTERMARCHE", amount: -50, mcc_code: "5411" },
  ]);
  assert.deepEqual(uncategorized_vendors(df), [{ name: "ISLA MADRID", count: 2, total: 15 }]);
  assert.deepEqual(uncategorized_vendors(df, [{ pattern: "isla", category: "Education" }]), []);
});
