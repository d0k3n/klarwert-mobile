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

async function profile_currency(ticker: string, apiKey: string): Promise<string | null> {
  try {
    const url = `${FINNHUB_BASE}${PROFILE_PATH}?symbol=${encodeURIComponent(ticker)}&token=${encodeURIComponent(apiKey)}`;
    const resp = await fetch(url);
    respThrow(resp);
    const data = await resp.json();
    return data.currency ?? null;
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
  const price = Number(data.c);
  const inferred = inferCurrency(ticker);
  const currency = inferred !== "USD" ? inferred : ((await profile_currency(ticker, apiKey)) ?? inferred);
  return { price, currency };
}

export async function fx_rate(currency: string | null | undefined): Promise<number> {
  const cur = (currency || "EUR").toUpperCase();
  if (cur === "EUR") return 1.0;
  const url = `${FRANKFURTER_URL}?base=${encodeURIComponent(cur)}&symbols=EUR`;
  const resp = await fetch(url);
  respThrow(resp);
  const data = await resp.json();
  return Number(data.rates.EUR);
}

export async function to_eur(amount: number, currency: string): Promise<number> {
  return amount * (await fx_rate(currency));
}

export interface RefreshResult {
  prices: Record<string, { price: number; source: string }>;
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
  const prices: Record<string, { price: number; source: string }> = {};
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
      const { price: native, currency } = await fetch_price(ticker, apiKey);
      const price = await to_eur(native, currency);
      prices[isin] = { price: Math.round(price * 1e6) / 1e6, source: "auto" };
      tickers[isin] = ticker;
    } catch (exc: any) {
      const message = `${exc?.constructor?.name ?? "Error"}: ${exc?.message ?? exc}`;
      skipped.push({ isin, reason: "fetch_error", message });
    }
  }
  return { prices, tickers, skipped };
}
