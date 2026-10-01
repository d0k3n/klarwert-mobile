import test from "node:test";
import assert from "node:assert/strict";
import { fetch_price, fx_rate, refresh_prices } from "../src/market.ts";
import type { OpenPosition } from "../src/types.ts";

const holding: OpenPosition = { isin: "ISIN", name: "Synthetic", asset_class: "STOCK", shares: 10, average_cost: 100, total_cost: 1000 };
async function withFetch<T>(handler: (url: string) => unknown, body: () => Promise<T>) {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => ({ ok: true, status: 200, json: async () => handler(String(input)) })) as typeof fetch;
  try { return await body(); } finally { globalThis.fetch = previous; }
}

test("provider quotes reject null, booleans, arrays, whitespace and nonfinite values", async () => {
  for (const value of [null, true, false, [], [100], "", " ", -1, "Infinity", "1e309"]) {
    await withFetch(() => ({ c: value }), async () => {
      await assert.rejects(fetch_price("SYNTHETIC.DE", "synthetic-key"), /invalid quote/, `quote ${JSON.stringify(value)}`);
    });
  }
});

test("EUR exchange rates reject booleans, arrays, null and nonpositive/nonfinite values", async () => {
  for (const value of [null, true, false, [], [0.9], "", " ", 0, -1, "Infinity", "1e309"]) {
    await withFetch(() => ({ rates: { EUR: value } }), async () => {
      await assert.rejects(fx_rate("USD"), /invalid EUR exchange rate/, `rate ${JSON.stringify(value)}`);
    });
  }
});

test("manual prices survive refresh without provider calls", async () => {
  const manual = { ISIN: { price: 123, source: "manual" } }, snapshot = structuredClone(manual);
  await withFetch(() => { throw new Error("manual quote must not trigger a provider call"); }, async () => {
    const result = await refresh_prices([holding], manual, {}, "synthetic-key", 0);
    assert.deepEqual(result.prices, {}); assert.deepEqual(result.tickers, {});
    assert.deepEqual(result.skipped, [{ isin: "ISIN", reason: "manual" }]);
    assert.deepEqual(manual, snapshot);
  });
});

test("automatic refresh resolves ticker, converts its price once and preserves timestamp", async () => {
  const calls: string[] = [], stamp = Math.floor(Date.now() / 1000) - 60;
  await withFetch(url => {
    calls.push(url);
    if (url.includes("/search?")) return { result: [{ type: "Common Stock", symbol: "SYNTHETIC" }] };
    if (url.includes("/quote?")) return { c: 100, t: stamp };
    if (url.includes("/stock/profile2?")) return { currency: "USD" };
    if (url.includes("frankfurter")) return { rates: { EUR: 0.9 } };
    throw new Error("unexpected synthetic request");
  }, async () => {
    const result = await refresh_prices([holding], {}, {}, "synthetic-key", 0);
    assert.deepEqual(result.prices, { ISIN: { price: 90, source: "auto", quoted_at: new Date(stamp * 1000).toISOString() } });
    assert.deepEqual(result.tickers, { ISIN: "SYNTHETIC" }); assert.deepEqual(result.skipped, []);
    assert.equal(calls.length, 4);
  });
});

test("invalid provider profile currencies fall back to the ticker currency before FX conversion", async () => {
  for (const currency of ["", " ", null, false, [], ["EUR"], 123, "INVALID"]) await withFetch(url => {
    if (url.includes("/quote?")) return { c: 100 };
    if (url.includes("/stock/profile2?")) return { currency };
    if (url.includes("frankfurter")) return { rates: { EUR: 0.9 } };
    throw new Error("unexpected synthetic request");
  }, async () => {
    const result = await refresh_prices([holding], {}, { ISIN: "SYNTHETIC" }, "synthetic-key", 0);
    assert.equal(result.prices.ISIN.price, 90, "100 USD must be converted even when the profile omits its currency");
  });
});

test("failed automatic refresh keeps existing quote and cache inputs intact", async () => {
  const existing = { ISIN: { price: 90, source: "auto" } }, tickers = { ISIN: "SYNTHETIC.DE" };
  await withFetch(() => ({ c: null }), async () => {
    const result = await refresh_prices([holding], existing, tickers, "synthetic-key", 0);
    assert.deepEqual(result.prices, {}); assert.deepEqual(result.tickers, {});
    assert.equal(result.skipped[0].reason, "fetch_error");
    assert.deepEqual(existing, { ISIN: { price: 90, source: "auto" } }); assert.deepEqual(tickers, { ISIN: "SYNTHETIC.DE" });
  });
});

test("rounding a finite large automatic quote cannot return infinity", async () => {
  await withFetch(() => ({ c: 1e308 }), async () => {
    const result = await refresh_prices([holding], {}, { ISIN: "SYNTHETIC.DE" }, "synthetic-key", 0);
    for (const entry of Object.values(result.prices)) assert.ok(Number.isFinite(entry.price), "returned quotes must remain finite after rounding");
  });
});
