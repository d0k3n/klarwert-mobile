import test from "node:test";
import assert from "node:assert/strict";

// The Node test runner isolates this file; all API state and storage are synthetic.
const storage = new Map<string, string>();
let failWriteKey: string | null = null;
storage.set("klarwert:prices.json", JSON.stringify({
  GOOD: { price: 12, source: "manual" }, ZERO: 0, LEGACY: "3.5", AUTO: { price: 90, source: "auto" },
  NULL: null, NEGATIVE: -5, INFINITE: "Infinity", EMPTY: "", BOOL: true,
  OBJECT_NULL: { price: null }, OBJECT_NEGATIVE: { price: -1 },
  OBJECT_INFINITE: { price: "Infinity" }, OBJECT_EMPTY: { price: "" }, OBJECT_BOOL: { price: false },
}));
storage.set("klarwert:tickers.json", JSON.stringify({ AUTO: "SYNTHETIC.DE" }));
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    if (key === failWriteKey || (failWriteKey === "portfolio" && key.includes("portfolio-manifest-"))) throw new Error("Synthetic storage quota exceeded");
    storage.set(key, value);
  },
  removeItem: (key: string) => storage.delete(key),
} });
const browserWindow = { fetch: globalThis.fetch };
Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
await import("../src/api.ts");

