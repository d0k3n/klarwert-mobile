import { test } from "node:test";
import assert from "node:assert/strict";

import { parseCSV } from "../src/csv.ts";

const HEADER =
  "datetime,date,account_type,category,type,asset_class,name,symbol," +
  "shares,price,amount,fee,tax,currency,original_amount," +
  "original_currency,fx_rate,description,transaction_id," +
  "counterparty_name,counterparty_iban,payment_reference,mcc_code";

function makeCsv(lines: string[]): string {
  return [HEADER, ...lines].join("\n");
}

test("parse buy trade", () => {
  const csv = makeCsv([
    "2025-06-02T14:24:16.757Z,2025-06-02,DEFAULT,TRADING,BUY,FUND,Core S&P 500 USD (Acc),IE00B5BMR087," +
      "0.182315,548.50,-100.00,,,EUR,,,,Savings plan execution,id1,,,,",
  ]);
  const df = parseCSV(csv);
  assert.equal(df.length, 1);
  const row = df[0];
  assert.equal(row.tx_type, "BUY");
  assert.equal(row.shares, 0.182315);
  assert.equal(row.price, 548.5);
  assert.equal(row.amount, -100);
  assert.equal(row.asset_class, "FUND");
  assert.equal(row.symbol, "IE00B5BMR087");
});

test("parse sell trade", () => {
  const csv = makeCsv([
    "2025-07-25T09:04:17.842Z,2025-07-25,DEFAULT,TRADING,SELL,STOCK,Novo-Nordisk (B),DK0062498333," +
      "-69.832405,61.11,4267.46,-1.00,,EUR,,,,Sell trade,id2,,,,",
  ]);
  const df = parseCSV(csv);
  assert.equal(df.length, 1);
  const row = df[0];
  assert.equal(row.tx_type, "SELL");
  assert.equal(row.shares, 69.832405);
  assert.equal(row.amount, 4267.46);
});

test("parse deposit", () => {
  const csv = makeCsv([
    "2025-05-27T11:16:23.775580Z,2025-05-27,DEFAULT,CASH,TRANSFER_INSTANT_INBOUND,,,,,,1000.00,,EUR,,,,Incoming transfer,id3,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "DEPOSIT");
});

test("parse dividend", () => {
  const csv = makeCsv([
    "2025-08-06T15:59:12.528155Z,2025-08-06,DEFAULT,CASH,DIVIDEND,STOCK,ASML,NL0010273215,8.184456,,11.13,,EUR,,,,Cash Dividend,id4,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "DIVIDEND");
});

test("parse card transaction", () => {
  const csv = makeCsv([
    "2025-05-29T10:10:34.157449Z,2025-05-29,DEFAULT,CASH,CARD_TRANSACTION,,INTERMARCHE,,,,-9.98,,EUR,,,,TR Card Transaction,id5,,,,5411",
  ]);
  const row = parseCSV(csv)[0];
  assert.equal(row.tx_type, "CARD");
  assert.equal(row.amount, -9.98);
  assert.equal(row.mcc_code, "");
  assert.equal(row.payment_reference, "5411");
});

test("parse interest", () => {
  const csv = makeCsv([
    "2025-06-01T08:38:03.339385Z,2025-06-01,DEFAULT,CASH,INTEREST_PAYMENT,,,,,,0.64,,EUR,,,,Interest payment,id6,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "INTEREST");
});

test("parse withdrawal", () => {
  const csv = makeCsv([
    "2025-09-24T11:43:23.917166Z,2025-09-24,DEFAULT,CASH,TRANSFER_INSTANT_OUTBOUND,,,,,,-500.00,,EUR,,,,Outgoing transfer,id7,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "WITHDRAWAL");
});

test("parse fee", () => {
  const csv = makeCsv([
    "2025-08-11T14:49:15.135876Z,2025-08-11,DEFAULT,CASH,CARD_ORDERING_FEE,,,,,,0.000000,-5.00,,EUR,,,,Trade Republic Card,id8,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "FEE");
});

test("parse saveback", () => {
  const csv = makeCsv([
    "2025-07-02T13:53:16.620142Z,2025-07-02,DEFAULT,CASH,BENEFITS_SAVEBACK,FUND,Core S&P 500 USD (Acc),IE00B5BMR087,,,,2.94,,EUR,,,,Your Saveback payment,id9,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "SAVEBACK");
});

test("numeric coercion", () => {
  const csv = makeCsv([
    "2025-06-02T14:24:16.757Z,2025-06-02,DEFAULT,TRADING,BUY,FUND,Fund,A,invalid,invalid,-100.00,,EUR,,,,desc,id10,,,,",
  ]);
  const row = parseCSV(csv)[0];
  assert.equal(row.shares, null);
  assert.equal(row.price, null);
  assert.equal(row.amount, -100);
});

test("duplicate transaction id dropped", () => {
  const csv = makeCsv([
    "2025-05-27T11:16:23.775580Z,2025-05-27,DEFAULT,CASH,TRANSFER_INSTANT_INBOUND,,,,,,1000.00,,,EUR,,,,Incoming,id200,,,,",
    "2025-05-27T11:16:23.775580Z,2025-05-27,DEFAULT,CASH,TRANSFER_INSTANT_INBOUND,,,,,,1000.00,,,EUR,,,,Incoming,id200,,,,",
    "2025-05-28T11:16:23.775580Z,2025-05-28,DEFAULT,CASH,TRANSFER_INSTANT_INBOUND,,,,,,500.00,,,EUR,,,,Incoming,id201,,,,",
  ]);
  assert.equal(parseCSV(csv).length, 2);
});

test("migration rows classified", () => {
  const csv = makeCsv([
    "2026-07-17T01:08:54.572Z,2026-07-17,DEFAULT,DELIVERY,MIGRATION,STOCK,Santander,ES0113900J37,-375.0,12.0487,,,,EUR,,,,MIGRATION ES0113900J37,id300,,,,",
    "2026-07-17T01:08:54.581Z,2026-07-17,DEFAULT,DELIVERY,MIGRATION,STOCK,Santander,ES0113900J37,375.0,12.0487,,,,EUR,,,,MIGRATION ES0113900J37,id301,,,,",
  ]);
  const df = parseCSV(csv);
  assert.deepEqual(df.map((r) => r.tx_type), ["MIGRATION", "MIGRATION"]);
});

test("quoted fields with commas parse correctly", () => {
  const csv = makeCsv([
    '2025-06-02T14:24:16.757Z,2025-06-02,DEFAULT,TRADING,BUY,FUND,"Fund, with comma",IE00B5BMR087,0.182315,548.50,-100.00,,,EUR,,,,desc,id11,,,,"',
  ]);
  const row = parseCSV(csv)[0];
  assert.equal(row.name, "Fund, with comma");
  assert.equal(row.tx_type, "BUY");
});

test("unrecognized row type classifies as OTHER", () => {
  const csv = makeCsv([
    "2025-06-02T14:24:16.757Z,2025-06-02,DEFAULT,WEIRD,SOMETHING_NEW,,,,,,,,,EUR,,,,desc,id12,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "OTHER");
});

test("warrant exercise classifies as SELL", () => {
  const csv = makeCsv([
    "2025-06-15T10:00:00Z,2025-06-15,DEFAULT,TRADING,WARRANT_EXERCISE,DERIVATIVE,Warrant X,DE123,100.0,0.0,0.0,0.0,0.0,EUR,,,,Exercise,id13,,,,",
  ]);
  assert.equal(parseCSV(csv)[0].tx_type, "SELL");
});
