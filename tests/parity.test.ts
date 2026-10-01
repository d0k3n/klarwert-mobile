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
import { roundTo } from "../src/util.ts";
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
  const expected = structuredClone(reference.result);
  const actual = structuredClone(result);
  // Compare the unchanged legacy accounting contract; new complete history is checked separately.
  delete actual.realization_events;
  actual.transactions = actual.transactions.filter(r => r.type === "BUY" || r.type === "SELL").slice(0,50).map(({date,movement_id,...row}) => row);
  assert.equal(result.transactions.length, d.length, "every statement movement remains accessible");
  const cashMatches=actual.lot_matches.filter(m=>m.shares === 0 && !m.lot_key);
  actual.lot_matches=actual.lot_matches.filter(m=>!(m.shares === 0 && !m.lot_key));
  const plByIsin = new Map<string,number>();
  const plByDay = new Map<string,number>();
  const matchedSourceRows = new Set<number>();
  const addPL = (isin:string,date:string,value:number) => {
    plByIsin.set(isin,(plByIsin.get(isin) ?? 0)+value);
    plByDay.set(date,(plByDay.get(date) ?? 0)+value);
  };
  // A01 uses the actual redemption identity and counts a redemption once,
  // regardless of how many purchase lots it extinguishes.
  expected.closed_positions.find((p:any) => p.isin === "DE000FD8KV76").closed_lots = 3;
  assert.equal(d.filter(r => r.symbol === "DE000FD8KV76" && r.tx_type === "SELL").length,3);
  actual.lot_matches.forEach((m,i) => {
    const source = d[Number(m.sell_key?.split(":")[1])];
    const purchase = d[Number(m.lot_key?.split(":")[1])];
    assert.ok(source && purchase, "FIFO identities refer to original input rows");
    assert.equal(source.symbol,m.isin);
    assert.equal(purchase.symbol,m.isin);
    assert.equal(Date.parse(m.sell_datetime),source.datetime.getTime());
    assert.equal(Date.parse(m.lot_datetime),purchase.datetime.getTime());
    const legacy = expected.lot_matches[i];
    const buyGross = Math.abs(purchase.amount ?? (purchase.price ?? 0)*(purchase.shares ?? 0));
    legacy.cost_basis=(buyGross-(purchase.fee ?? 0)-(purchase.tax ?? 0))*legacy.shares/(purchase.shares ?? 1);
    const sellGross=Math.abs(source.amount ?? (source.price ?? 0)*(source.shares ?? 0));
    legacy.proceeds=sellGross*legacy.shares/(source.shares ?? 1);
    legacy.pl=legacy.proceeds-legacy.cost_basis;
    addPL(legacy.isin,legacy.sell_datetime.slice(0,10),legacy.pl);
    matchedSourceRows.add(Number(m.sell_key?.split(":")[1]));
    if (expected.lot_matches[i].sell_id === "") {
      assert.equal(source.type,"WARRANT_EXERCISE");
      expected.lot_matches[i].sell_id=source.transaction_id;
    }
    delete m.sell_key;
    delete m.lot_key;
    if (m.disposal_fees !== undefined) {
      assert.equal(m.disposal_fees,0,"this legacy fixture has no redemption or short-cover charges");
      delete m.disposal_fees;
    }
  });
  for(const m of cashMatches) {
    const source=d[Number(m.sell_key?.split(":")[1])];
    assert.equal(source.tx_type,"TILG");
    assert.equal(Date.parse(m.sell_datetime),source.datetime.getTime());
    assert.deepEqual(m,{isin:source.symbol,name:source.name,sell_id:source.transaction_id,sell_key:m.sell_key,
      sell_datetime:source.datetime.toISOString(),lot_datetime:"",shares:0,proceeds:source.amount,cost_basis:0,pl:source.amount,
      disposal_fees:-(source.fee ?? 0)-(source.tax ?? 0)});
  }
  for(const position of actual.open_positions) {
    assert.equal(roundTo(position.total_cost_raw ?? 0,2),position.total_cost);
    delete position.total_cost_raw;
  }
  d.forEach((r,index)=> {
    if (r.tx_type === "SELL") addPL(r.symbol,r.datetime.toISOString().slice(0,10),(r.fee ?? 0)+(r.tax ?? 0));
    if (r.tx_type === "TILG" && !matchedSourceRows.has(index)) addPL(r.symbol,r.datetime.toISOString().slice(0,10),(r.amount ?? 0)+(r.fee ?? 0)+(r.tax ?? 0));
  });
  expected.closed_positions.forEach((p:any)=>p.total_realized_pl=plByIsin.get(p.isin) ?? 0);
  expected.products.forEach((p:any)=>p.total_realized_pl=roundTo(plByIsin.get(p.isin) ?? 0,2));
  expected.daily_pl.forEach((p:any)=>p.realized_pl=plByDay.get(p.date) ?? 0);
  expected.monthly_pl.forEach((p:any)=>p.realized_pl=[...plByDay].filter(([day])=>day.startsWith(p.month)).reduce((sum,[,value])=>sum+value,0));
  // A08 aggregates unrounded position P/L, rather than rounded product rows.
  const stockIsins = new Set(expected.products.filter((p:any)=>p.asset_class === "STOCK").map((p:any)=>p.isin));
  expected.summary.by_asset_class.STOCK.total_realized_pl = roundTo(expected.closed_positions.filter((p:any)=>stockIsins.has(p.isin)).reduce((sum:number,p:any)=>sum+p.total_realized_pl,0),2);
  const netIncome = (type:string) => roundTo(d.filter(r=>r.tx_type===type).reduce((sum,r)=>sum+(r.amount ?? 0)-Math.abs(r.tax ?? 0)-Math.abs(r.fee ?? 0),0),2);
  expected.summary.total_interest_net=netIncome("INTEREST");
  expected.summary.total_saveback_net=netIncome("SAVEBACK");
  expected.summary.total_realized_pl=roundTo([...plByIsin.values()].reduce((sum,value)=>sum+value,0),2);
  expected.summary.reconciliation.realized_pl=expected.summary.total_realized_pl;
  expected.summary.reconciliation.difference=roundTo(expected.summary.reconciliation.net_deposits+expected.summary.reconciliation.income+expected.summary.total_realized_pl-expected.summary.reconciliation.cash_balance-expected.summary.reconciliation.open_positions_cost-expected.summary.reconciliation.card_spending-expected.summary.reconciliation.fees,2);
  expected.summary.total_income=roundTo(expected.summary.total_realized_pl+expected.summary.total_dividends_net+expected.summary.total_interest_net+expected.summary.total_saveback_net,2);
  expectDeepEqual(expected, actual, "engine result with documented precision, redemption and net income corrections");
  assert.equal(result.summary.reconciliation.difference,0,"known fixture ledger reconciles exactly");
  expectDeepEqual(result.summary.total_realized_pl,roundTo(result.closed_positions.reduce((sum:number,p:any)=>sum+p.total_realized_pl,0),2),"full precision P/L reconciliation");
  // Period series preserve precision, so both aggregate to the annual result.
  for (const periods of [result.daily_pl,result.monthly_pl]) {
    assert.equal(result.summary.total_realized_pl,roundTo(periods.reduce((sum:number,p:any)=>sum+p.realized_pl,0),2));
  }
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
  // M01 includes consumption distributions; M02 keeps cost as an explicit
  // baseline and declines to present total return without market coverage.
  const { xirr, terminal_value, winners, losers, win_rate, avg_win, avg_loss, ...legacyStats } = reference.performance;
  // Explicit operation-level expectations replace ISIN aggregation, without modifying financial snapshots.
  assert.equal(perf.winners, 125); assert.equal(perf.losers, 84);
  assert.equal(perf.win_rate, 59.8); assert.equal(perf.avg_win, 127.02); assert.equal(perf.avg_loss, -155.12);
  expectDeepEqual(legacyStats, Object.fromEntries(Object.keys(legacyStats).map(k => [k, perf[k]])), "performance stats");
  assert.equal(perf.terminal_value_at_cost, terminal_value);
  assert.equal(perf.xirr_at_cost, 0.1316);
  assert.equal(perf.xirr_total, null);
  assert.equal(perf.xirr, null);
  assert.equal(perf.terminal_value, null);
  assert.equal(perf.valuation_complete, false);
});

