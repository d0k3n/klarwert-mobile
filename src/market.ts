import type { OpenPosition } from "./types.ts";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1/latest";
const SEARCH_PATH = "/search";
const QUOTE_PATH = "/quote";
const PROFILE_PATH = "/stock/profile2";

const GOOD_TYPES = new Set(["Common Stock", "ETP", "Fund", "Depositary Receipt"]);

const SUFFIX_CURRENCY: Record<string, string> = {
  L: "GBP", DE: "EUR", F: "EUR", BE: "EUR",
  PA: "EUR", AS: "EUR", MI: "EUR", CO: "DKK",
  T: "JPY", TO: "CAD", HK: "HKD",
};

export function inferCurrency(ticker: string): string {
  const parts = ticker.split(".");
  const suffix = parts.length > 1 ? parts[parts.length - 1].toUpperCase() : "";
  return SUFFIX_CURRENCY[suffix] ?? "USD";
}

interface QuoteResult {
  price: number;
  currency: string;
  quoted_at: string;
}

export async function resolve_ticker(isin: string, apiKey: string): Promise<string | null> {
  const url = `${FINNHUB_BASE}${SEARCH_PATH}?q=${encodeURIComponent(isin)}&token=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url);
  respThrow(resp);
  const data = await resp.json();
  for (const quote of data.result ?? []) {
    if (GOOD_TYPES.has(quote.type)) return quote.symbol ?? null;
  }
  return null;
}

function respThrow(resp: Response): void {
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

function finiteScalar(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function profile_currency(ticker: string, apiKey: string): Promise<string | null> {
  try {
    const url = `${FINNHUB_BASE}${PROFILE_PATH}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url);
    respThrow(resp);
    const data = await resp.json();
    const currency = typeof data.currency === "string" ? data.currency.trim().toUpperCase() : "";
    return /^[A-Z]{3}$/.test(currency) ? currency : null;
  } catch {
    return null;
  }
}

export async function fetch_price(ticker: string, apiKey: string): Promise<QuoteResult> {
  const url = `${FINNHUB_BASE}${QUOTE_PATH}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url);
  respThrow(resp);
  const data = await resp.json();
  if (!("c" in data)) throw new Error(`no quote for ${ticker}`);
  const price = finiteScalar(data.c);
  if (price === null || price < 0) throw new Error(`invalid quote for ${ticker}`);
  const inferred = inferCurrency(ticker);
  const currency = inferred !== "USD" ? inferred : ((await profile_currency(ticker, apiKey)) ?? inferred);
  const quotedAt = Number(data.t) * 1000;
  return { price, currency, quoted_at: Number.isFinite(quotedAt) && quotedAt > 0 && quotedAt <= Date.now()
    ? new Date(quotedAt).toISOString() : new Date().toISOString() };
}

export async function fx_rate(currency: string | null | undefined): Promise<number> {
  const cur = (currency || "EUR").toUpperCase();
  if (cur === "EUR") return 1.0;
  const url = `${FRANKFURTER_URL}?base=${encodeURIComponent(cur)}&symbols=EUR`;
  const resp = await fetch(url);
  respThrow(resp);
  const data = await resp.json();
  const rate = finiteScalar(data.rates?.EUR);
  if (rate === null || rate <= 0) throw new Error(`invalid EUR exchange rate for ${cur}`);
  return rate;
}

export async function to_eur(amount: number, currency: string): Promise<number> {
  return amount * (await fx_rate(currency));
}

export interface RefreshResult {
  prices: Record<string, { price: number; source: string; quoted_at?: string }>;
  tickers: Record<string, string>;
  skipped: Array<Record<string, any>>;
}

export async function refresh_prices(
  positions: OpenPosition[],
  existing_prices: Record<string, { price: number; source?: string }>,
  ticker_cache: Record<string, string>,
  apiKey: string,
  delayMs = 1100
): Promise<RefreshResult> {
  const prices: Record<string, { price: number; source: string; quoted_at?: string }> = {};
  const tickers: Record<string, string> = {};
  const skipped: Array<Record<string, any>> = [];
  let lastCall = 0;

  for (const p of positions) {
    const isin = p.isin;
    const entry = existing_prices[isin];
    if (entry && typeof entry === "object" && entry.source === "manual") {
      skipped.push({ isin, reason: "manual" });
      continue;
    }
    const wait = lastCall + delayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      lastCall = Date.now();
      const ticker = ticker_cache[isin] ?? (await resolve_ticker(isin, apiKey));
      if (!ticker) {
        skipped.push({ isin, reason: "unresolved" });
        continue;
      }
      const { price: native, currency, quoted_at } = await fetch_price(ticker, apiKey);
      const price = await to_eur(native, currency);
      if (!Number.isFinite(price) || price < 0) throw new Error(`invalid converted quote for ${ticker}`);
      // Very large finite values already have less precision than a micro-euro;
      // avoid overflowing merely while applying the normal quote precision.
      const rounded = price <= Number.MAX_VALUE / 1e6 ? Math.round(price * 1e6) / 1e6 : price;
      prices[isin] = { price: rounded, source: "auto", quoted_at };
      tickers[isin] = ticker;
    } catch (exc: any) {
      const message = `${exc?.constructor?.name ?? "Error"}: ${exc?.message ?? exc}`;
      skipped.push({ isin, reason: "fetch_error", message });
    }
  }
  return { prices, tickers, skipped };
}
