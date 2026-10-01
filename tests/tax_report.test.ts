import { test } from "node:test";
import assert from "node:assert/strict";

import { run_engine } from "../src/engine.ts";
import { build_tax_report } from "../src/tax_report.ts";
import { makeDf, dt } from "./helpers.ts";

function makeTaxDf() {
  return makeDf([
    { datetime: dt("2025-06-01"), type: "BUY", tx_type: "BUY", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 50, amount: -500, fee: 1, tax: 0, transaction_id: "b1" },
    { datetime: dt("2026-02-01"), type: "SELL", tx_type: "SELL", name: "X", symbol: "X", asset_class: "STOCK", shares: 10, price: 60, amount: 600, fee: 1, tax: 0, transaction_id: "s1" },
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
  assert.equal(div.currency, "EUR");
  assert.deepEqual(report.dividend_totals, { gross: 20, wht: 3, fees: 0, net: 17 });
  assert.equal(report.interest, 5);
  assert.equal(report.saveback, 0);
});


test("anonymous simultaneous sales retain separate commissions", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"BUY",symbol:"X",shares:2,price:100,amount:-200},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1,price:200,amount:200,fee:1},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1,price:200,amount:200,fee:100}]);
  const result=run_engine(df),report=build_tax_report(df,result.lot_matches,2025);
  assert.equal(report.disposals.length,2);
  assert.deepEqual(report.disposals.map((d:any)=>d.fees),[1,100]);
  assert.equal(report.disposal_totals.fees,101);
  assert.equal(report.disposal_totals.gain,99);
});

test("tax aggregates lot precision before monetary rounding", () => {
  const df=makeDf([...Array.from({length:3},(_,i)=>({datetime:`2025-01-0${i+1}`,tx_type:"BUY",symbol:"X",shares:1,price:.1,amount:-.1})),
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:3,price:1/3,amount:1}]);
  const report=build_tax_report(df,run_engine(df).lot_matches,2025);
  assert.equal(report.disposals[0].proceeds,1);
  assert.equal(report.disposal_totals.gain,.7);
});

test("dividend reversals cancel signed withholding and fees; interest reports net", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"DIVIDEND",amount:100,tax:-15,fee:-1,currency:"EUR",original_currency:"USD"},
    {datetime:"2025-01-02",tx_type:"DIVIDEND",amount:-100,tax:15,fee:1,currency:"EUR",original_currency:"USD"},
    {datetime:"2025-01-03",tx_type:"INTEREST",amount:100,tax:-20,fee:-1}]);
  const report=build_tax_report(df,[],2025);
  assert.deepEqual(report.dividend_totals,{gross:0,wht:0,fees:0,net:0});
  assert.equal(report.dividends[1].wht,-15);
  assert.equal(report.dividends[1].fees,-1);
  assert.equal(report.dividends[0].currency,"EUR");
  assert.deepEqual(report.interest_totals,{gross:100,wht:20,fees:1,net:79});
});

test("user IDs resembling internal row keys cannot collide with anonymous sale fees", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"BUY",symbol:"X",shares:2,price:100,amount:-200},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1,price:200,amount:200,fee:1},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1,price:200,amount:200,fee:100,transaction_id:"@row:1"}]);
  const report=build_tax_report(df,run_engine(df).lot_matches,2025);
  assert.deepEqual(report.disposals.map((d:any)=>d.fees),[1,100]);
  assert.equal(report.disposal_totals.gain,99);
});

test("saveback exposes gross charges and net", () => {
  const report=build_tax_report(makeDf([{datetime:"2025-01-01",tx_type:"SAVEBACK",amount:10,fee:-1,tax:-2}]),[],2025);
  assert.deepEqual(report.saveback_totals,{gross:10,wht:2,fees:1,net:7});
});

test("short-cover tax gain includes original sale fees and purchase costs once", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"SELL",symbol:"X",shares:10,price:60,amount:600,fee:1},
    {datetime:"2025-02-01",tx_type:"BUY",symbol:"X",shares:10,price:50,amount:-500,fee:2,tax:3}]);
  const result=run_engine(df),report=build_tax_report(df,result.lot_matches,2025);
  assert.equal(report.disposal_totals.proceeds,600);
  assert.equal(report.disposal_totals.cost_basis,505);
  assert.equal(report.disposal_totals.fees,1);
  assert.equal(report.disposal_totals.gain,94);
  assert.equal(result.summary.total_realized_pl,94);
});

test("signed zero-gross withholding refund remains income in tax totals", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"INTEREST",amount:0,tax:15,fee:0,charges_signed:true}]);
  assert.deepEqual(build_tax_report(df,[],2025).interest_totals,{gross:0,wht:-15,fees:0,net:15});
});

test("redemption tax gain subtracts redemption expenses exactly once", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"BUY",symbol:"X",shares:10,price:50,amount:-500},
    {datetime:"2025-02-01",tx_type:"TILG",symbol:"X",shares:10,amount:600,fee:2,tax:3}]);
  const result=run_engine(df),report=build_tax_report(df,result.lot_matches,2025);
  assert.equal(report.disposal_totals.proceeds,600);
  assert.equal(report.disposal_totals.fees,5);
  assert.equal(report.disposal_totals.gain,95);
  assert.equal(result.summary.total_realized_pl,95);
});