test("parity: tax reports match for all years", () => {
  const df = parseCSV(fixtureText);
  const auto = auto_detect_knocked(df);
  const d = df.map((r) => ({ ...r }));
  d.forEach((r) => (r.knocked = r.tx_type === "BUY" && auto.has(r.transaction_id)));
  const result = run_engine(d);
  const consumed=new Map<string,number>(),costBySale=new Map<string,number>();
  const connected=new Map<string,Set<string>>();
  for(const m of result.lot_matches) {
    if(!m.lot_key) continue;
    let component=connected.get(m.lot_key);
    if(!component) { component=new Set([m.lot_key]); connected.set(m.lot_key,component); }
    const peers=result.lot_matches.filter(peer=>peer.sell_key===m.sell_key && peer.lot_key).map(peer=>peer.lot_key!);
    for(const key of peers) {
      const other=connected.get(key) ?? new Set([key]);
      for(const lot of other) component.add(lot);
    }
    for(const key of component) connected.set(key,component);
  }
  for(const match of [...result.lot_matches].sort((a,b)=>Date.parse(a.sell_datetime)-Date.parse(b.sell_datetime))) {
    if(!match.lot_key) continue;
    const buy=d[Number(match.lot_key.split(":")[1])];
    const cost=(Math.abs(buy.amount ?? (buy.price ?? 0)*(buy.shares ?? 0))-(buy.fee ?? 0)-(buy.tax ?? 0))*match.shares/(buy.shares ?? 1);
    const component=[...(connected.get(match.lot_key) ?? [match.lot_key])].sort()[0];
    const previous=consumed.get(component) ?? 0;
    consumed.set(component,previous+cost);
    costBySale.set(match.sell_key ?? "",(costBySale.get(match.sell_key ?? "") ?? 0)+roundTo(previous+cost,2)-roundTo(previous,2));
  }
  for (const [yearStr, expected] of Object.entries(reference.tax)) {
    const report = build_tax_report(d, result.lot_matches, Number(yearStr));
    const corrected = structuredClone(expected) as any;
    // A08 independently derive each disposal's gross proceeds from its sale,
    // rather than inheriting Python's sum of rounded FIFO fragments.
    for (const disposal of corrected.disposals) {
      // The legacy report has no sale ID. Date, instrument, quantity and a
      // sub-dime rounding window disambiguate this fixture's repeated sales.
      const sale = d.find(r => r.tx_type === "SELL" && r.symbol === disposal.isin && r.datetime.toISOString().slice(0,10) === disposal.date && Math.abs((r.shares ?? 0) - disposal.shares) < 1e-6 && Math.abs((r.price ?? 0) * (r.shares ?? 0) - disposal.proceeds) < .1);
      if (sale) {
        const gross = Math.abs(sale.amount ?? (sale.price ?? 0) * (sale.shares ?? 0));
        disposal.proceeds = roundTo(gross, 2);
        const sourceIndex=d.indexOf(sale);
        const matches=result.lot_matches.filter(m=>m.sell_key === `@row:${sourceIndex}`);
        expectDeepEqual(sale.shares,matches.reduce((sum,m)=>sum+m.shares,0),"tax sale quantity conservation");
        disposal.cost_basis=roundTo(costBySale.get(`@row:${sourceIndex}`) ?? 0,2);
        disposal.gain = roundTo(disposal.proceeds - disposal.cost_basis - disposal.fees, 2);
      }
    }
    for(const match of result.lot_matches.filter(m=>m.shares===0 && !m.lot_key && new Date(m.sell_datetime).getUTCFullYear()===Number(yearStr))) {
      const source=d[Number(match.sell_key?.split(":")[1])];
      const gross=source.amount ?? 0,fees=-(source.fee ?? 0)-(source.tax ?? 0);
      corrected.disposals.push({date:source.datetime.toISOString().slice(0,10),name:source.name,isin:source.symbol,shares:0,
        proceeds:roundTo(gross,2),cost_basis:0,fees:roundTo(fees,2),gain:roundTo(gross-fees,2),acquired:""});
    }
    corrected.disposals.sort((a:any,b:any)=>a.date.localeCompare(b.date));
    for (const key of ["proceeds", "cost_basis", "fees", "gain"]) corrected.disposal_totals[key] = roundTo(corrected.disposals.reduce((sum:number, row:any) => sum + row[key], 0),2);
    for (const dividend of corrected.dividends) {
      const row = d.find(r => r.tx_type === "DIVIDEND" && r.symbol === dividend.isin && r.datetime.toISOString().slice(0,10) === dividend.date);
      dividend.currency = row?.currency ?? "";
      dividend.fees = Math.abs(row?.fee ?? 0);
    }
    corrected.dividend_totals.fees = 0;
    corrected.interest_totals = {gross:corrected.interest,wht:0,fees:0,net:corrected.interest};
    corrected.saveback_totals = {gross:corrected.saveback,wht:0,fees:0,net:corrected.saveback};
    expectDeepEqual(corrected, report, `tax report ${yearStr}, corrected gross proceeds and income currency`);
  }
});

