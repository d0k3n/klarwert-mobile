import test from "node:test";
import assert from "node:assert/strict";
import { parseCSVDetailed } from "../src/csv.ts";
import { emptyLedger, prepareImport, ledgerRows, validateLedger } from "../src/import_ledger.ts";
import { createRevisionStore, type StorageAdapter } from "../src/storage.ts";
import { exportBackup, parseBackup, validatePortfolioState, type PortfolioState } from "../src/backup.ts";
import { makeUserConfig, DEFAULT_USER_SETTINGS } from "../src/user_config.ts";
const header = "datetime,date,category,type,amount,currency,transaction_id,unknown";
const row = (id: string, amount = 100, date = "2026-01-01", unknown = "original") => `${date}T12:00:00Z,${date},CASH,TRANSFER_INSTANT_INBOUND,${amount},EUR,${id},${unknown}`;
const csv = (...rows: string[]) => [header, ...rows].join("\n");
const portfolio = (text = csv(row("a"))): PortfolioState => ({ ledger: prepareImport(emptyLedger(), text).ledger, config: makeUserConfig(DEFAULT_USER_SETTINGS, [{ pattern: "shop", category: "food" }]), prices: { ISIN: { price: 1.2, source: "auto", quoted_at: "2026-01-01T12:00:00Z" } }, tickers: { ISIN: "ABC" }, knockedIds: ["a"] });
class MemoryAdapter implements StorageAdapter {
  files = new Map<string, string>(); fail: ((name: string) => boolean) | null = null; truncate: ((name: string) => boolean) | null = null;
  async read(name: string) { return this.files.get(name) ?? null; }
  async write(name: string, text: string) {
    if (this.fail?.(name)) throw new Error("quota exceeded");
    this.files.set(name, this.truncate?.(name) ? text.slice(0, 20) : text);
  }
}
test("detailed parser preserves raw unknown columns and duplicate provenance", () => {
  const parsed = parseCSVDetailed(csv(row("a"), row("a")));
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.records.length, 2);
  assert.equal(parsed.records[0].fields.unknown, "original"); assert.equal(parsed.records[1].duplicate, true);
});
test("identified overlaps merge and exact reimport preserves revisions", () => {
  const a = prepareImport(emptyLedger(), csv(row("a"), row("b"))).ledger;
  const again = prepareImport(a, csv(row("a"), row("b")));
  assert.deepEqual(again.ledger, a); assert.equal(again.summary.duplicates, 2);
  const b = prepareImport(a, csv(row("b"), row("c")));
  assert.equal(b.summary.added, 1); assert.equal(b.summary.duplicates, 1);
  assert.deepEqual(ledgerRows(b.ledger).map(r => r.transaction_id), ["a", "b", "c"]);
  assert.ok(ledgerRows(b.ledger)[0].datetime instanceof Date);
  assert.equal(ledgerRows(b.ledger)[0].movement_id, ledgerRows(a)[0].movement_id);
  assert.deepEqual(validateLedger(b.ledger), b.ledger);
});
test("header order is equivalent, unknown changes and schema changes block without mutation", () => {
  const original = csv(row("a")); const a = prepareImport(emptyLedger(), original).ledger;
  const before = JSON.stringify(a);
  const reversed = original.split("\n").map(l => l.split(",").reverse().join(",")).join("\n");
  assert.equal(prepareImport(a, reversed).summary.added, 0);
  assert.throws(() => prepareImport(a, csv(row("a", 100, "2026-01-01", "changed"))), /Conflicting/);
  assert.throws(() => prepareImport(a, original.split("\n").map(l => l + ",extra").join("\n")), /schema/);
  assert.equal(JSON.stringify(a), before);
});
test("anonymous occurrences survive, exact repeats deduplicate, overlap blocks; replacement validates", () => {
  const text = csv(row(""), row("")); const a = prepareImport(emptyLedger(), text).ledger;
  assert.equal(a.movements.length, 2); assert.notEqual(a.movements[0].movement_id, a.movements[1].movement_id);
  assert.deepEqual(prepareImport(a, text).ledger, a);
  assert.throws(() => prepareImport(a, csv(row(""))), /anonymous overlap/);
  const replaced = prepareImport(a, csv(row("")), { mode: "replace" });
  assert.equal(replaced.summary.count, 1); assert.equal(replaced.summary.removed, 2);
  assert.equal(replaced.ledger.revision, "2"); assert.deepEqual(validateLedger(replaced.ledger), replaced.ledger);
  assert.throws(() => prepareImport(a, "invalid", { mode: "replace" })); assert.equal(a.movements.length, 2);
});

