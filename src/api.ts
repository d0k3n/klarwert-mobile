import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Preferences } from "@capacitor/preferences";
import { Share } from "@capacitor/share";
import { Browser } from "@capacitor/browser";
import { FilePicker } from "@capawesome/capacitor-file-picker";

import { parseCSV } from "./csv.ts";
import { productsWithUnderlyings } from "./derivative_underlyings.ts";
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
import { computeAnnualPLProjection, computeAutomaticProjection } from "./pl_insights.ts";
import { analyzeResults, paginate } from "./results_analysis.ts";
import { resolveAnalysisPeriod, analysisCSV } from "./analysis_export.ts";
import { emptyLedger, prepareImport, ledgerRows, type ImportLedger } from "./import_ledger.ts";
import { createRevisionStore } from "./storage.ts";
import { exportBackup, parseBackup, validatePortfolioState, type PortfolioState } from "./backup.ts";
import {
  DEFAULT_USER_SETTINGS,
  makeUserConfig,
  parseUserConfig,
  validateCardRules,
  validateUserSettings,
  type UserSettings,
} from "./user_config.ts";
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
type StoredPrice = { price: number; source: "auto" | "manual"; quoted_at?: string };
let prices: Record<string, StoredPrice> = {};
let tickers: Record<string, string> = {};
let cardRules: CardRule[] = [];
let userSettings: UserSettings = { ...DEFAULT_USER_SETTINGS };
let knockedIds = new Set<string>();
let apiKey = "";
let ledger: ImportLedger = emptyLedger();
let revision = "legacy";
const portfolioStore = createRevisionStore({ read: fsRead, write: fsWrite }, validatePortfolioState);

function portfolioState(): PortfolioState {
  return { ledger, config: makeUserConfig(userSettings, cardRules), prices, tickers, knockedIds: [...knockedIds] };
}

async function publishPortfolio(state: PortfolioState): Promise<void> {
  state = { ...state, ledger: { ...state.ledger, revision: String(Number(ledger.revision) + 1) } };
  validatePortfolioState(state);
  const flags = new Set(state.knockedIds);
  assertFiniteAccounting(run_engine(ledgerRows(state.ledger).map(row => ({ ...row, knocked: flags.has(row.transaction_id) }))));
  await portfolioStore.publish(state);
  applyPortfolio(state);
}

function applyPortfolio(state: PortfolioState): void {
  ledger = state.ledger;
  df = ledgerRows(ledger);
  const config = parseUserConfig(state.config);
  userSettings = config.settings;
  cardRules = config.card_rules;
  prices = normalizePrices(state.prices);
  tickers = state.tickers;
  knockedIds = new Set(state.knockedIds);
  revision = String(ledger.revision);
  invalidateCache();
}

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
    } catch (error: any) {
      // Capacitor Android's installed adapter reports missing files with code 0008.
      // Permission and I/O failures must never trigger an empty-ledger migration.
      if (error?.code === "OS-PLUG-FILE-0008") return null;
      throw error;
    }
  }
  return localStorage.getItem("klarwert:" + name);
}