const header = "datetime,date,category,type,asset_class,name,symbol,shares,price,amount,fee,tax,currency,transaction_id".split(",");
const deposit = { datetime: "2025-01-01T00:00:00Z", date: "2025-01-01", category: "CASH", type: "TRANSFER_INSTANT_INBOUND", amount: "1000", currency: "EUR", transaction_id: "deposit" };
function csv(...rows: Record<string, string>[]): string {
  return [header.join(","), ...rows.map(row => header.map(c => '"' + (row[c] ?? "").replaceAll('"', '""') + '"').join(","))].join("\n");
}
async function request(endpoint: string, method = "GET", body?: unknown) {
  const response = await browserWindow.fetch("/api/" + endpoint, {
    method, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  return { status: response.status, data: await response.json() };
}
async function upload(text: string, mode = "replace") {
  const form = new FormData();
  form.set("mode", mode);
  form.set("file", new File([text], "synthetic-transactions.csv", { type: "text/csv" }));
  return request("upload", "POST", form);
}
async function loadDeposit() {
  const result = await upload(csv(deposit));
  assert.equal(result.status, 200); assert.equal(result.data.count, 1);
}
async function portfolioSnapshot() {
  return {
    status: await request("status"), summary: await request("summary"), transactions: await request("transactions"),
  };
}

test("stored prices discard invalid and null quotes while retaining valid legacy/zero values", async () => {
  const result = await request("prices");
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, {
    GOOD: { price: 12, source: "manual" }, ZERO: { price: 0, source: "manual" }, LEGACY: { price: 3.5, source: "manual" }, AUTO: { price: 90, source: "auto" },
  });
});

test("invalid uploads preserve both the prior stored CSV and the computed portfolio", async () => {
  await loadDeposit();
  const previous = await portfolioSnapshot(), stored = storage.get("klarwert:transactions.csv");
  assert.equal(previous.summary.status, 200);
  const invalidCases = [
    ["number", csv({ ...deposit, amount: "invalid" })],
    ["infinity", csv({ ...deposit, amount: "1e309" })],
    ["date", csv({ ...deposit, datetime: "not-a-date" })],
    ["calendar date", csv({ ...deposit, date: "2025-02-29" })],
    ["schema", csv(deposit).replace("amount,", "amount_typo,")],
    ["missing amount", csv({ ...deposit, amount: "" })],
    ["aggregate overflow", csv({ ...deposit, amount: "1e308" }, { ...deposit, amount: "1e308", transaction_id: "deposit2" })],
    ["trade cost overflow", csv({ ...deposit, category: "TRADING", type: "BUY", symbol: "ISIN", shares: "1e-308", price: "1", amount: "-1e308" })],
    ["quotes", csv(deposit) + '\n"unterminated'],
    ["row width", csv(deposit) + "\na,b"],
    ["unknown type", csv({ ...deposit, type: "UNKNOWN_CASH_MOVEMENT" })],
    ["empty", ""], ["header only", header.join(",")],
  ];
  for (const [label, text] of invalidCases) {
    const result = await upload(text);
    assert.equal(result.status, 400, label); assert.equal(result.data.ok, false, label);
    assert.match(result.data.error, /invalid CSV/, label);
    assert.equal(storage.get("klarwert:transactions.csv"), stored, label);
    assert.deepEqual(await portfolioSnapshot(), previous, label);
  }
});

test("CSV persistence failure leaves the prior memory, cache and persisted portfolio intact", async () => {
  await loadDeposit();
  const previous = await portfolioSnapshot(), stored = storage.get("klarwert:transactions.csv");
  failWriteKey = "portfolio";
  try {
    const result = await upload(csv({ ...deposit, amount: "2500" }));
    assert.equal(result.status, 500); assert.match(result.data.error, /Could not save CSV/);
    assert.deepEqual(await portfolioSnapshot(), previous);
    assert.equal(storage.get("klarwert:transactions.csv"), stored);
  } finally { failWriteKey = null; }
});

test("reload ignores a corrupted legacy CSV after migration to the revision ledger", async () => {
  await loadDeposit();
  const previous = await portfolioSnapshot();
  storage.set("klarwert:transactions.csv", "corrupted legacy source");
  const result = await request("reload", "POST");
  assert.equal(result.status, 200);
  assert.deepEqual(await portfolioSnapshot(), previous);
});

test("manual price validation rejects bad values without changing the existing quote", async () => {
  assert.equal((await request("prices", "POST", { isin: "ISIN", price: 120 })).status, 200);
  const previous = await request("prices"), stored = storage.get("klarwert:prices.json");
  for (const price of [-5, "Infinity", "-Infinity", "NaN", "1e309", true, false, "", "   "]) {
    const result = await request("prices", "POST", { isin: "ISIN", price });
    assert.equal(result.status, 400, String(price));
    assert.deepEqual(await request("prices"), previous);
    assert.equal(storage.get("klarwert:prices.json"), stored);
  }
});

test("manual price persistence failure preserves the previous in-memory and stored quote", async () => {
  assert.equal((await request("prices", "POST", { isin: "ISIN", price: 120 })).status, 200);
  const previous = await request("prices"), stored = storage.get("klarwert:prices.json");
  failWriteKey = "portfolio";
  try {
    assert.equal((await request("prices", "POST", { isin: "ISIN", price: 150 })).status, 500);
    assert.deepEqual(await request("prices"), previous);
    assert.equal(storage.get("klarwert:prices.json"), stored);
  } finally { failWriteKey = null; }
});

test("performance uses complete market quotes and signals unknown total return without quotes", async () => {
  const buy = { ...deposit, datetime: "2025-01-02T00:00:00Z", date: "2025-01-02", category: "TRADING", type: "BUY", name: "Synthetic holding", symbol: "PERF_ISIN", shares: "10", price: "100", amount: "-1000", transaction_id: "buy" };
  assert.equal((await upload(csv(deposit, buy))).status, 200);
  await request("prices", "POST", { isin: "PERF_ISIN", price: null });
  const incomplete = await request("performance");
  assert.equal(incomplete.status, 200); assert.equal(incomplete.data.xirr_total, null);
  assert.equal(incomplete.data.terminal_value, null); assert.equal(incomplete.data.valuation_complete, false);
  assert.equal(incomplete.data.terminal_value_at_cost, 1000);
  assert.equal((await request("prices", "POST", { isin: "PERF_ISIN", price: 120 })).status, 200);
  const complete = await request("performance");
  assert.equal(complete.status, 200); assert.equal(complete.data.valuation_complete, true);
  assert.equal(complete.data.terminal_value, 1200); assert.equal(complete.data.valuation_basis, "market");
  assert.equal(typeof complete.data.xirr_total, "number"); assert.ok(complete.data.xirr_total > 0);
  assert.ok(complete.data.as_of, "the API includes its valuation instant");
});

test("tax report rejects malformed, fractional and out-of-range fiscal years", async () => {
  await loadDeposit();
  for (const year of ["invalid", "Infinity", "2025.5", "1999", "2101"]) {
    const result = await request("tax_report?year=" + encodeURIComponent(year));
    assert.equal(result.status, 400, year); assert.equal(result.data.error, "invalid tax year");
  }
  const valid = await request("tax_report?year=2025");
  assert.equal(valid.status, 200); assert.equal(valid.data.year, 2025);
});

test("ticker cache write failure during refresh cannot split persisted and in-memory prices", async () => {
  const buy = { ...deposit, datetime: "2025-01-02T00:00:00Z", date: "2025-01-02", category: "TRADING", type: "BUY", symbol: "AUTO", shares: "10", price: "100", amount: "-1000", transaction_id: "buy" };
  assert.equal((await upload(csv(deposit, buy))).status, 200);
  assert.equal((await request("finnhub_key", "POST", { key: "synthetic-key" })).status, 200);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ c: 100 }) })) as unknown as typeof fetch;
  failWriteKey = "klarwert:tickers.json";
  try {
    const response = await request("refresh_prices", "POST");
    assert.ok([200, 500].includes(response.status), "cache failure may retain the prior valuation or commit the refreshed one");
    const memory = (await request("prices")).data;
    assert.deepEqual(memory, (await request("backup")).data.state.prices, "memory and storage must agree after refresh, including a ticker cache failure");
    assert.equal(memory.GOOD.price, 12, "unrelated manual prices remain intact");
  } finally {
    globalThis.fetch = originalFetch; failWriteKey = null;
    await request("finnhub_key", "POST", { key: "" });
  }
});

