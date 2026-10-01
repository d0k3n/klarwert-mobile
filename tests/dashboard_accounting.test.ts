import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const dashboard = readFileSync(new URL("../web/dashboard.js", import.meta.url), "utf8");
class Element {
  children: Element[] = [];
  style: Record<string, unknown> = {};
  dataset: Record<string, string> = {};
  className = ""; textContent = ""; value: string | number = ""; disabled = false;
  type = ""; min = ""; validityReported = false;
  listeners = new Map<string, Array<() => unknown>>();
  private html = "";
  private parts = new Map<string, Element>();
  get innerHTML() { return this.html; }
  set innerHTML(value: string) { this.html = value; this.children = []; }
  classList = { add() {}, remove() {}, toggle() {} };
  appendChild(node: Element) { this.children.push(node); return node; }
  querySelector(selector: string) {
    if (!this.parts.has(selector)) this.parts.set(selector, new Element());
    return this.parts.get(selector)!;
  }
  querySelectorAll() { return []; }
  addEventListener(event: string, listener: () => unknown) {
    const listeners = this.listeners.get(event) ?? []; listeners.push(listener); this.listeners.set(event, listeners);
  }
  async dispatch(event: string) { for (const listener of this.listeners.get(event) ?? []) await listener(); }
  checkValidity() { return this.value === "" || (Number.isFinite(Number(this.value)) && Number(this.value) >= 0); }
  reportValidity() { this.validityReported = true; }
  setAttribute() {} removeAttribute() {} click() {}
}
function report(name = 'Synthetic; "Fund"\nsecond line') {
  return {
    year: 2025,
    disposals: [{ date: "2025-02-01", name, isin: "ISIN", shares: 1, proceeds: 200, cost_basis: 100, fees: 1, gain: 99, acquired: "2025-01-01" }],
    dividend_totals: { gross: 100, wht: 15, fees: 2, net: 83 },
    interest: 50, interest_totals: { gross: 50, wht: 10, fees: 1, net: 39 },
    saveback: 10, saveback_totals: { gross: 10, wht: 0, fees: 1, net: 9 },
  };
}
async function harness() {
  const nodes = new Map<string, Element>(), calls: Array<{ url: string; init: any }> = [], exported: Array<{ name: string; text: string }> = [];
  const node = (id: string) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id)!; };
  const h: any = { nodes, node, calls, exported, responder: async (url: string) => url.includes("tax_report") ? report() : {} };
  node("tax-year").value = "2025";
  const context: any = {
    console, Blob, URL, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url: string, init: any) => {
      calls.push({ url, init });
      const data = await h.responder(url, init);
      return { ok: data.__status ? data.__status < 400 : true, status: data.__status ?? 200, json: async () => data };
    },
    document: {
      getElementById: node,
      querySelector: (selector: string) => {
        const match = /^#([^ ]+) (tbody|thead)$/.exec(selector);
        return match ? node(match[1]).querySelector(match[2]) : node(selector);
      },
      querySelectorAll: () => [], createElement: () => new Element(),
    },
    window: {
      addEventListener() {}, requestAnimationFrame: () => 0,
      KlarwertNative: { isNative: true, shareFile: async (name: string, text: string) => exported.push({ name, text }) },
    },
  };
  runInNewContext(dashboard, context, { filename: "dashboard.js" });
  await new Promise<void>(resolve => setImmediate(resolve));
  calls.length = 0;
  h.context = context; h.window = context.window;
  return h;
}
function parseSemicolonCSV(text: string) {
  const records: string[][] = []; let record: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ";") { record.push(field); field = ""; }
    else if (!quoted && (c === "\r" || c === "\n")) {
      record.push(field); records.push(record); record = []; field = "";
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  assert.equal(quoted, false, "export must close all quotes");
  if (field || record.length) { record.push(field); records.push(record); }
  return records;
}

test("unpriced valuation renders unavailable totals without styling an invented zero profit", async () => {
  const h = await harness();
  h.context.renderValuedCards({ market_value: null, unrealized_pl: null, priced_positions: 0, total_positions: 2 }, [{}, {}]);
  const cards = h.node("summary-cards").children;
  assert.ok(cards[0].innerHTML.includes("N/A")); assert.ok(cards[1].innerHTML.includes("N/A"));
  assert.ok(!cards[1].innerHTML.includes("positive")); assert.ok(!cards[1].innerHTML.includes("negative"));
  assert.ok(cards[2].innerHTML.includes("0/2 positions"));
});