async function fsWrite(name: string, data: string): Promise<void> {
  if (native) {
    await Filesystem.writeFile({ path: name, data, directory: Directory.Data, encoding: Encoding.UTF8 });
    return;
  }
  localStorage.setItem("klarwert:" + name, data);
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

function validPrice(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function normalizePrices(raw: Record<string, unknown> | null): Record<string, StoredPrice> {
  const out: Record<string, StoredPrice> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && "price" in (v as any)) {
      const price = validPrice((v as any).price);
      if (price === null) continue;
      out[k] = { price, source: (v as any).source === "auto" ? "auto" : "manual" };
      const quotedAt = (v as any).quoted_at;
      if (typeof quotedAt === "string" && Number.isFinite(Date.parse(quotedAt))) out[k].quoted_at = quotedAt;
    } else {
      const price = validPrice(v);
      if (price !== null) out[k] = { price, source: "manual" };
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

async function saveUserConfig(): Promise<void> {
  await fsWrite("user_config.json", JSON.stringify(makeUserConfig(userSettings, cardRules)));
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
  const storedConfig = parseJSON(await fsRead("user_config.json"));
  if (storedConfig !== null) {
    try {
      const config = parseUserConfig(storedConfig);
      userSettings = config.settings;
      cardRules = config.card_rules;
    } catch (e: any) {
      console.warn(`Ignoring invalid stored configuration: ${e?.message ?? e}`);
    }
  } else {
    const rulesData = parseJSON(await fsRead("card_rules.json"));
    try {
      cardRules = validateCardRules(Array.isArray(rulesData?.rules) ? rulesData.rules : []);
    } catch (e: any) {
      console.warn(`Ignoring invalid legacy card rules: ${e?.message ?? e}`);
      cardRules = [];
    }
    await saveUserConfig();
  }
  const kd = parseJSON(await fsRead("knocked_down.json"));
  knockedIds = new Set(Array.isArray(kd?.ids) ? kd.ids : []);
  await loadApiKey();
  const persisted = await portfolioStore.load();
  if (persisted) {
    applyPortfolio(persisted);
  } else if (csvText !== null && df?.length) {
    // Keep every legacy file intact; publish and read back the migrated state first.
    const migrated = prepareImport(emptyLedger(), csvText).ledger;
    const state = { ...portfolioState(), ledger: migrated };
    evaluateRows(ledgerRows(migrated));
    await portfolioStore.publish(state);
    applyPortfolio(state);
  }
}

function invalidateCache(): void {
  cacheIds = null;
  cacheResult = null;
}

function rowsWithKnockFlags(rows: Row[]): Row[] {
  // Detect with dedicated row keys so a supplied ID cannot alias an anonymous
  // operation's identity. Manual flags continue to refer to supplied IDs.
  const auto = auto_detect_knocked(rows.map((r, index) => ({ ...r, transaction_id: `@row:${index}` })));
  return rows.map((row, index) => ({ ...row, knocked: row.tx_type === "BUY" &&
    (auto.has(`@row:${index}`) || (!!row.transaction_id && knockedIds.has(row.transaction_id))) }));
}

function evaluateRows(rows: Row[]): EngineResult {
  const result = run_engine(rowsWithKnockFlags(rows));
  assertFiniteAccounting(result);
  return result;
}

function assertFiniteAccounting(value: unknown, path = "result"): void {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite accounting value at ${path}`);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteAccounting(item, `${path}[${index}]`));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) assertFiniteAccounting(item, `${path}.${key}`);
  }
}

function computeData(): EngineResult {
  if (!df) return EMPTY_RESULT;
  const ids = [...knockedIds].sort().join(",");
  if (cacheResult !== null && cacheIds === ids) return cacheResult;
  const result = evaluateRows(df);
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
      case "GET results":
      case "GET realizations":
      case "GET movements":
      case "GET analysis_csv": {
        if (query.has("revision") && query.get("revision") !== revision)
          return jsonResponse({ ok: false, error: "Portfolio revision changed; reload before exporting" }, 409);
        let period;
        try { period = resolveAnalysisPeriod(query, df ?? []); }
        catch (e: any) { return jsonResponse({ ok: false, error: e.message }, 400); }
        const analysis = analyzeResults(df ?? [], computeData(), period, revision);
        if (endpoint === "results") return jsonResponse(analysis);
        if (endpoint === "analysis_csv") return new Response(analysisCSV(analysis), {
          headers: { "Content-Type": "text/csv;charset=utf-8", "X-Portfolio-Revision": revision },
        });
        const request = { page: Number(query.get("page") ?? 1), page_size: Number(query.get("page_size") ?? 25), search: query.get("search") ?? "" };
        if (endpoint === "realizations") return jsonResponse({ ...paginate(analysis.realizations, request), revision });
        const rows = (df ?? []).filter(row => row.date >= period.start && row.date <= period.end)
          .slice().sort((a, b) => b.datetime.getTime() - a.datetime.getTime() || String(a.movement_id).localeCompare(String(b.movement_id)));
        return jsonResponse({ ...paginate(rows, request), revision });
      }
      case "GET automatic_projection":
        return jsonResponse({ ...computeAutomaticProjection(df ?? [], computeData()), revision });
      case "GET backup":
        return new Response(exportBackup(portfolioState()), { headers: { "Content-Type": "application/json" } });
      case "POST backup_restore": {
        let restored;
        try {
          restored = parseBackup(typeof body === "string" ? body : JSON.stringify(body));
          // A restored portfolio receives a new local revision, even for the same source data.
          restored.ledger.revision = String(Number(ledger.revision) + 1);
          const flags = new Set(restored.knockedIds);
          assertFiniteAccounting(run_engine(ledgerRows(restored.ledger).map(row => ({ ...row, knocked: flags.has(row.transaction_id) }))));
        } catch (e: any) { return jsonResponse({ ok: false, error: `Invalid backup: ${e.message}` }, 400); }
        await portfolioStore.publish(restored);
        applyPortfolio(restored);
        return jsonResponse({ ok: true, count: df?.length ?? 0, revision });
      }
      case "POST recover_previous": {
        const restored = await portfolioStore.recoverPrevious();
        if (!restored) return jsonResponse({ ok: false, error: "No previous revision available" }, 400);
        applyPortfolio(restored);
        return jsonResponse({ ok: true, count: df?.length ?? 0, revision });
      }
      case "POST upload": {
        if (!(body instanceof FormData)) return jsonResponse({ ok: false, error: "no file provided" }, 400);
        const file = body.get("file");
        if (!(file instanceof File) || !file.name) return jsonResponse({ ok: false, error: "no file provided" }, 400);
        const raw = await file.text();
        let prepared;
        try {
          prepared = prepareImport(ledger, raw, { mode: body.get("mode") === "replace" ? "replace" : "incremental" });
          evaluateRows(ledgerRows(prepared.ledger));
        } catch (e: any) {
          return jsonResponse({ ok: false, error: `invalid CSV: ${e?.message ?? e}`, conflicts: 1 }, 400);
        }
        if (prepared.ledger.revision !== ledger.revision) {
          try {
            const state = { ...portfolioState(), ledger: prepared.ledger };
            await portfolioStore.publish(state);
            applyPortfolio(state);
          } catch (e: any) {
            return jsonResponse({ ok: false, error: `Could not save CSV: ${e?.message ?? e}` }, 500);
          }
        }
        return jsonResponse({ ok: true, ...prepared.summary, filename: file.name, revision });
      }

      case "POST reload": {
        const state = await portfolioStore.load();
        if (!state) return jsonResponse({ ok: false, error: "no CSV loaded" }, 400);
        evaluateRows(ledgerRows(state.ledger));
        applyPortfolio(state);
        return jsonResponse({ ok: true, count: df?.length ?? 0, revision });
      }

      case "GET status":
        return jsonResponse({ loaded: df !== null, count: df ? df.length : 0, revision,
          first_movement: df?.map(r => r.date).sort()[0] ?? null,
          last_movement: df?.map(r => r.date).sort().at(-1) ?? null });

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
        const nextPrices = { ...prices };
        if (price === null || price === undefined) {
          delete nextPrices[isin];
        } else {
          const v = validPrice(price);
          if (v === null) return jsonResponse({ ok: false, error: "price must be a finite, non-negative number" }, 400);
          nextPrices[isin] = { price: v, source: "manual", quoted_at: new Date().toISOString() };
        }
        await publishPortfolio({ ...portfolioState(), prices: nextPrices });
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
        const nextPrices = normalizePrices({ ...prices, ...out.prices });
        const nextTickers = { ...tickers, ...out.tickers };
        await publishPortfolio({ ...portfolioState(), prices: nextPrices, tickers: nextTickers });
        return jsonResponse({ prices: out.prices, skipped: out.skipped });
      }

      case "GET valued_positions": {
        const result = computeData();
        const valued = apply_prices(result.open_positions, prices);
        return jsonResponse({ ...valued, positions: valued.positions.map(p => ({
          ...p, quoted_at: p.market_price == null ? null : prices[p.isin]?.quoted_at ?? null,
        })) });
      }

      case "GET closed_positions":
        return jsonResponse(computeData().closed_positions);

      case "GET performance": {
        if (!df) return jsonResponse({});
        const result = computeData();
        const valued = apply_prices(result.open_positions, prices);
        return jsonResponse(compute_performance(df, result, {
          valuedPositions: valued.positions,
          ...(result.open_positions.length ? { asOf: new Date() } : {}),
        }));
      }

      case "GET cash_flow":
        return jsonResponse(computeData().cash_flow);

      case "GET transactions":
        return jsonResponse(computeData().transactions);

      case "GET products":
        return jsonResponse(productsWithUnderlyings(computeData().products, df ?? []));

      case "GET monthly_pl":
        return jsonResponse(computeData().monthly_pl);

      case "GET daily_pl":
        return jsonResponse(computeData().daily_pl);

      case "GET annual_pl_projection":
        return jsonResponse(computeAnnualPLProjection(
          computeData().daily_pl,
          new Date(),
          userSettings.projection_active_days_per_week,
        ));

      case "GET settings":
        return jsonResponse(userSettings);

      case "POST settings": {
        const settings = validateUserSettings(await readJsonBody(body));
        await publishPortfolio({ ...portfolioState(), config: makeUserConfig(settings, cardRules) });
        return jsonResponse({ ok: true, settings: userSettings });
      }

      case "GET config_export":
        return jsonResponse(makeUserConfig(userSettings, cardRules));

      case "POST config_import": {
        const config = parseUserConfig(await readJsonBody(body));
        await publishPortfolio({ ...portfolioState(), config: makeUserConfig(config.settings, config.card_rules) });
        return jsonResponse({ ok: true, settings: userSettings, card_rules: cardRules });
      }

      case "GET lot_matches":
        return jsonResponse(computeData().lot_matches);

      case "GET knocked_down":
        return jsonResponse({ ids: [...knockedIds].sort() });

      case "POST knocked_down/toggle": {
        const b = await readJsonBody(body);
        const txnId = String(b.id ?? "");
        if (!txnId) return jsonResponse({ ok: false, error: "missing id" }, 400);
        const nextIds = new Set(knockedIds);
        if (nextIds.has(txnId)) nextIds.delete(txnId);
        else nextIds.add(txnId);
        await publishPortfolio({ ...portfolioState(), knockedIds: [...nextIds].sort() });
        return jsonResponse({ ok: true, flagged: knockedIds.has(txnId) });
      }

      case "GET tax_report": {
        if (!df?.length) {
          return jsonResponse({
            year: null, disposals: [], disposal_totals: {},
            dividends: [], dividend_totals: {}, interest: 0, saveback: 0,
          });
        }
        let year = Number(query.get("year"));
        if (!query.get("year")) {
          year = df.reduce((acc, r) => (r.datetime > acc ? r.datetime : acc), df[0].datetime).getUTCFullYear();
        } else if (!Number.isInteger(year) || year < 2000 || year > 2100) {
          return jsonResponse({ ok: false, error: "invalid tax year" }, 400);
        }
        const result = computeData();
        return jsonResponse(build_tax_report(df, result.lot_matches, year));
      }

      case "GET card_transactions":
        return jsonResponse(df ? compute_card_transactions(df, cardRules) : []);

      case "GET derivative_executions": {
        if (!df) return jsonResponse([]);
        return jsonResponse(compute_derivative_executions(rowsWithKnockFlags(df), new Set()));
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
        const nextRules = validateCardRules([
          ...cardRules.filter((r) => normalize(r?.pattern) !== norm),
          { pattern, category },
        ]);
        await publishPortfolio({ ...portfolioState(), config: makeUserConfig(userSettings, nextRules) });
        return jsonResponse({ ok: true, rules: cardRules });
      }

      case "DELETE card_rules": {
        const b = await readJsonBody(body);
        const pattern = String(b.pattern ?? "").trim();
        if (!pattern) return jsonResponse({ ok: false, error: "pattern is required" }, 400);
        const norm = normalize(pattern);
        const nextRules = cardRules.filter((r) => normalize(r?.pattern) !== norm);
        await publishPortfolio({ ...portfolioState(), config: makeUserConfig(userSettings, nextRules) });
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
      shareFile: (filename: string, text: string) => Promise<void>;
      sharePdf: (filename: string, base64: string) => Promise<void>;
      openUrl: (url: string) => Promise<void>;
      pickCSV: () => Promise<{ name: string; content: string } | null>;
      pickConfig: () => Promise<{ name: string; content: string } | null>;
    };
    fetch: typeof fetch;
  }
}

const initPromise = initEngine();

const originalFetch = window.fetch.bind(window);
let mutationQueue: Promise<unknown> = Promise.resolve();

window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const path = url.split("?")[0];
  if (path === "/api" || path.startsWith("/api/") || path.startsWith("api/")) {
    if ((init?.method ?? "GET").toUpperCase() !== "GET") {
      const response = mutationQueue.then(() => handleApi(url, init));
      mutationQueue = response.catch(() => undefined);
      return response;
    }
    return handleApi(url, init);
  }
  return originalFetch(input, init);
}) as typeof fetch;

function base64ToText(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

async function pickTextFile(): Promise<{ name: string; content: string } | null> {
  const result = await FilePicker.pickFiles({ types: ["*/*"], readData: true });
  const file = result.files?.[0];
  if (!file) return null;
  if (typeof file.data === "string" && file.data.length > 0) {
    return { name: file.name, content: base64ToText(file.data) };
  }
  if (file.blob) {
    return { name: file.name, content: await file.blob.text() };
  }
  return null;
}

window.KlarwertNative = {
  isNative: native,
  shareText: async (filename: string, text: string) => {
    if (!native) return;
    await Share.share({ title: filename, text, dialogTitle: filename });
  },
  shareFile: async (filename: string, text: string) => {
    if (!native) return;
    await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    const file = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, files: [file.uri], dialogTitle: filename });
  },
  sharePdf: async (filename: string, base64: string) => {
    if (!native) return;
    // Omitting an encoding tells Capacitor that `data` is Base64 binary data.
    await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    const file = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
    await Share.share({ title: filename, files: [file.uri], dialogTitle: filename });
  },
  openUrl: async (url: string) => {
    if (!native) return;
    await Browser.open({ url });
  },
  pickCSV: async () => {
    if (!native) return null;
    return pickTextFile();
  },
  pickConfig: async () => {
    if (!native) return null;
    return pickTextFile();
  },
};

export { computeData };
