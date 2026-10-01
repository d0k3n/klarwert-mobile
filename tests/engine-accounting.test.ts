import { test } from "node:test";
import assert from "node:assert/strict";
import { run_engine, auto_detect_knocked, compute_derivative_executions, compute_income, compute_card_transactions, apply_prices } from "../src/engine.ts";
import { build_tax_report } from "../src/tax_report.ts";
import { makeDf, dt } from "./helpers.ts";

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test("partial FIFO sale then knock-out extinguishes only remaining shares", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", type: "BUY", asset_class: "DERIVATIVE", symbol: "KO", shares: 10, price: 50, amount: -500, transaction_id: "buy" },
    { datetime: dt("2025-02-01"), tx_type: "SELL", type: "SELL", asset_class: "DERIVATIVE", symbol: "KO", shares: 4, price: 60, amount: 240, transaction_id: "sell" },
    { datetime: dt("2025-03-01"), tx_type: "SELL", type: "WARRANT_EXERCISE", asset_class: "DERIVATIVE", symbol: "KO", shares: 6, price: 0, amount: 0, transaction_id: "expiry" },
  ]);
  const ids = auto_detect_knocked(df);
  assert.deepEqual([...ids], ["buy"]);
  const marked = df.map(row => ({ ...row, knocked: ids.has(row.transaction_id) }));
  const result = run_engine(marked);
  assert.deepEqual(result.open_positions, []);
  assert.equal(result.summary.total_realized_pl, -260);
  assert.deepEqual(result.daily_pl, [{ date: "2025-02-01", realized_pl: 40 }, { date: "2025-03-01", realized_pl: -300 }]);
  assert.equal(result.closed_positions[0].total_shares_sold, 10);
  assert.equal(compute_derivative_executions(df, ids)[0].ko_total, -300);
  assert.equal(compute_derivative_executions(df, ids)[0].ko_quantity, 6);
  close(result.lot_matches.reduce((a,m)=>a+m.shares,0), 10);
  close(result.lot_matches.reduce((a,m)=>a+m.cost_basis,0), 500);
});

test("automatic knock-out detection does not consume future purchases", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", asset_class: "DERIVATIVE", symbol: "K", shares: 1, transaction_id: "past" },
    { datetime: dt("2025-02-01"), tx_type: "SELL", type: "WARRANT_EXERCISE", asset_class: "DERIVATIVE", symbol: "K", shares: 1 },
    { datetime: dt("2025-03-01"), tx_type: "BUY", asset_class: "DERIVATIVE", symbol: "K", shares: 1, transaction_id: "future" },
  ]);
  assert.deepEqual([...auto_detect_knocked(df)], ["past"]);
});

for (const shares of [0.001, 0.0005, 0.000001]) {
  test(`complete fractional sale ${shares} preserves quantity and money`, () => {
    const price = 100 / shares;
    const df = makeDf([
      { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "F", shares, price, amount: -100 },
      { datetime: dt("2025-02-01"), tx_type: "SELL", symbol: "F", shares, price, amount: 100 },
    ]);
    const result = run_engine(df);
    assert.deepEqual(result.open_positions, []);
    assert.equal(result.summary.total_realized_pl, 0);
    close(result.lot_matches[0].cost_basis, 100);
    close(result.lot_matches[0].proceeds, 100);
    close(result.lot_matches[0].shares, shares);
    assert.deepEqual(result.daily_pl, [{ date: "2025-02-01", realized_pl: 0 }]);
  });
}

test("interest and redemption deduct charges from cash and net income", () => {
  const interest = run_engine(makeDf([
    { datetime: dt("2025-01-01"), tx_type: "DEPOSIT", amount: 1000 },
    { datetime: dt("2025-02-01"), tx_type: "INTEREST", amount: 100, tax: -20, fee: -1 },
  ]));
  assert.equal(interest.summary.reconciliation.cash_balance, 1079);
  assert.equal(interest.summary.total_interest_net, 79);
  assert.equal(interest.summary.reconciliation.difference, 0);
  const redemption = run_engine(makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "R", shares: 10, price: 50, amount: -500 },
    { datetime: dt("2025-02-01"), tx_type: "TILG", symbol: "R", amount: 600, fee: -2, tax: -3 },
  ]));
  assert.equal(redemption.summary.total_realized_pl, 95);
  assert.equal(redemption.summary.reconciliation.cash_balance, 95);
  assert.equal(redemption.summary.reconciliation.difference, 0);
});

