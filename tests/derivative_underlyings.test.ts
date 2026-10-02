import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { underlyingFromDescription, productsWithUnderlyings } from "../src/derivative_underlyings.ts";
import { parseCSV } from "../src/csv.ts";
import { run_engine } from "../src/engine.ts";

test("description extraction handles product prefixes, embedded commas and missing descriptions", () => {
  for (const prefix of ["Turbo", "Best Turbo", "Unlimited Turbo", "Mini Future (Turbo)", "Faktor Optionsschein"]) {
    assert.equal(underlyingFromDescription(`Buy trade DE000BD5N6E5 ${prefix} auf Crude Oil Financial, quantity: 131`), "Crude Oil Financial");
  }
  assert.equal(underlyingFromDescription("Sell trade ISIN Turbo auf ASML HOLDING    EO -,09, quantity: 10"), "ASML HOLDING EO -,09");
  assert.equal(underlyingFromDescription("Buy trade ISIN Turbo auf\nGold, quantity: 1"), "Gold");
  for (const description of ["", "MIGRATION ISIN", "Warrant Exercise for ISIN ISIN"]) assert.equal(underlyingFromDescription(description), "");
});

test("products infer from any movement and fall back to name without changing source records", () => {
  const rows = parseCSV(readFileSync(new URL("fixtures/transactions.csv", import.meta.url), "utf8"));
  const products = run_engine(rows).products;
  const result = productsWithUnderlyings(products, rows);
  assert.equal(result.find(p => p.isin === "DE000VK2KEU5")?.underlying, "SIEMENS AG NA");
  assert.ok(products.every(p => p.underlying === undefined));
  const p = result.find(p => p.isin === "DE000VK2KEU5")!;
  const movements = rows.filter(r => r.symbol === p.isin).map((r, i) => ({ ...r, description: i ? r.description : "MIGRATION ISIN" }));
  assert.equal(productsWithUnderlyings([p], movements)[0].underlying, "SIEMENS AG NA");
  assert.equal(productsWithUnderlyings([p], [])[0].underlying, p.name);
});

test("underlying ranking sums different derivative ISINs, keeps losses and unassigned assets, and excludes equities", () => {
  const source = readFileSync(new URL("../web/dashboard.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function renderDerivativeUnderlyings("), source.indexOf("window.saveDerivativeUnderlyings ="));
  let ranking: any;
  const element = () => ({ style: {}, dataset: {}, append() {}, replaceChildren() {} });
  const context = { document: { createElement: element, getElementById: element }, renderTable: (_id: string, rows: any) => { ranking = rows; } };
  runInNewContext(fn + ";globalThis.render = renderDerivativeUnderlyings;", context);
  const products = [
    { isin: "a", asset_class: "DERIVATIVE", total_invested: 100, total_realized_pl: 40 },
    { isin: "b", asset_class: "DERIVATIVE", underlying: "nvidia", total_invested: 200, total_realized_pl: -15 },
    { isin: "c", asset_class: "DERIVATIVE", name: "Long 82,8 $", total_invested: 80, total_realized_pl: -80 },
    { isin: "d", asset_class: "STOCK", total_invested: 1000, total_realized_pl: 500 },
  ];
  (context as any).render(products, { derivative_underlyings: { a: "NVIDIA" } });
  assert.deepEqual(JSON.parse(JSON.stringify(ranking)), [
    { underlying: "NVIDIA", products: 2, total_invested: 300, total_realized_pl: 25 },
    { underlying: "Long 82,8 $", products: 1, total_invested: 80, total_realized_pl: -80 },
  ]);
});