test("concurrent manual price mutations retain both quotes in memory and storage", async () => {
  const results = await Promise.all([
    request("prices", "POST", { isin: "CONCURRENT_A", price: 101 }),
    request("prices", "POST", { isin: "CONCURRENT_B", price: 202 }),
  ]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const prices = (await request("prices")).data;
  assert.equal(prices.CONCURRENT_A.price, 101); assert.equal(prices.CONCURRENT_B.price, 202);
  assert.deepEqual(prices, (await request("backup")).data.state.prices);
});

test("knock-out flag persistence failure preserves flags and the previous summary cache", async () => {
  const buy = { ...deposit, datetime: "2025-01-02T00:00:00Z", date: "2025-01-02", category: "TRADING", type: "BUY", symbol: "KO_ISIN", name: "Synthetic warrant", shares: "10", price: "100", amount: "-1000", transaction_id: "knockout_buy" };
  assert.equal((await upload(csv(deposit, buy))).status, 200);
  const flags = await request("knocked_down"), previous = await portfolioSnapshot();
  const persisted = storage.get("klarwert:knocked_down.json");
  failWriteKey = "portfolio";
  try {
    const result = await request("knocked_down/toggle", "POST", { id: "knockout_buy" });
    assert.equal(result.status, 500);
    assert.deepEqual(await request("knocked_down"), flags);
    assert.deepEqual(await portfolioSnapshot(), previous);
    assert.equal(storage.get("klarwert:knocked_down.json"), persisted);
  } finally { failWriteKey = null; }
});

test("an anonymous automatic knock-out cannot collide with a real transaction ID", async () => {
  const buyX = { ...deposit, datetime: "2025-01-02T00:00:00Z", date: "2025-01-02", category: "TRADING", type: "BUY", asset_class: "DERIVATIVE", name: "Synthetic X", symbol: "DERIVATIVE_X", shares: "10", price: "50", amount: "-500", transaction_id: "" };
  const buyY = { ...buyX, datetime: "2025-01-03T00:00:00Z", date: "2025-01-03", name: "Synthetic Y", symbol: "DERIVATIVE_Y", transaction_id: "@row:1" };
  const exercise = { ...buyX, datetime: "2025-01-04T00:00:00Z", date: "2025-01-04", category: "CORPORATE_ACTION", type: "WARRANT_EXERCISE", price: "0", amount: "0", transaction_id: "exercise_X" };
  assert.equal((await upload(csv(deposit, buyX, buyY, exercise))).status, 200);
  const summary = await request("summary"), positions = await request("open_positions"), executions = await request("derivative_executions");
  assert.equal(summary.status, 200); assert.equal(summary.data.total_realized_pl, -500);
  assert.equal(positions.status, 200); assert.equal(positions.data.length, 1);
  assert.equal(positions.data[0].isin, "DERIVATIVE_Y"); assert.equal(positions.data[0].total_cost, 500);
  assert.equal(executions.status, 200);
  assert.deepEqual(executions.data.map((entry: any) => entry.isin), ["DERIVATIVE_X"]);
});


test("incremental API deduplicates IDs, blocks conflicts and exports a coherent period revision", async () => {
  const buy = { ...deposit, datetime: "2025-01-02T00:00:00Z", date: "2025-01-02", category: "TRADING", type: "BUY", name: "Asset", symbol: "ISIN", shares: "1", price: "100", amount: "-100", fee: "-1", transaction_id: "result-buy" };
  const sell = { ...buy, datetime: "2025-02-02T00:00:00Z", date: "2025-02-02", type: "SELL", amount: "110", price: "110", tax: "-2", transaction_id: "result-sell" };
  assert.equal((await upload(csv(deposit,buy))).status,200);
  const added = await upload(csv(buy,sell), "incremental");
  assert.equal(added.status,200); assert.equal(added.data.added,1); assert.equal(added.data.duplicates,1);
  const before = await portfolioSnapshot();
  const duplicate = await upload(csv(buy,sell), "incremental");
  assert.equal(duplicate.status,200); assert.equal(duplicate.data.added,0);
  assert.deepEqual(await portfolioSnapshot(),before);
  const conflict = await upload(csv({...sell,amount:"111"}), "incremental");
  assert.equal(conflict.status,400); assert.match(conflict.data.error,/Conflicting/);
  assert.deepEqual(await portfolioSnapshot(),before);
  const analysis = (await request("results?start=2025-02-01&end=2025-02-28")).data;
  assert.equal(analysis.metrics.net_result,6); assert.equal(analysis.metrics.operations,1);
  assert.equal(analysis.daily.at(-1).cumulative,6);
  const events = (await request("realizations?start=2025-02-01&end=2025-02-28&page=999&page_size=1")).data;
  assert.equal(events.page,1); assert.equal(events.total,1); assert.equal(events.revision,analysis.revision);
  const filtered = (await request("movements?search=ISIN&page_size=1&page=2")).data;
  assert.equal(filtered.total,2); assert.equal(filtered.items.length,1);
  const response = await browserWindow.fetch(`/api/analysis_csv?start=2025-02-01&end=2025-02-28&revision=${analysis.revision}`);
  assert.equal(response.status,200); const text=await response.text();
  assert.match(text, /gross_proceeds/); assert.match(text, /result-sell/); assert.doesNotMatch(text,/result-buy/);
  assert.equal((await request("results?start=2025-02-30")).status,400);
  assert.equal((await request("results?revision=outdated")).status,409);
});

test("backup restore atomically replaces complete state, preserves service key and recovers prior revision", async () => {
  await request("finnhub_key","POST",{key:"device-secret"});
  await request("settings","POST",{projection_active_days_per_week:4});
  const backup=(await request("backup")).data;
  assert.ok(!JSON.stringify(backup).includes("device-secret"));
  const original=(await request("summary")).data;
  await upload(csv({...deposit,transaction_id:"replacement",amount:"500"}));
  await request("prices","POST",{isin:"NEW",price:42});
  const previous=await portfolioSnapshot();
  const invalid={...backup,version:999};
  assert.equal((await request("backup_restore","POST",invalid)).status,400);
  assert.deepEqual(await portfolioSnapshot(),previous);
  failWriteKey="portfolio";
  try { assert.equal((await request("backup_restore","POST",backup)).status,500); assert.deepEqual(await portfolioSnapshot(),previous); }
  finally { failWriteKey=null; }
  const restored=await request("backup_restore","POST",backup);
  assert.equal(restored.status,200); assert.deepEqual((await request("summary")).data,original);
  assert.equal((await request("prices")).data.NEW,undefined);
  assert.equal((await request("finnhub_key")).data.key,"device-secret");
  const oldRevision=restored.data.revision;
  const recovered=await request("recover_previous","POST");
  assert.equal(recovered.status,200); assert.notEqual(recovered.data.revision,oldRevision);
  assert.deepEqual((await request("summary")).data,previous.summary.data);
  assert.equal((await request("prices")).data.NEW.price,42);
  assert.equal((await request(`analysis_csv?revision=${oldRevision}`)).status,409);
});