test("tax totals reconcile finalized operations without reallocating cents", () => {
  const df=makeDf(Array.from({length:3},(_,i)=>[
    {datetime:`2025-01-0${i+1}`,tx_type:"BUY",symbol:`X${i}`,shares:1,price:.101,amount:-.101},
    {datetime:`2025-02-0${i+1}`,tx_type:"SELL",symbol:`X${i}`,shares:1,price:.335,amount:.335},
  ]).flat());
  const report=build_tax_report(df,run_engine(df).lot_matches,2025);
  assert.equal(report.disposal_totals.proceeds,1.02);
  for (const disposal of report.disposals) {
    assert.equal(disposal.proceeds,.34);
    assert.equal(disposal.gain,.24);
  }
  for (const field of ["proceeds","cost_basis","fees","gain"]) {
    assert.ok(Math.abs(report.disposals.reduce((sum:number,d:any)=>sum+d[field],0)-report.disposal_totals[field])<1e-9);
  }
});




test("tax carries a lot's cost cents through partial sales and year boundaries", () => {
  const df=makeDf([{datetime:"2024-01-01",tx_type:"BUY",symbol:"X",shares:3,price:1/3,amount:-1},
    {datetime:"2024-02-01",tx_type:"SELL",symbol:"X",shares:1,price:1,amount:1},
    {datetime:"2025-01-01",tx_type:"SELL",symbol:"X",shares:1,price:1,amount:1},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1,price:1,amount:1}]);
  const matches=run_engine(df).lot_matches;
  const a=build_tax_report(df,matches,2024),b=build_tax_report(df,matches,2025);
  assert.equal(a.disposal_totals.cost_basis,.33);
  assert.deepEqual(b.disposals.map((d:any)=>d.cost_basis),[.34,.33]);
  assert.equal(a.disposal_totals.cost_basis+b.disposal_totals.cost_basis,1);
  assert.equal(a.disposal_totals.gain+b.disposal_totals.gain,2);
  assert.deepEqual(b.disposals.map((d:any)=>d.proceeds),[1,1]);
});

test("cash settlement after warrant expiration contributes gross proceeds and expenses", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"BUY",symbol:"X",shares:10,price:50,amount:-500},
    {datetime:"2025-02-01",type:"WARRANT_EXERCISE",tx_type:"SELL",symbol:"X",shares:10},
    {datetime:"2025-02-02",tx_type:"TILG",symbol:"X",amount:600,fee:2,tax:3}]);
  const result=run_engine(df),report=build_tax_report(df,result.lot_matches,2025);
  assert.equal(report.disposal_totals.proceeds,600);
  assert.equal(report.disposal_totals.cost_basis,500);
  assert.equal(report.disposal_totals.fees,5);
  assert.equal(report.disposal_totals.gain,95);
});

test("tax preserves material quantities smaller than six decimals", () => {
  const df=makeDf([{datetime:"2025-01-01",tx_type:"BUY",symbol:"X",shares:1e-7,price:1e9,amount:-100},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:1e-7,price:2e9,amount:200}]);
  assert.equal(build_tax_report(df,run_engine(df).lot_matches,2025).disposals[0].shares,1e-7);
});

test("tax aggregates sub-cent bases of lots consumed in the same sale", () => {
  const df=makeDf([...Array.from({length:3},(_,i)=>({datetime:`2025-01-0${i+1}`,tx_type:"BUY",symbol:"X",shares:1,price:.004,amount:-.004})),
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:3,price:1/3,amount:1}]);
  const report=build_tax_report(df,run_engine(df).lot_matches,2025);
  assert.equal(report.disposals[0].cost_basis,.01);
  assert.equal(report.disposals[0].gain,.99);
});

test("lots linked by a FIFO disposal share the cumulative basis carry", () => {
  const df=makeDf([{datetime:"2024-01-01",tx_type:"BUY",symbol:"X",shares:3,price:1/3,amount:-1},
    {datetime:"2024-01-02",tx_type:"BUY",symbol:"X",shares:3,price:1/3,amount:-1},
    {datetime:"2024-02-01",tx_type:"SELL",symbol:"X",shares:2,price:.5,amount:1},
    {datetime:"2025-01-01",tx_type:"SELL",symbol:"X",shares:2,price:.5,amount:1},
    {datetime:"2025-02-01",tx_type:"SELL",symbol:"X",shares:2,price:.5,amount:1}]);
  const matches=run_engine(df).lot_matches;
  const a=build_tax_report(df,matches,2024),b=build_tax_report(df,matches,2025);
  assert.equal(a.disposals[0].cost_basis,.67);
  assert.deepEqual(b.disposals.map((d:any)=>d.cost_basis),[.66,.67]);
  assert.equal(a.disposal_totals.cost_basis+b.disposal_totals.cost_basis,2);
});
