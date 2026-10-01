import { validateLedger, ledgerRows, type ImportLedger } from "./import_ledger.ts";
import { parseUserConfig, type UserConfig } from "./user_config.ts";
import { run_engine } from "./engine.ts";
export interface StoredPrice { price: number; source: "auto" | "manual"; quoted_at?: string; }
export interface PortfolioState { ledger: ImportLedger; config: UserConfig; prices: Record<string, StoredPrice>; tickers: Record<string, string>; knockedIds: string[]; }
export interface PortfolioBackup { format: "klarwert-backup"; version: 1; exported_at: string; state: PortfolioState; }
function object(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid backup object");
  return v as Record<string, unknown>;
}
function boundedMap(v: unknown): Record<string, unknown> {
  const o = object(v);
  if (Object.keys(o).length > 200000) throw new Error("Backup contains too many entries");
  for (const k of Object.keys(o)) if (!k || k.length > 500 || ["__proto__", "constructor", "prototype"].includes(k)) throw new Error("Invalid backup key");
  return o;
}
export function validatePortfolioState(value: unknown): PortfolioState {
  const v = object(value);
  const ledger = validateLedger(v.ledger), config = parseUserConfig(v.config);
  const prices: Record<string, StoredPrice> = {}, tickers: Record<string, string> = {};
  for (const [id, raw] of Object.entries(boundedMap(v.prices))) {
    const p = object(raw);
    if (typeof p.price !== "number" || !Number.isFinite(p.price) || p.price < 0 || (p.source !== "manual" && p.source !== "auto")) throw new Error("Invalid backup price");
    const price: StoredPrice = { price: p.price, source: p.source };
    if (p.quoted_at !== undefined) {
      if (typeof p.quoted_at !== "string" || p.quoted_at.length > 100 || !Number.isFinite(Date.parse(p.quoted_at))) throw new Error("Invalid backup price date");
      price.quoted_at = p.quoted_at;
    }
    prices[id] = price;
  }
  for (const [id, ticker] of Object.entries(boundedMap(v.tickers))) {
    if (typeof ticker !== "string" || !ticker || ticker.length > 200) throw new Error("Invalid backup ticker");
    tickers[id] = ticker;
  }
  if (!Array.isArray(v.knockedIds) || v.knockedIds.length > 200000 || v.knockedIds.some(id => typeof id !== "string" || !id || id.length > 1000) || new Set(v.knockedIds).size !== v.knockedIds.length) throw new Error("Invalid backup knocked flags");
  const state = { ledger, config, prices, tickers, knockedIds: [...v.knockedIds] as string[] };
  const rows = ledgerRows(ledger);
  const knocked = new Set(state.knockedIds);
  const calculated = run_engine(rows.map(r => ({ ...r, knocked: knocked.has(r.transaction_id) || knocked.has(r.movement_id ?? "") })));
  const finite = (value: unknown): void => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Backup produces nonfinite accounting values");
    if (value && typeof value === "object") for (const item of Object.values(value)) finite(item);
  };
  finite(calculated);
  return state;
}
/** Whitelist all fields; service credentials never enter the exported document. */
export function exportBackup(state: PortfolioState): string {
  const backup: PortfolioBackup = { format: "klarwert-backup", version: 1, exported_at: new Date().toISOString(), state: validatePortfolioState(state) };
  return JSON.stringify(backup);
}
export function parseBackup(text: string): PortfolioState {
  if (text.length > 60_000_000) throw new Error("Backup exceeds size limit");
  const v = object(JSON.parse(text));
  if (v.format !== "klarwert-backup" || v.version !== 1) throw new Error("Unsupported Klarwert backup format or version");
  if (typeof v.exported_at !== "string" || !Number.isFinite(Date.parse(v.exported_at))) throw new Error("Invalid backup export date");
  return validatePortfolioState(v.state);
}
