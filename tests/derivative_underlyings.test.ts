import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("underlying ranking sums different derivative ISINs, keeps losses and unassigned assets, and excludes equities", () => {
  const source = readFileSync(new URL("../web/dashboard.js", import.meta.url), "utf8");
  const fn = source.slice(source.indexOf("function renderDerivativeUnderlyings("), source.indexOf("window.saveDerivativeUnderlyings ="));
  let ranking: any;
  const element = () => ({ style: {}, dataset: {}, append() {}, replaceChildren() {} });
  const context = { document: { createElement: element, getElementById: element }, renderTable: (_id: string, rows: any) => { ranking = rows; } };
  runInNewContext(fn + ";globalThis.render = renderDerivativeUnderlyings;", context);
  const products = [
    { isin: "a", asset_class: "DERIVATIVE", total_invested: 100, total_realized_pl: 40 },
    { isin: "b", asset_class: "DERIVATIVE", total_invested: 200, total_realized_pl: -15 },
    { isin: "c", asset_class: "DERIVATIVE", total_invested: 80, total_realized_pl: -80 },
    { isin: "d", asset_class: "STOCK", total_invested: 1000, total_realized_pl: 500 },
  ];
  (context as any).render(products, { derivative_underlyings: { a: "NVIDIA", b: "nvidia" } });
  assert.deepEqual(JSON.parse(JSON.stringify(ranking)), [
    { underlying: "NVIDIA", products: 2, total_invested: 300, total_realized_pl: 25 },
    { underlying: "Unassigned", products: 1, total_invested: 80, total_realized_pl: -80 },
  ]);
});
