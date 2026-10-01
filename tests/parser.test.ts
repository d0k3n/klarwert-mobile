import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCSV, parseCSVText } from "../src/csv.ts";

const columns = "datetime,date,account_type,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,original_amount,original_currency,fx_rate,description,transaction_id,counterparty_name,counterparty_iban,payment_reference,mcc_code".split(",");
const base = { datetime: "2025-06-02T14:24:16.757Z", date: "2025-06-02", category: "CASH", type: "TRANSFER_INSTANT_INBOUND", amount: "1000", currency: "EUR", transaction_id: "id1" };
function csv(...rows: Record<string, string>[]): string {
  const quote = (s: string) => '"' + s.replaceAll('"', '""') + '"';
  return [columns.join(","), ...rows.map(r => columns.map(c => quote(r[c] ?? "")).join(","))].join("\n");
}
const trade = { ...base, category: "TRADING", type: "BUY", symbol: "IE00B5BMR087", shares: "0.182315", price: "548.50", amount: "-100", asset_class: "FUND", name: "Core S&P 500 USD (Acc)" };

test("parse buy/sell with gross amounts and separate signed charges", () => {
  const buy = parseCSV(csv(trade))[0];
  assert.equal(buy.tx_type, "BUY"); assert.equal(buy.shares, 0.182315); assert.equal(buy.price, 548.5); assert.equal(buy.amount, -100);
  const sell = parseCSV(csv({ ...trade, type: "SELL", shares: "-69.832405", amount: "4267.46", fee: "-1" }))[0];
  assert.equal(sell.tx_type, "SELL"); assert.equal(sell.shares, 69.832405); assert.equal(sell.amount, 4267.46); assert.equal(sell.fee, -1);
});
test("marks exported charges as signed and retains positive tax and fee refunds", () => {
  const row = parseCSV(csv({ ...base, type: "DIVIDEND", symbol: "ISIN", amount: "-100", fee: "1", tax: "15" }))[0];
  assert.equal(row.charges_signed, true);
  assert.equal(row.amount, -100); assert.equal(row.fee, 1); assert.equal(row.tax, 15);
});
test("trade gross settlement signs match BUY and SELL while cash reversals remain signed", () => {
  assert.throws(() => parseCSV(csv({ ...trade, amount: "100" })), /field amount: BUY gross settlement must be nonpositive/);
  assert.throws(() => parseCSV(csv({ ...trade, type: "SELL", amount: "-100" })), /field amount: SELL gross settlement must be nonnegative/);
  assert.equal(parseCSV(csv({ ...trade, type: "SELL", amount: "0" }))[0].amount, 0);
  assert.equal(parseCSV(csv({ ...base, amount: "-100" }))[0].amount, -100);
  assert.equal(parseCSV(csv({ ...base, type: "TRANSFER_INSTANT_OUTBOUND", amount: "100" }))[0].amount, 100);
});
test("account amounts must be in EUR while foreign original amounts remain supported", () => {
  for (const row of [base, trade]) {
    assert.throws(() => parseCSV(csv({ ...row, currency: "USD" })), /line 2, field currency: unsupported account currency/);
    const parsed = parseCSV(csv({ ...row, currency: " eur ", original_currency: " usd ", original_amount: "109.5" }))[0];
    assert.equal(parsed.currency, "EUR"); assert.equal(parsed.original_currency, "USD"); assert.equal(parsed.original_amount, 109.5);
  }
});
for (const [type, tx_type] of Object.entries({ TRANSFER_INSTANT_INBOUND: "DEPOSIT", TRANSFER_INSTANT_OUTBOUND: "WITHDRAWAL", CARD_TRANSACTION: "CARD", CARD_TRANSACTION_INTERNATIONAL: "CARD", CARD_ORDERING_FEE: "FEE", DIVIDEND: "DIVIDEND", INTEREST_PAYMENT: "INTEREST", BENEFITS_SAVEBACK: "SAVEBACK", TILG: "TILG" })) {
  test(`classifies ${type}`, () => {
    const row = parseCSV(csv({ ...base, type, symbol: "ISIN", mcc_code: "5411" }))[0];
    assert.equal(row.tx_type, tx_type); assert.equal(row.mcc_code, "5411"); assert.equal(row.payment_reference, "");
  });
}