test("derivative display name changes deduplicate while financial conflicts remain atomic", () => {
  const h = "datetime,date,category,type,asset_class,name,symbol,shares,price,amount,fee,currency,transaction_id,unknown";
  const trade = (name: string, amount = "-52.69", asset = "DERIVATIVE", fee = "-1.00", symbol = "DE000VK2KEU5", shares = "11", unknown = "original") =>
    `2026-02-04T15:05:06.232Z,2026-02-04,TRADING,BUY,${asset},"${name}",${symbol},${shares},4.79,${amount},${fee},EUR,a,${unknown}`;
  const statement = (...rows: string[]) => [h, ...rows].join("\n");
  const original = statement(trade("Long 198,29 €"));
  const updated = statement(trade("Long 200,13 €"));
  const current = prepareImport(emptyLedger(), original).ledger;
  const before = JSON.stringify(current);
  assert.equal(prepareImport(current, updated).summary.duplicates, 1);
  for (const type of ["SELL", "MIGRATION", "WARRANT_EXERCISE", "TILG"]) {
    const convert = (text: string) => text.replace(",BUY,", `,${type},`).replace(",-52.69,", ",52.69,");
    const previous = prepareImport(emptyLedger(), convert(original)).ledger;
    assert.equal(prepareImport(previous, convert(updated)).summary.duplicates, 1);
  }
  assert.equal(parseCSVDetailed(statement(trade("Long 198,29 €"), trade("Long 200,13 €"))).rows.length, 1);
  const merged = prepareImport(current, statement(trade("Long 200,13 €"), trade("Long 200,13 €").replace(",a,original", ",b,original")));
  assert.equal(merged.summary.added, 1);
  assert.equal(ledgerRows(merged.ledger)[0].name, "Long 198,29 €");
  assert.deepEqual(validateLedger(merged.ledger), merged.ledger);
  assert.deepEqual(parseBackup(exportBackup({ ...portfolio(), ledger: merged.ledger })).ledger, merged.ledger);
  for (const changed of [trade("Long 200,13 €", "-53.69"), trade("Long 200,13 €", "-52.69", "DERIVATIVE", "-2"), trade("Long 200,13 €", "-52.69", "DERIVATIVE", "-1.00", "OTHER"), trade("Long 200,13 €", "-52.69", "DERIVATIVE", "-1.00", "DE000VK2KEU5", "12"), trade("Long 200,13 €", "-52.69", "DERIVATIVE", "-1.00", "DE000VK2KEU5", "11", "changed")]) {
    assert.throws(() => prepareImport(current, statement(changed)), /Conflicting/);
  }
  const fund = prepareImport(emptyLedger(), statement(trade("Old fund", "-52.69", "FUND"))).ledger;
  assert.throws(() => prepareImport(fund, statement(trade("New fund", "-52.69", "FUND"))), /Conflicting/);
  const stock = prepareImport(emptyLedger(), statement(trade("Old stock", "-52.69", "STOCK"))).ledger;
  assert.throws(() => prepareImport(stock, statement(trade("New stock", "-52.69", "STOCK"))), /Conflicting/);
  assert.equal(JSON.stringify(current), before);
});
test("missing partial rows never delete prior movements and disjoint anonymous statements append", () => {
  const a = prepareImport(emptyLedger(), csv(row("a"), row("b"))).ledger;
  assert.equal(prepareImport(a, csv(row("b"))).ledger.movements.length, 2);
  const anon = prepareImport(emptyLedger(), csv(row(""))).ledger;
  assert.equal(prepareImport(anon, csv(row("", 100, "2026-02-01"))).ledger.movements.length, 2);
});
test("ledger rejects tampered provenance, identities and missing occurrences", () => {
  const state = portfolio().ledger;
  assert.throws(() => validateLedger({ ...state, movements: [] }), /Missing/);
  assert.throws(() => validateLedger({ ...state, movements: [{ ...state.movements[0], movement_id: "fake" }] }), /identity/);
  assert.throws(() => validateLedger({ ...state, sources: [{ ...state.sources[0], headers: [] }] }), /provenance/);
});
test("storage serializes concurrent mutations across stores sharing an adapter", async () => {
  const adapter = new MemoryAdapter(); const validate = (v: any) => { assert.ok(Number.isInteger(v.count)); return { count: v.count }; };
  const store = createRevisionStore(adapter, validate), other = createRevisionStore(adapter, validate);
  await Promise.all(Array.from({ length: 15 }, (_, i) => (i % 2 ? store : other).mutate(async current => ({ count: (current?.count ?? 0) + 1 }))));
  assert.deepEqual(await store.load(), { count: 15 });
});
test("generation quota and truncated readback failures preserve previous revision; retries work", async () => {
  const adapter = new MemoryAdapter(); const store = createRevisionStore(adapter, validatePortfolioState);
  const a = portfolio(); await store.publish(a);
  adapter.fail = name => name.includes("generation");
  await assert.rejects(store.publish(portfolio(csv(row("b")))), /quota/); assert.deepEqual(await store.load(), a);
  adapter.fail = null; adapter.truncate = name => name.includes("generation");
  await assert.rejects(store.publish(portfolio(csv(row("b")))), /readback/); assert.deepEqual(await store.load(), a);
  adapter.truncate = null; await store.publish(portfolio(csv(row("b"))));
  assert.equal((await store.load())?.ledger.movements[0].movement_id, "tx:b");
});
test("failed or torn manifest and orphan generation leave a recoverable committed state", async () => {
  const adapter = new MemoryAdapter(); const store = createRevisionStore(adapter, validatePortfolioState);
  const a = portfolio(); await store.publish(a);
  adapter.fail = name => name === "portfolio-manifest-0.json";
  await assert.rejects(store.publish(portfolio(csv(row("b"))))); assert.deepEqual(await store.load(), a);
  adapter.fail = null; adapter.truncate = name => name === "portfolio-manifest-0.json";
  await assert.rejects(store.publish(portfolio(csv(row("b"))))); assert.deepEqual(await store.load(), a);
  adapter.truncate = null;
  await adapter.write("transactions.csv", "legacy original");
  await store.publish(portfolio(csv(row("b"))));
  const latest = JSON.parse(adapter.files.get("portfolio-manifest-0.json")!);
  adapter.files.set(latest.generation, "interrupted");
  assert.deepEqual(await store.load(), a); assert.equal(adapter.files.get("transactions.csv"), "legacy original");
});
test("previous recovery is a new revision and restores all portfolio fields together", async () => {
  const adapter = new MemoryAdapter(); const store = createRevisionStore(adapter, validatePortfolioState);
  const a = portfolio(); await store.publish(a);
  const b = portfolio(csv(row("b"))); b.ledger.revision = "2"; b.prices = {}; b.config = makeUserConfig({ projection_active_days_per_week: 7 }, []);
  await store.publish(b); const recovered = await store.recoverPrevious();
  assert.equal(recovered.ledger.revision, "3"); assert.deepEqual(recovered.prices, a.prices); assert.deepEqual(recovered.config, a.config);
  assert.deepEqual(await createRevisionStore(adapter, validatePortfolioState).load(), recovered);
});
test("backup restores full provenance/configuration/dates/flags and excludes credentials", () => {
  const state = portfolio(csv(row("a"), row("b"))); const text = exportBackup({ ...state, apiKey: "secret", finnhub_api_key: "secret" } as any);
  assert.ok(!text.includes("secret")); assert.deepEqual(parseBackup(text), state);
  assert.deepEqual(ledgerRows(parseBackup(text).ledger), ledgerRows(state.ledger));
  const backup = JSON.parse(text); backup.version = 2; assert.throws(() => parseBackup(JSON.stringify(backup)), /version/);
  assert.throws(() => validatePortfolioState({ ...state, prices: { ISIN: { price: NaN, source: "auto" } } }), /price/);
  assert.throws(() => validatePortfolioState({ ...state, prices: { ISIN: { price: 1, source: "auto", quoted_at: "bad" } } }), /date/);
  assert.throws(() => validatePortfolioState({ ...state, knockedIds: [1] }), /flags/);
});