test("cover purchase apportions charges between short coverage and remaining holding", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "SELL", symbol: "S", shares: 10, price: 60, amount: 600, fee: -1 },
    { datetime: dt("2025-02-01"), tx_type: "BUY", symbol: "S", shares: 20, price: 50, amount: -1000, fee: -4, tax: -6 },
  ]);
  const result = run_engine(df);
  assert.equal(result.summary.total_realized_pl, 94);
  assert.equal(result.open_positions[0].total_cost, 505);
  assert.equal(result.summary.reconciliation.difference, 0);
  assert.equal(result.lot_matches[0].cost_basis, 505);
  assert.equal(result.lot_matches[0].disposal_fees, 1);
});

test("lot matches retain sub-cent precision until aggregation", () => {
  const df = makeDf([
    ...[1,2,3].map(day => ({ datetime: dt(`2025-01-0${day}`), tx_type: "BUY", symbol: "L", shares: 1, price: 0.1, amount: -0.1 })),
    { datetime: dt("2025-02-01"), tx_type: "SELL", symbol: "L", shares: 3, price: 1/3, amount: 1 },
  ]);
  const result = run_engine(df);
  close(result.lot_matches.reduce((a,m)=>a+m.proceeds,0),1);
  close(result.lot_matches.reduce((a,m)=>a+m.pl,0),0.7);
});

test("dividend reversals cancel withholding and use amount currency", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "DIVIDEND", symbol: "D", amount: 100, tax: -15, fee: -1, currency: "EUR", original_currency: "USD" },
    { datetime: dt("2025-01-02"), tx_type: "DIVIDEND", symbol: "D", amount: -100, tax: 15, fee: 1, currency: "EUR", original_currency: "USD" },
  ]);
  const result = run_engine(df);
  assert.equal(result.summary.total_dividend_tax, 0);
  assert.equal(result.products[0].total_dividends_net, 0);
  assert.equal(result.summary.reconciliation.cash_balance, 0);
  const income = compute_income(df);
  assert.equal(income.monthly[0].total, 0);
  assert.ok(income.dividends.every(row=>row.currency === "EUR"));
  assert.equal(income.dividends.reduce((a,row)=>a+row.wht,0),0);
});

test("card details retain the sign of refunds", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "CARD", amount: -100 },
    { datetime: dt("2025-01-02"), tx_type: "CARD", amount: 40 },
  ]);
  assert.equal(compute_card_transactions(df).reduce((a,row)=>a+row.amount,0),60);
  assert.equal(run_engine(df).summary.total_card_spending,60);
});

test("unknown or invalid quotes do not produce total valuations", () => {
  const positions = [{ isin: "Q", name: "Q", asset_class: "STOCK", shares: 1, average_cost: 10, total_cost: 10 }];
  for (const price of [Infinity, -1, NaN]) {
    const result = apply_prices(positions, { Q: price });
    assert.equal(result.totals.market_value,null);
    assert.equal(result.totals.coverage,0);
  }
  assert.equal(apply_prices(positions,{ Q: 0 }).totals.market_value,0);
  assert.equal(apply_prices([],{}).totals.market_value,0);
});


test("signed charge refunds are preserved even without a negative income amount", () => {
  const df = makeDf([{ datetime: dt("2025-01-01"), tx_type: "INTEREST", amount: 0, tax: 15 }]);
  df[0].charges_signed = true;
  const result = run_engine(df);
  assert.equal(result.summary.total_interest_net, 15);
  assert.equal(result.summary.reconciliation.cash_balance, 15);
  assert.equal(result.summary.reconciliation.difference, 0);
  assert.equal(compute_income(df).monthly[0].interest, 15);
  const dividends = makeDf([{ datetime: dt("2025-01-01"), tx_type: "DIVIDEND", symbol: "D", amount: 0, tax: 15 }]);
  dividends[0].charges_signed = true;
  assert.equal(compute_income(dividends).dividends[0].wht, -15);
});


test("floating point residue creates neither phantom positions nor lot matches", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "F", shares: 0.1, price: 100, amount: -10 },
    { datetime: dt("2025-01-02"), tx_type: "BUY", symbol: "F", shares: 0.2, price: 100, amount: -20 },
    { datetime: dt("2025-02-01"), tx_type: "SELL", symbol: "F", shares: 0.3, price: 100, amount: 30 },
  ]);
  const result = run_engine(df);
  assert.deepEqual(result.open_positions, []);
  assert.equal(result.lot_matches.length, 2);
  assert.equal(result.closed_positions[0].closed_lots, 1);
  assert.equal(result.summary.total_realized_pl, 0);
});

test("signed buy commission refund reduces the cost basis", () => {
  const df = makeDf([{ datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "F", shares: 1, price: 100, amount: -100, fee: 2 }]);
  df[0].charges_signed = true;
  const result = run_engine(df);
  assert.equal(result.open_positions[0].total_cost, 98);
  assert.equal(result.summary.reconciliation.cash_balance, -98);
  assert.equal(result.summary.reconciliation.difference, 0);
});