test("rejects invalid, nonfinite and unsupported numeric formats with field and line", () => {
  for (const field of ["shares", "price", "amount", "fee", "tax", "original_amount", "fx_rate"]) {
    for (const value of ["invalid", "NaN", "Infinity", "-Infinity", "1e309", "0x10", "1,25"]) {
      assert.throws(() => parseCSV(csv({ ...trade, [field]: value })), new RegExp(`line 2, field ${field}:`));
    }
  }
  assert.equal(parseCSV(csv({ ...base, amount: "1e2" }))[0].amount, 100);
});
test("required headers and duplicate headers are rejected", () => {
  assert.throws(() => parseCSV(csv(base).replace("amount,", "amount_typo,")), /line 1, field amount: missing required column/);
  assert.throws(() => parseCSV(csv(base).replace("fee,", "amount,")), /duplicate header/);
});
test("required values follow the transaction schema", () => {
  for (const field of ["shares", "price", "amount", "currency", "symbol"]) {
    assert.throws(() => parseCSV(csv({ ...trade, [field]: "" })), new RegExp(`line 2, field ${field}:`));
  }
  assert.throws(() => parseCSV(csv({ ...base, amount: "" })), /field amount:/);
  assert.throws(() => parseCSV(csv({ ...base, type: "CARD_ORDERING_FEE", amount: "", fee: "" })), /field amount\/fee:/);
  assert.equal(parseCSV(csv({ ...base, type: "CARD_ORDERING_FEE", amount: "", fee: "-5" }))[0].fee, -5);
  assert.throws(() => parseCSV(csv({ ...trade, shares: "0" })), /field shares:/);
  assert.throws(() => parseCSV(csv({ ...trade, price: "-1" })), /field price:/);
});
test("validates real dates and clocks, while supporting timezone-free UTC and offsets", () => {
  for (const datetime of ["not-a-date", "2025-02-29T10:00:00Z", "2025-06-31T00:00:00Z", "2025-06-02T24:00:00Z", "2025-06-02T10:60:00Z", "2025-06-02T10:00:00+99:00", ""]) {
    assert.throws(() => parseCSV(csv({ ...base, datetime })), /line 2, field datetime:/);
  }
  assert.throws(() => parseCSV(csv({ ...base, date: "2025-02-29" })), /field date:/);
  assert.equal(parseCSV(csv({ ...base, datetime: "2024-02-29T10:00:00", date: "2024-02-29" }))[0].datetime.toISOString(), "2024-02-29T10:00:00.000Z");
  assert.equal(parseCSV(csv({ ...base, datetime: "2025-06-02T10:00:00+01:00" }))[0].datetime.toISOString(), "2025-06-02T09:00:00.000Z");
});
test("normalizes IDs, drops exact repeats and rejects conflicting IDs", () => {
  assert.equal(parseCSV(csv(base, { ...base, transaction_id: " id1 " })).length, 1);
  assert.throws(() => parseCSV(csv(base, { ...base, transaction_id: " id1 ", amount: "200" })), /line 3, field transaction_id: conflicting ID id1, first seen on line 2/);
  assert.throws(() => parseCSV(csv(base, { ...base, account_type: "OTHER" })), /conflicting ID/);
  const rows = parseCSV(csv({ ...base, transaction_id: " " }, { ...base, transaction_id: "", amount: "200" }));
  assert.equal(rows.length, 2); assert.deepEqual(rows.map(r => r.transaction_id), ["", ""]);
});
test("migration signs remain intact and balanced pairs produce no diagnostic", () => {
  const migration = { ...trade, category: "DELIVERY", type: "MIGRATION", amount: "" };
  const warnings: unknown[] = [], old = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const rows = parseCSV(csv({ ...migration, shares: "-375" }, { ...migration, shares: "375", transaction_id: "id2" }));
    assert.deepEqual(rows.map(r => r.tx_type), ["MIGRATION", "MIGRATION"]);
    assert.deepEqual(rows.map(r => r.shares), [-375, 375]); assert.equal(warnings.length, 0);
  } finally { console.warn = old; }
});
test("corporate warrant exercise supports absent cash/price/currency fields", () => {
  const row = parseCSV(csv({ ...trade, category: "CORPORATE_ACTION", type: "WARRANT_EXERCISE", shares: "-1000", price: "", amount: "", currency: "" }))[0];
  assert.equal(row.tx_type, "SELL"); assert.equal(row.shares, 1000); assert.equal(row.amount, null);
});
test("unknown transaction types are rejected rather than omitted from accounting", () => {
  assert.throws(() => parseCSV(csv({ ...base, type: "SOMETHING_NEW" })), /line 2, field type: unsupported transaction type/);
});
test("RFC quotes preserve delimiters, escaped quotes and embedded line breaks", () => {
  const name = 'Fund, "quoted"\r\nsecond line';
  assert.equal(parseCSV(csv({ ...trade, name }))[0].name, name);
  assert.deepEqual(parseCSVText('\ufeffa,b\r\n"a""b",c\r\n'), [["a", "b"], ['a"b', "c"]]);
  assert.deepEqual(parseCSVText('a,b\ra,b\r'), [["a", "b"], ["a", "b"]]);
  assert.deepEqual(parseCSVText('""'), [[""]]);
});
test("rejects malformed quotes and wrong row widths without merging records", () => {
  for (const text of ['a,b\n"unclosed,b\na,c', 'a,b\na"b,c', 'a,b\n"a"x,c']) assert.throws(() => parseCSVText(text), /CSV line 2, field/);
  for (const record of ['a,b', new Array(24).fill("").join(",")]) assert.throws(() => parseCSV(columns.join(",") + "\n" + record), /line 2, field row:/);
});
test("error lines reflect physical lines after multiline fields and blank lines", () => {
  const text = csv({ ...base, description: "line1\nline2" }, { ...base, transaction_id: "id2", amount: "invalid" }).replace("\n", "\n\n");
  assert.throws(() => parseCSV(text), /line 5, field amount:/);
});
test("the complete legitimate 903-operation fixture remains importable", () => {
  const rows = parseCSV(readFileSync(new URL("./fixtures/transactions.csv", import.meta.url), "utf8"));
  assert.equal(rows.length, 903); assert.equal(rows.filter(r => r.type === "WARRANT_EXERCISE").length, 4);
  assert.equal(rows.filter(r => r.type === "MIGRATION" && r.shares! < 0).length, 6);
});