test("share quantities of 1e-7 and 1e-13 remain visible as nonzero amounts", async () => {
  const h = await harness();
  const decimal = new Intl.NumberFormat().formatToParts(1.1).find(part => part.type === "decimal")!.value;
  const grouping = new Intl.NumberFormat().formatToParts(1000).find(part => part.type === "group")?.value;
  for (const key of ["shares", "total_shares_sold"]) {
    for (const quantity of [1e-7, 1e-13, -1e-13]) {
      const displayed = h.context.formatVal(key, quantity);
      const normalized = (grouping ? displayed.replaceAll(grouping, "") : displayed).replace(decimal, ".");
      assert.equal(Number(normalized), quantity, `${key} ${quantity} must not display as zero`);
    }
  }
});

test("partially quoted valuation labels its subtotal and communicates coverage", async () => {
  const h = await harness();
  h.context.renderValuedCards({ market_value: null, unrealized_pl: null, priced_positions: 1, total_positions: 2, quoted_market_value: 1200 }, [{ market_price: 120 }, {}]);
  const cards = h.node("summary-cards").children;
  assert.ok(cards[0].innerHTML.includes("N/A")); assert.ok(cards[2].innerHTML.includes("1/2 positions"));
  assert.ok(cards[4].innerHTML.includes("Quoted positions subtotal"));
  assert.ok(cards[4].innerHTML.includes((1200).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
});

test("refreshing portfolio data clears the loaded tax report and disables CSV export", async () => {
  const h = await harness();
  await h.window.loadTaxReport();
  assert.equal(h.node("tax-csv-btn").disabled, false);
  assert.ok(h.node("tax-income-table").querySelector("tbody").children.length > 0);
  await h.context.loadAllData();
  assert.equal(h.node("tax-csv-btn").disabled, true);
  assert.equal(h.node("tax-disposals-table").querySelector("tbody").children.length, 0);
  assert.equal(h.node("tax-income-table").querySelector("tbody").children.length, 0);
  await h.window.downloadTaxCsv(); assert.equal(h.exported.length, 0);
});

test("a tax response arriving after portfolio refresh cannot restore the previous report", async () => {
  const h = await harness();
  let resolveReport!: (value: any) => void;
  const pending = new Promise(resolve => { resolveReport = resolve; });
  h.responder = async (url: string) => url.includes("tax_report") ? pending : {};
  const loading = h.window.loadTaxReport();
  await h.context.loadAllData();
  resolveReport(report("Old portfolio")); await loading;
  assert.equal(h.node("tax-csv-btn").disabled, true);
  assert.equal(h.node("tax-income-table").querySelector("tbody").children.length, 0);
  await h.window.downloadTaxCsv(); assert.equal(h.exported.length, 0);
});

test("changing the fiscal year invalidates the previously loaded report", async () => {
  const h = await harness();
  await h.window.loadTaxReport(); assert.equal(h.node("tax-csv-btn").disabled, false);
  h.node("tax-year").value = "2026"; await h.node("tax-year").dispatch("input");
  assert.equal(h.node("tax-csv-btn").disabled, true);
  await h.window.downloadTaxCsv(); assert.equal(h.exported.length, 0);
});

test("tax CSV escapes text cells and exports exact income fees and net amounts", async () => {
  const h = await harness();
  await h.window.loadTaxReport(); await h.window.downloadTaxCsv();
  assert.equal(h.exported[0].name, "tax_report_2025.csv");
  const records = parseSemicolonCSV(h.exported[0].text);
  assert.equal(records[0].length, 9); assert.equal(records[1].length, 9);
  assert.equal(records[1][1], report().disposals[0].name);
  assert.deepEqual(records[3], ["type", "gross", "wht", "fees", "net"]);
  assert.deepEqual(records[4], ["dividends", "100", "15", "2", "83"]);
  assert.deepEqual(records[5], ["interest", "50", "10", "1", "39"]);
  assert.deepEqual(records[6], ["saveback", "10", "0", "1", "9"]);
  const incomeRows = h.node("tax-income-table").querySelector("tbody").children;
  assert.ok(incomeRows[0].innerHTML.includes((83).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
  assert.ok(incomeRows[1].innerHTML.includes((39).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
});

test("invalid price inputs never call the price API and errors from valid writes remain visible", async () => {
  const h = await harness();
  h.context.renderPriceInputs([{ name: "Synthetic", isin: "ISIN" }]);
  const input = h.node("price-inputs").children[0].children.find((child: Element) => child.type === "number")!;
  for (const value of ["-1", "Infinity", "1e309"]) {
    input.value = value; await input.dispatch("change");
    assert.ok(h.node("price-status").textContent.includes("finite, non-negative"));
  }
  assert.equal(h.calls.filter((c: any) => c.url === "/api/prices").length, 0);
  h.responder = async (url: string) => url === "/api/prices" ? { __status: 500, ok: false, error: "Could not save quote" } : {};
  input.value = "120"; await input.dispatch("change");
  assert.equal(h.calls.filter((c: any) => c.url === "/api/prices").length, 1);
  assert.equal(h.node("price-status").textContent, "Could not save quote");
});