for (const tx_type of ["DEPOSIT", "WITHDRAWAL", "CARD"]) {
  test(`non-investment ${tx_type} charges reconcile as standalone expenses`, () => {
    const df = makeDf([{ datetime: dt("2025-01-01"), tx_type, amount: tx_type === "DEPOSIT" ? 100 : -100, fee: -1, tax: -2 }]);
    df[0].charges_signed = true;
    const result = run_engine(df);
    assert.equal(result.summary.reconciliation.fees, 3);
    assert.equal(result.summary.reconciliation.difference, 0);
  });
}

test("gross settlement overrides rounded unit prices for complete and partial FIFO sales", () => {
  const buy = { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "G", shares: 3, price: 0.333333, amount: -1 };
  const sell = { datetime: dt("2025-02-01"), tx_type: "SELL", symbol: "G", shares: 3, price: 0.666667, amount: 2 };
  const complete = run_engine(makeDf([buy,sell]));
  assert.equal(complete.summary.total_realized_pl, 1);
  assert.equal(complete.summary.reconciliation.difference, 0);
  assert.deepEqual(complete.open_positions, []);
  close(complete.lot_matches[0].cost_basis, 1);
  close(complete.lot_matches[0].proceeds, 2);
  const partial = run_engine(makeDf([buy,{...sell, shares: 1, amount: 0.67}]));
  assert.equal(partial.open_positions[0].shares, 2);
  assert.equal(partial.open_positions[0].total_cost, 0.67);
  close(partial.lot_matches[0].cost_basis, 1/3);
  close(partial.lot_matches[0].proceeds, 0.67);
  assert.equal(partial.summary.total_realized_pl, 0.34);
  assert.equal(partial.summary.reconciliation.difference, 0);
});

test("manual trades without settlement amounts retain the unit-price fallback", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "G", shares: 3, price: 1 },
    { datetime: dt("2025-02-01"), tx_type: "SELL", symbol: "G", shares: 3, price: 2 },
  ]);
  const result = run_engine(df);
  assert.equal(result.summary.total_realized_pl, 3);
  assert.equal(result.summary.reconciliation.cash_balance, 3);
  assert.equal(result.summary.reconciliation.difference, 0);
});


test("daily and monthly aggregates preserve fractional cents until presentation", () => {
  const df = makeDf([
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "A", shares: 3, amount: -1, price: 0.333333 },
    ...[1,2,3].map(day => ({ datetime: dt(`2025-0${day+1}-01`), tx_type: "SELL", symbol: "A", shares: 1, amount: 1, price: 1 })),
  ]);
  const result = run_engine(df);
  close(result.daily_pl.reduce((sum, row) => sum + row.realized_pl, 0), 2);
  close(result.monthly_pl.reduce((sum, row) => sum + row.realized_pl, 0), 2);
  assert.equal(result.summary.total_realized_pl, 2);
});


test("open cost totals aggregate before rounding individual positions", () => {
  const df = makeDf(["A","B","C"].flatMap(symbol => [
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol, shares: 3, price: 1/3, amount: -1 },
    { datetime: dt("2025-02-01"), tx_type: "SELL", symbol, shares: 2, price: 1, amount: 2 },
  ]));
  const result = run_engine(df);
  assert.equal(result.summary.reconciliation.open_positions_cost, 1);
  assert.equal(result.summary.reconciliation.difference, 0);
  assert.equal(result.summary.total_realized_pl, 4);
});


test("open positions preserve shares and costs beyond display precision", () => {
  const df = makeDf([{ datetime: dt("2025-01-01"), tx_type: "BUY", symbol: "T", shares: 0.0000001, price: 1e9, amount: -100 }]);
  const result = run_engine(df);
  assert.equal(result.open_positions[0].shares, 0.0000001);
  assert.equal(result.open_positions[0].total_cost_raw, 100);
  assert.equal(apply_prices(result.open_positions,{T:1e9}).totals.market_value,100);
  const thirds = run_engine(makeDf(["A","B","C"].flatMap(symbol => [
    { datetime: dt("2025-01-01"), tx_type: "BUY", symbol, shares: 3, price: 1/3, amount: -1 },
    { datetime: dt("2025-02-01"), tx_type: "SELL", symbol, shares: 2, price: 1, amount: 2 },
  ])));
  close(thirds.open_positions.reduce((sum,position)=>sum+(position.total_cost_raw ?? position.total_cost),0),1);
});