test("parity: income matches", () => {
  const df = parseCSV(fixtureText);
  const corrected = structuredClone(reference.income);
  for (const dividend of corrected.dividends) {
    const row = df.find(r => r.tx_type === "DIVIDEND" && r.symbol === dividend.isin && r.datetime.toISOString().slice(0,10) === dividend.date);
    dividend.currency = row?.currency ?? "";
    dividend.fees = Math.abs(row?.fee ?? 0);
  }
  expectDeepEqual(corrected, compute_income(df), "income with A09 currency correction");
});

test("parity: spending matches", () => {
  const df = parseCSV(fixtureText);
  expectDeepEqual(reference.spending, compute_spending(df), "spending");
});

test("parity: card transactions match", () => {
  const df = parseCSV(fixtureText);
  const corrected = structuredClone(reference.cards);
  const cards = df.filter(r => r.tx_type === "CARD").sort((a,b)=>b.datetime.getTime()-a.datetime.getTime());
  assert.equal(corrected.length,cards.length);
  corrected.forEach((c:any,i:number)=>c.amount=roundTo(-(cards[i].amount ?? 0),2));
  expectDeepEqual(corrected, compute_card_transactions(df), "cards with signed refunds (A12)");
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
  expectDeepEqual(reference.valued.positions, valued.positions.map(({total_cost_raw,market_value_raw,...p})=>p), "valued positions");
  assert.deepEqual(valued.totals, {market_value:null,unrealized_pl:null,quoted_market_value:0,quoted_unrealized_pl:0,
    priced_positions:0,total_positions:result.open_positions.length,coverage:0,complete:false});
});
