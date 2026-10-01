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

test("XIRR requires duration and supports annual returns above 1000%", () => {
  assert.equal(xirr([{d:dt("2025-01-01"),amount:-1000},{d:dt("2025-01-01"),amount:1000}]), null);
  const rate=xirr([{d:dt("2025-01-01"),amount:-1000},{d:dt("2025-01-31"),amount:1250}]);
  assert.ok(rate !== null);
  assert.ok(Math.abs(rate - (1.25 ** (365/30)-1)) < 1e-8);
});

test("investment return counts card spending and refunds as signed distributions", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"DEPOSIT",amount:1000},
    {datetime:"2026-01-01",tx_type:"CARD",amount:-500},
    {datetime:"2026-01-01",tx_type:"CARD",amount:100}]);
  const perf=compute_performance(df,run_engine(df));
  assert.equal(perf.terminal_value,600);
  assert.equal(perf.xirr,0);
});

test("total XIRR uses a complete market valuation at its date", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"DEPOSIT",amount:1000},
    {datetime:"2025-01-01",tx_type:"BUY",symbol:"X",name:"X",asset_class:"STOCK",shares:10,price:100,amount:-1000}]);
  const result=run_engine(df);
  const missing=compute_performance(df,result,{asOf:dt("2026-01-01")});
  assert.equal(missing.xirr_total,null);
  assert.equal(missing.terminal_value,null);
  assert.equal(missing.xirr_at_cost,0);
  const valuedPositions=result.open_positions.map(p=>({...p,market_value:1200}));
  const perf=compute_performance(df,result,{valuedPositions,asOf:dt("2026-01-01")});
  assert.equal(perf.xirr_total,.2);
  assert.equal(perf.terminal_value,1200);
  assert.equal(perf.valuation_complete,true);
  assert.throws(()=>compute_performance(df,result,{valuedPositions,asOf:dt("2024-01-01")}), /valuation date/);
});

test("partial and mismatched valuations never produce a total return", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"DEPOSIT",amount:2000},
    ...["X","Y"].map(symbol=>({datetime:"2025-01-01",tx_type:"BUY",symbol,name:symbol,asset_class:"STOCK",shares:10,price:100,amount:-1000}))]);
  const result=run_engine(df);
  const perf=compute_performance(df,result,{valuedPositions:[{...result.open_positions[0],market_value:1200}],asOf:dt("2026-01-01")});
  assert.equal(perf.priced_positions,1);
  assert.equal(perf.valuation_complete,false);
  assert.equal(perf.xirr_total,null);
});

test("XIRR rejects nonfinite inputs and ambiguous multiple roots", () => {
  assert.equal(xirr([{d:new Date("invalid"),amount:-100},{d:dt("2026-01-01"),amount:110}]),null);
  assert.equal(xirr([{d:dt("2025-01-01"),amount:-100},{d:dt("2026-01-01"),amount:Infinity}]),null);
  assert.equal(xirr([{d:dt("2025-01-01"),amount:-100},{d:dt("2026-01-01"),amount:230},{d:dt("2027-01-01"),amount:-132}]),null);
});

test("XIRR identifies three roots including two inside a single former scan interval", () => {
  assert.equal(xirr([-100,430,-592,264].map((amount,i)=>({d:dt(`${2021+i}-01-01`),amount}))),null);
});

test("performance aggregates raw cash, costs and market values before display rounding", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"DEPOSIT",amount:1},
    ...["X","Y","Z"].map(symbol=>({datetime:"2025-01-01",tx_type:"BUY",symbol,shares:1,price:.335,amount:-.335}))]);
  const result=run_engine(df);
  const valuedPositions=result.open_positions.map(p=>({...p,market_value:.34,market_value_raw:.335}));
  const perf=compute_performance(df,result,{valuedPositions,asOf:dt("2026-01-01")});
  assert.equal(perf.terminal_value_at_cost,1);
  assert.equal(perf.terminal_value,1);
  assert.equal(perf.xirr_at_cost,0);
  assert.equal(perf.xirr_total,0);
});