for (const [tx_type,amount] of [["DEPOSIT",-100],["WITHDRAWAL",100]] as const) {
  test(`${tx_type} reversals preserve external cash signs`, () => {
    const df = makeDf([{datetime:dt("2025-01-01"),tx_type,amount}]);
    const result = run_engine(df);
    assert.equal(result.summary.net_deposits,amount);
    assert.equal(result.summary.reconciliation.cash_balance,amount);
    assert.equal(result.summary.reconciliation.difference,0);
    const pair = run_engine(makeDf([{datetime:dt("2025-01-01"),tx_type,amount},{datetime:dt("2025-01-02"),tx_type,amount:-amount}]));
    assert.equal(pair.summary.net_deposits,0);
    assert.equal(pair.summary.reconciliation.cash_balance,0);
    assert.equal(pair.summary.reconciliation.difference,0);
  });
}


test("valuation overflow remains unknown and preserves finite aggregates", () => {
  const position = { isin: "V", name: "V", asset_class: "STOCK", shares: 10, total_cost: 100, average_cost: 10 };
  const overflowing = apply_prices([position],{ V: 1e308 });
  assert.equal(overflowing.totals.complete,false);
  assert.equal(overflowing.totals.priced_positions,0);
  assert.equal(overflowing.positions[0].market_value,null);
  const aggregate = apply_prices([{...position,shares:1},{...position,isin:"W",shares:1}],{V:1e308,W:1e308});
  assert.equal(aggregate.totals.complete,false);
  assert.ok(Number.isFinite(aggregate.totals.quoted_market_value));
  const thirds = apply_prices(["A","B","C"].map(isin=>({...position,isin,shares:1})),{A:1/3,B:1/3,C:1/3});
  close(thirds.positions.reduce((sum,p)=>sum+(p.market_value_raw ?? 0),0),1);
  assert.equal(thirds.totals.market_value,1);
});

for (const crossYear of [false,true]) {
  test(`cash-only redemption after extinction is represented in tax ledger (${crossYear ? "cross-year" : "same-year"})`, () => {
    const df = makeDf([
      {datetime:dt("2025-01-01"),tx_type:"BUY",symbol:"K",shares:10,price:50,amount:-500},
      {datetime:dt("2025-12-31"),tx_type:"SELL",type:"WARRANT_EXERCISE",symbol:"K",shares:10,price:0,amount:0},
      {datetime:dt(crossYear ? "2026-01-01" : "2025-12-31T12:00:00"),tx_type:"TILG",symbol:"K",amount:600,fee:-2,tax:-3},
    ]);
    const result = run_engine(df);
    assert.equal(result.summary.total_realized_pl,95);
    const year2025 = build_tax_report(df,result.lot_matches,2025).disposal_totals;
    const year2026 = build_tax_report(df,result.lot_matches,2026).disposal_totals;
    assert.equal(year2025.gain,crossYear ? -500 : 95);
    assert.equal(year2026.gain,crossYear ? 595 : 0);
    assert.equal(year2025.gain+year2026.gain,95);
  });
}


test("quantity epsilon never suppresses a material zero-price extinction", () => {
  const df = makeDf([
    {datetime:dt("2025-01-01"),tx_type:"BUY",symbol:"T",shares:1e-13,amount:-100,price:1e15},
    {datetime:dt("2025-02-01"),tx_type:"SELL",type:"WARRANT_EXERCISE",symbol:"T",shares:1e-13,amount:0,price:0},
  ]);
  const result = run_engine(df);
  assert.deepEqual(result.open_positions,[]);
  assert.equal(result.summary.total_realized_pl,-100);
  assert.equal(result.summary.reconciliation.difference,0);
});


test("monthly cash-flow preserves withdrawal and deposit reversal signs", () => {
  const df = makeDf([
    {datetime:dt("2025-01-01"),tx_type:"DEPOSIT",amount:100},
    {datetime:dt("2025-01-02"),tx_type:"WITHDRAWAL",amount:-40},
    {datetime:dt("2025-02-01"),tx_type:"DEPOSIT",amount:-100},
    {datetime:dt("2025-02-02"),tx_type:"WITHDRAWAL",amount:40},
  ]);
  const cash = run_engine(df).cash_flow;
  assert.equal(cash[0].deposit,100);
  assert.equal(cash[0].withdrawal,40);
  assert.equal(cash[1].deposit,-100);
  assert.equal(cash[1].withdrawal,-40);
});

test("recent transactions preserve small share quantities", () => {
  const df = makeDf([{datetime:dt("2025-01-01"),tx_type:"BUY",symbol:"T",shares:1e-7,price:1e9,amount:-100}]);
  assert.equal(run_engine(df).transactions[0].shares,1e-7);
});
