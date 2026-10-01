import type { Row } from "./types.ts";
import { nz } from "./util.ts";

const CASH_TYPES: Record<string, string> = {
  TRANSFER_INSTANT_INBOUND: "DEPOSIT", TRANSFER_INSTANT_OUTBOUND: "WITHDRAWAL",
  CARD_TRANSACTION: "CARD", CARD_TRANSACTION_INTERNATIONAL: "CARD",
  CARD_ORDERING_FEE: "FEE", DIVIDEND: "DIVIDEND", INTEREST_PAYMENT: "INTEREST",
  BENEFITS_SAVEBACK: "SAVEBACK", TILG: "TILG",
};
const NUMERIC_COLS = ["shares", "price", "amount", "fee", "tax", "original_amount", "fx_rate"] as const;
function invalid(line: number, field: string, reason: string): never {
  throw new Error(`CSV line ${line}, field ${field}: ${reason}`);
}

// Retain physical line numbers, including quoted multiline records, for diagnostics.
function parseRecords(text: string): { cells: string[]; line: number }[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const records: { cells: string[]; line: number }[] = [];
  let field = "", cells: string[] = [], state: "plain" | "quoted" | "closed" = "plain";
  let line = 1, start = 1, touched = false;
  const push = () => {
    cells.push(field);
    if (touched || cells.length > 1 || field.trim()) records.push({ cells, line: start });
    cells = []; field = ""; state = "plain"; touched = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (state === "quoted") {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = "closed";
      } else { field += c; if (c === "\n" || (c === "\r" && text[i + 1] !== "\n")) line++; }
      continue;
    }
    if (c === ",") { cells.push(field); field = ""; state = "plain"; touched = true; }
    else if (c === "\r" || c === "\n") {
      push();
      if (c === "\r" && text[i + 1] === "\n") i++;
      line++; start = line;
    } else if (state === "closed") invalid(line, String(cells.length + 1), "unexpected character after closing quote");
    else if (c === '"') {
      if (field.length) invalid(line, String(cells.length + 1), "quote inside unquoted field");
      state = "quoted"; touched = true;
    } else { field += c; if (c.trim()) touched = true; }
  }
  if (state === "quoted") invalid(start, String(cells.length + 1), "unterminated quoted field");
  if (touched || field.length || cells.length) push();
  return records;
}
export function parseCSVText(text: string): string[][] {
  return parseRecords(text).map(({ cells }) => cells);
}

function validCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function parseDatetime(s: string, line: number): Date {
  const t = s.trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (!match || !validCalendarDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59)
    invalid(line, "datetime", "expected a real ISO date and time");
  const tz = match[5];
  if (tz && tz !== "Z" && (+tz.slice(1, 3) > 23 || +tz.slice(-2) > 59)) invalid(line, "datetime", "invalid UTC offset");
  const d = new Date(t.replace(" ", "T") + (tz ? "" : "Z"));
  if (!Number.isFinite(d.getTime())) invalid(line, "datetime", "invalid date and time");
  return d;
}
function toNumber(s: string, line: number, field: string): number | null {
  const t = s.trim();
  if (!t) return null;
  // The export uses decimal points, with optional scientific notation; locale delimiters are not guessed.
  const v = Number(t);
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(t) || !Number.isFinite(v))
    invalid(line, field, "expected a finite decimal number (decimal point)");
  return v;
}
function classifyRow(category: string, type: string, line: number): string {
  if (category === "TRADING" && (type === "BUY" || type === "SELL")) return type;
  if (type === "WARRANT_EXERCISE") return "SELL";
  if (Object.hasOwn(CASH_TYPES, type)) return CASH_TYPES[type];
  if (type === "MIGRATION") return "MIGRATION";
  invalid(line, "type", `unsupported transaction type ${type} (category ${category})`);
}

