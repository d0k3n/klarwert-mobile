import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";

import { parseCSV } from "./csv.ts";
import {
  run_engine,
  compute_derivative_executions,
  compute_card_transactions,
  auto_detect_knocked,
  apply_prices,
  compute_income,
  compute_spending,
  uncategorized_vendors,
} from "./engine.ts";
import { compute_performance } from "./performance.ts";
import { build_tax_report } from "./tax_report.ts";
import { refresh_prices } from "./market.ts";
import type { Row, EngineResult, CardRule } from "./types.ts";
import { normalize } from "./util.ts";

const DONATION_URL = "";
const GITHUB_URL = "";

const native = Capacitor.isNativePlatform();

let df: Row[] | null = null;
let cacheIds: string | null = null;
let cacheResult: EngineResult | null = null;
let prices: Record<string, { price: number; source: string }> = {};
let tickers: Record<string, string> = {};
let cardRules: CardRule[] = [];
let knockedIds = new Set<string>();
let apiKey = "";

const EMPTY_RESULT: EngineResult = {
  summary: {},
  open_positions: [],
  closed_positions: [],
  cash_flow: [],
  transactions: [],
  products: [],
  monthly_pl: [],
  daily_pl: [],
  lot_matches: [],
};

async function fsRead(name: string): Promise<string | null> {
  if (native) {
    try {
      const res = await Filesystem.readFile({ path: name, directory: Directory.Data, encoding: Encoding.UTF8 });
      return typeof res.data === "string" ? res.data : null;
    } catch {
      return null;
    }
  }
  try {
    return localStorage.getItem("klarwert:" + name);
  } catch {
    return null;
  }
}

async function fsWrite(name: string, data: string): Promise<void> {
  if (native) {
    await Filesystem.writeFile({ path: name, data, directory: Directory.Data, encoding: Encoding.UTF8 });
    return;
  }
  try {
    localStorage.setItem("klarwert:" + name, data);
  } catch {
    // ignore quota errors in browser preview
  }
}

async function prefGet(key: string): Promise<string | null> {
  if (native) {
    const res = await Preferences.get({ key });
    return res.value ?? null;
  }
  try {
    return localStorage.getItem("klarwert-pref:" + key);
  } catch {
    return null;
  }
}

async function prefSet(key: string, value: string): Promise<void> {
  if (native) {
    await Preferences.set({ key, value });
    return;
  }
  try {
    localStorage.setItem("klarwert-pref:" + key, value);
  } catch {
    // ignore
  }
}

function normalizePrices(raw: Record<string, unknown> | null): Record<string, { price: number; source: string }> {
  const out: Record<string, { price: number; source: string }> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && "price" in (v as any)) {
      out[k] = { price: Number((v as any).price), source: (v as any).source ?? "manual" };
    } else {
      out[k] = { price: Number(v), source: "manual" };
    }
  }
  return out;
}