test("corrupted manifests do not silently appear as an empty portfolio", async () => {
  const adapter = new MemoryAdapter(); adapter.files.set("portfolio-manifest-1.json", "torn");
  const store = createRevisionStore(adapter, validatePortfolioState);
  await assert.rejects(store.load(), /no valid recoverable/);
  await assert.rejects(store.publish(portfolio()), /no valid recoverable/);
});
test("failed initial migration preserves legacy originals and exposes no prepared generation", async () => {
  const adapter = new MemoryAdapter(); adapter.files.set("transactions.csv", csv(row("legacy")));
  adapter.files.set("user_config.json", "original config"); adapter.fail = name => name.includes("manifest");
  const store = createRevisionStore(adapter, validatePortfolioState);
  await assert.rejects(store.publish(portfolio()));
  assert.equal(await store.load(), null);
  assert.equal(adapter.files.get("transactions.csv"), csv(row("legacy")));
  assert.equal(adapter.files.get("user_config.json"), "original config");
  adapter.fail = null; await store.publish(portfolio()); assert.ok(await store.load());
});
test("backup rejects finite inputs whose aggregate accounting overflows", () => {
  assert.throws(() => validatePortfolioState(portfolio(csv(row("a", 1e308), row("b", 1e308)))), /nonfinite/);
});