/** Monetary amounts are gross; signed fee/tax columns are separate cash movements. */
export function parseCSV(text: string): Row[] {
  const records = parseRecords(text);
  if (!records.length) return [];
  const header = records[0].cells;
  const colIndex: Record<string, number> = Object.create(null);
  header.forEach((h, i) => {
    const name = h.trim();
    if (!name || Object.hasOwn(colIndex, name)) invalid(records[0].line, name || "header", "empty or duplicate header");
    colIndex[name] = i;
  });
  for (const field of ["datetime", "date", "category", "type", "amount", "currency"])
    if (!Object.hasOwn(colIndex, field)) invalid(records[0].line, field, "missing required column");
  const rows: Row[] = [], seen = new Map<string, { content: string; line: number }>();
  for (const { cells, line } of records.slice(1)) {
    if (cells.length !== header.length) invalid(line, "row", `expected ${header.length} columns, received ${cells.length}`);
    const get = (name: string) => cells[colIndex[name]] ?? "";
    const category = get("category").trim(), type = get("type").trim();
    if (!category) invalid(line, "category", "required value is empty");
    const tx_type = classifyRow(category, type, line);
    const row: Row = {
      datetime: parseDatetime(get("datetime"), line), date: get("date").trim(), category, type, tx_type,
      asset_class: get("asset_class"), name: get("name"), symbol: get("symbol").trim(),
      shares: null, price: null, amount: null, fee: null, tax: null,
      currency: get("currency").trim().toUpperCase(), original_amount: null, original_currency: get("original_currency").trim().toUpperCase(),
      charges_signed: true,
      fx_rate: null, description: get("description"), transaction_id: get("transaction_id").trim(),
      counterparty_name: get("counterparty_name"), counterparty_iban: get("counterparty_iban"),
      payment_reference: get("payment_reference"), mcc_code: get("mcc_code"),
    };
    if (!validCalendarDate(row.date)) invalid(line, "date", "expected a real YYYY-MM-DD date");
    for (const col of NUMERIC_COLS) row[col] = toNumber(get(col), line, col);
    const required = (field: keyof Row) => {
      if (row[field] === null || row[field] === "") invalid(line, String(field), "required value is empty or column is missing");
    };
    if (type === "BUY" || type === "SELL") {
      for (const field of ["symbol", "shares", "price", "amount", "currency"] as const) required(field);
      if (type === "BUY" && row.amount! > 0) invalid(line, "amount", "BUY gross settlement must be nonpositive");
      if (type === "SELL" && row.amount! < 0) invalid(line, "amount", "SELL gross settlement must be nonnegative");
    } else if (type === "MIGRATION" || type === "WARRANT_EXERCISE") {
      required("symbol"); required("shares");
    } else {
      required("currency");
      if (tx_type === "FEE") {
        if (row.amount === null && row.fee === null) invalid(line, "amount/fee", "at least one monetary value is required");
      } else required("amount");
      if (tx_type === "TILG" || tx_type === "DIVIDEND") required("symbol");
    }
    // All accounting totals use EUR. Foreign original amounts are informational;
    // account-currency amounts must already be converted by the exporter.
    if (row.currency && row.currency !== "EUR") invalid(line, "currency", "unsupported account currency; amounts must be converted to EUR");
    if (["BUY", "SELL", "MIGRATION"].includes(tx_type) && row.shares === 0) invalid(line, "shares", "quantity must be nonzero");
    if (row.price !== null && row.price < 0) invalid(line, "price", "price must be nonnegative");
    if (row.fx_rate !== null && row.fx_rate <= 0) invalid(line, "fx_rate", "exchange rate must be positive");
    if (type !== "MIGRATION" && row.shares !== null) row.shares = Math.abs(row.shares);
    if (row.transaction_id) {
      // Compare every exported column, including ones not consumed by the engine, to prevent silent conflicts.
      const content = JSON.stringify(cells.map((v, i) => header[i].trim() === "transaction_id" ? v.trim() : v));
      const previous = seen.get(row.transaction_id);
      if (previous) {
        if (previous.content !== content) invalid(line, "transaction_id", `conflicting ID ${row.transaction_id}, first seen on line ${previous.line}`);
        continue;
      }
      seen.set(row.transaction_id, { content, line });
    }
    rows.push(row);
  }
  const migration = new Map<string, number>();
  for (const row of rows) if (row.type === "MIGRATION") migration.set(row.symbol, (migration.get(row.symbol) ?? 0) + nz(row.shares));
  const unbalanced = [...migration.entries()].filter(([, v]) => Math.abs(v) > 0.001);
  if (unbalanced.length) console.warn(`Unpaired MIGRATION rows (net shares != 0): ${JSON.stringify(unbalanced)}`);
  return rows;
}