function parseJSON(text: string | null): any {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function loadApiKey(): Promise<void> {
  apiKey = (await prefGet("finnhub_api_key")) ?? "";
}

async function initEngine(): Promise<void> {
  const csvText = await fsRead("transactions.csv");
  if (csvText !== null) {
    try {
      df = parseCSV(csvText);
      console.info(`Loaded ${df.length} transactions from stored CSV`);
    } catch (e: any) {
      console.error(`Failed to load stored CSV: ${e?.message ?? e}`);
    }
  }
  prices = normalizePrices(parseJSON(await fsRead("prices.json")));
  tickers = parseJSON(await fsRead("tickers.json")) ?? {};
  const rulesData = parseJSON(await fsRead("card_rules.json"));
  cardRules = Array.isArray(rulesData?.rules) ? rulesData.rules : [];
  const kd = parseJSON(await fsRead("knocked_down.json"));
  knockedIds = new Set(Array.isArray(kd?.ids) ? kd.ids : []);
  await loadApiKey();
}

function invalidateCache(): void {
  cacheIds = null;
  cacheResult = null;
}

function computeData(): EngineResult {
  if (!df) return EMPTY_RESULT;
  const ids = [...knockedIds].sort().join(",");
  if (cacheResult !== null && cacheIds === ids) return cacheResult;
  const d = df.map((r) => ({ ...r }));
  const auto = auto_detect_knocked(d);
  const merged = new Set<string>([...knockedIds, ...auto]);
  if (merged.size > 0) {
    for (const row of d) {
      row.knocked = row.tx_type === "BUY" && merged.has(row.transaction_id ?? "");
    }
  }
  const result = run_engine(d);
  cacheResult = result;
  cacheIds = ids;
  return result;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody(body: unknown): Promise<Record<string, any>> {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  if (body && typeof body === "object") return body as Record<string, any>;
  return {};
}

async function handleApi(url: string, init?: RequestInit): Promise<Response> {
  await initPromise;
  const qIndex = url.indexOf("?");
  const path = qIndex === -1 ? url : url.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? "" : url.slice(qIndex + 1));
  const method = (init?.method ?? "GET").toUpperCase();
  const body = init?.body;
  const parts = path.replace(/^\//, "").split("/");
  const endpoint = parts.slice(1).join("/");

  try {
    switch (`${method} ${endpoint}`) {
      case "POST upload": {
        if (!(body instanceof FormData)) return jsonResponse({ ok: false, error: "no file provided" }, 400);
        const file = body.get("file");
        if (!(file instanceof File) || !file.name) return jsonResponse({ ok: false, error: "no file provided" }, 400);
        const raw = await file.text();
        let parsed: Row[];
        try {
          parsed = parseCSV(raw);
        } catch (e: any) {
          return jsonResponse({ ok: false, error: `invalid CSV: ${e?.message ?? e}` }, 400);
        }
        try {
          await fsWrite("transactions.csv", raw);
        } catch (e: any) {
          console.warn(`Could not persist CSV: ${e?.message ?? e}`);
        }
        df = parsed;
        invalidateCache();
        console.info(`Loaded ${parsed.length} transactions from upload ${file.name}`);
        return jsonResponse({ ok: true, count: parsed.length, filename: file.name });
      }

      case "POST reload": {
        const text = await fsRead("transactions.csv");
        if (text === null) return jsonResponse({ ok: false, error: "no CSV loaded" }, 400);
        try {
          df = parseCSV(text);
          invalidateCache();
          console.info(`Reloaded ${df.length} transactions`);
          return jsonResponse({ ok: true, count: df.length });
        } catch (e: any) {
          return jsonResponse({ ok: false, error: String(e?.message ?? e) }, 500);
        }
      }

      case "GET status":
        return jsonResponse({ loaded: df !== null, count: df ? df.length : 0 });

      case "GET support":
        return jsonResponse({ donation_url: DONATION_URL, github_url: GITHUB_URL });

      case "GET summary":
        return jsonResponse(computeData().summary);

      case "GET open_positions":
        return jsonResponse(computeData().open_positions);

      case "GET prices":
        return jsonResponse(prices);

      case "POST prices": {
        const b = await readJsonBody(body);
        const isin = String(b.isin ?? "").trim();
        if (!isin) return jsonResponse({ ok: false, error: "missing isin" }, 400);
        const price = b.price;
        if (price === null || price === undefined) {
          delete prices[isin];
        } else {
          const v = Number(price);
          if (Number.isNaN(v)) return jsonResponse({ ok: false, error: "invalid price" }, 400);
          prices[isin] = { price: v, source: "manual" };
        }
        await fsWrite("prices.json", JSON.stringify(prices));
        return jsonResponse({ ok: true, prices });
      }

      case "GET tickers":
        return jsonResponse(tickers);

      case "GET refresh_status":
        return jsonResponse({ enabled: apiKey !== "" });

      case "POST refresh_prices": {
        const result = computeData();
        if (!apiKey) return jsonResponse({ enabled: false, reason: "no_api_key" });
        const out = await refresh_prices(result.open_positions, prices, tickers, apiKey);
        Object.assign(prices, out.prices);
        Object.assign(tickers, out.tickers);
        await fsWrite("prices.json", JSON.stringify(prices));
        await fsWrite("tickers.json", JSON.stringify(tickers));
        return jsonResponse({ prices: out.prices, skipped: out.skipped });
      }

      case "GET valued_positions": {
        const result = computeData();
        return jsonResponse(apply_prices(result.open_positions, prices));
      }

      case "GET closed_positions":
        return jsonResponse(computeData().closed_positions);

      case "GET performance": {
        if (!df) return jsonResponse({});
        return jsonResponse(compute_performance(df, computeData()));
      }

      case "GET cash_flow":
        return jsonResponse(computeData().cash_flow);

      case "GET transactions":
        return jsonResponse(computeData().transactions);

      case "GET products":
        return jsonResponse(computeData().products);

      case "GET monthly_pl":
        return jsonResponse(computeData().monthly_pl);

      case "GET daily_pl":
        return jsonResponse(computeData().daily_pl);

      case "GET lot_matches":
        return jsonResponse(computeData().lot_matches);

      case "GET knocked_down":
        return jsonResponse({ ids: [...knockedIds].sort() });

      case "POST knocked_down/toggle": {
        const b = await readJsonBody(body);
        const txnId = String(b.id ?? "");
        if (!txnId) return jsonResponse({ ok: false, error: "missing id" }, 400);
        if (knockedIds.has(txnId)) knockedIds.delete(txnId);
        else knockedIds.add(txnId);
        await fsWrite("knocked_down.json", JSON.stringify({ ids: [...knockedIds].sort() }));
        invalidateCache();
        return jsonResponse({ ok: true, flagged: knockedIds.has(txnId) });
      }

      case "GET tax_report": {
        if (!df) {
          return jsonResponse({
            year: null, disposals: [], disposal_totals: {},
            dividends: [], dividend_totals: {}, interest: 0, saveback: 0,
          });
        }
        let year = Number(query.get("year"));
        if (!query.get("year") || Number.isNaN(year)) {
          year = df.reduce((acc, r) => (r.datetime > acc ? r.datetime : acc), df[0].datetime).getUTCFullYear();
        }
        const result = computeData();
        return jsonResponse(build_tax_report(df, result.lot_matches, year));
      }

      case "GET card_transactions":
        return jsonResponse(df ? compute_card_transactions(df, cardRules) : []);

      case "GET derivative_executions": {
        if (!df) return jsonResponse([]);
        const merged = new Set([...knockedIds, ...auto_detect_knocked(df)]);
        return jsonResponse(compute_derivative_executions(df, merged));
      }

      case "GET income":
        return jsonResponse(df ? compute_income(df) : { monthly: [], dividends: [] });

      case "GET spending":
        return jsonResponse(df ? compute_spending(df, cardRules) : { by_category: [], monthly: [] });

      case "GET card_rules":
        return jsonResponse({ rules: cardRules, uncategorized_vendors: df ? uncategorized_vendors(df, cardRules) : [] });

      case "POST card_rules": {
        const b = await readJsonBody(body);
        const pattern = String(b.pattern ?? "").trim();
        const category = String(b.category ?? "").trim();
        if (!pattern || !category) return jsonResponse({ ok: false, error: "pattern and category are required" }, 400);
        const norm = normalize(pattern);
        cardRules = cardRules.filter((r) => normalize(r?.pattern) !== norm);
        cardRules.push({ pattern, category });
        await fsWrite("card_rules.json", JSON.stringify({ rules: cardRules }));
        return jsonResponse({ ok: true, rules: cardRules });
      }

      case "DELETE card_rules": {
        const b = await readJsonBody(body);
        const pattern = String(b.pattern ?? "").trim();
        if (!pattern) return jsonResponse({ ok: false, error: "pattern is required" }, 400);
        const norm = normalize(pattern);
        cardRules = cardRules.filter((r) => normalize(r?.pattern) !== norm);
        await fsWrite("card_rules.json", JSON.stringify({ rules: cardRules }));
        return jsonResponse({ ok: true, rules: cardRules });
      }

      case "GET finnhub_key":
        return jsonResponse({ key: apiKey });

      case "POST finnhub_key": {
        const b = await readJsonBody(body);
        apiKey = String(b.key ?? "").trim();
        await prefSet("finnhub_api_key", apiKey);
        return jsonResponse({ ok: true, key: apiKey });
      }

      default:
        return jsonResponse({ ok: false, error: `unknown endpoint ${method} ${endpoint}` }, 404);
    }
  } catch (e: any) {
    console.error(`API ${method} ${endpoint} failed:`, e);
    return jsonResponse({ ok: false, error: String(e?.message ?? e) }, 500);
  }
}

declare global {
  interface Window {
    KlarwertNative?: {
      isNative: boolean;
      shareText: (filename: string, text: string) => Promise<void>;
      openUrl: (url: string) => Promise<void>;
    };
    fetch: typeof fetch;
  }
}

const initPromise = initEngine();

const originalFetch = window.fetch.bind(window);

window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.split("?")[0];
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("api/")) {
    return handleApi(url, init);
  }
  return originalFetch(input, init);
}) as typeof fetch;

window.KlarwertNative = {
  isNative: native,
  shareText: async (filename: string, text: string) => {
    if (!native) return;
    await Share.share({ title: filename, text, dialogTitle: filename });
  },
  openUrl: async (url: string) => {
    if (!native) return;
    await Browser.open({ url });
  },
};

export { computeData };
