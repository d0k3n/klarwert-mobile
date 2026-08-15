import type { Row } from "./types.ts";
import { isna, nz, absnz } from "./util.ts";

const TRADING_TYPES = new Set(["BUY", "SELL"]);
const CASH_TYPES: Record<string, string> = {
  TRANSFER_INSTANT_INBOUND: "DEPOSIT",
  TRANSFER_INSTANT_OUTBOUND: "WITHDRAWAL",
  CARD_TRANSACTION: "CARD",
  CARD_TRANSACTION_INTERNATIONAL: "CARD",
  CARD_ORDERING_FEE: "FEE",
  DIVIDEND: "DIVIDEND",
  INTEREST_PAYMENT: "INTEREST",
  BENEFITS_SAVEBACK: "SAVEBACK",
  TILG: "TILG",
};
const DELIVERY_TYPES: Record<string, string> = { MIGRATION: "MIGRATION" };
const SELL_TYPES = new Set(["WARRANT_EXERCISE"]);

const NUMERIC_COLS = new Set(["shares", "price", "amount", "fee", "tax"]);

export function parseCSVText(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // skip; \n handles the line break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

function parseDatetime(s: string): Date {
  const t = s.trim();
  if (!t) return new Date(NaN);
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/.test(t);
  return new Date(hasTz ? t : t + "Z");
}

function toNumber(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isNaN(v) ? null : v;
}

function classifyRow(category: string, type: string): string {
  if (category === "TRADING" && TRADING_TYPES.has(type)) return type;
  if (SELL_TYPES.has(type)) return "SELL";
  if (type in CASH_TYPES) return CASH_TYPES[type];
  if (type in DELIVERY_TYPES) return DELIVERY_TYPES[type];
  console.warn(`Unrecognized row type=${type} category=${category}`);
  return "OTHER";
}

export function parseCSV(text: string): Row[] {
  const grid = parseCSVText(text);
  if (grid.length === 0) return [];
  const header = grid[0];
  const colIndex: Record<string, number> = {};
  header.forEach((h, i) => {
    colIndex[h.trim()] = i;
  });
  const get = (row: string[], name: string): string => {
    const i = colIndex[name];
    const v = i !== undefined ? row[i] : undefined;
    return v === undefined || v === null ? "" : v;
  };

  const rawRows: Row[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    const row: Row = {
      datetime: parseDatetime(get(cells, "datetime")),
      date: get(cells, "date"),
      category: get(cells, "category"),
      type: get(cells, "type"),
      tx_type: "",
      asset_class: get(cells, "asset_class"),
      name: get(cells, "name"),
      symbol: get(cells, "symbol"),
      shares: null,
      price: null,
      amount: null,
      fee: null,
      tax: null,
      currency: get(cells, "currency"),
      original_amount: null,
      original_currency: get(cells, "original_currency"),
      fx_rate: null,
      description: get(cells, "description"),
      transaction_id: get(cells, "transaction_id"),
      counterparty_name: get(cells, "counterparty_name"),
      counterparty_iban: get(cells, "counterparty_iban"),
      payment_reference: get(cells, "payment_reference"),
      mcc_code: get(cells, "mcc_code"),
    };
    for (const col of NUMERIC_COLS) {
      (row as any)[col] = toNumber(get(cells, col));
    }
    row.original_amount = toNumber(get(cells, "original_amount"));
    row.fx_rate = toNumber(get(cells, "fx_rate"));
    row.shares = row.shares === null ? null : Math.abs(nz(row.shares));
    rawRows.push(row);
  }

  if (colIndex["transaction_id"] !== undefined) {
    const seen = new Set<string>();
    const out: Row[] = [];
    let dropped = 0;
    for (const row of rawRows) {
      if (row.transaction_id) {
        if (seen.has(row.transaction_id)) {
          dropped++;
          continue;
        }
        seen.add(row.transaction_id);
      }
      out.push(row);
    }
    if (dropped > 0) console.warn(`Dropped ${dropped} duplicate rows by transaction_id`);
    rawRows.length = 0;
    rawRows.push(...out);
  }

  const mig = new Map<string, number>();
  for (const row of rawRows) {
    if (row.type === "MIGRATION") {
      mig.set(row.symbol, (mig.get(row.symbol) ?? 0) + nz(row.shares));
    }
  }
  const unbalanced = [...mig.entries()].filter(([, v]) => Math.abs(v) > 0.001);
  if (unbalanced.length > 0) {
    console.warn(`Unpaired MIGRATION rows (net shares != 0): ${JSON.stringify(unbalanced)}`);
  }

  for (const row of rawRows) {
    row.tx_type = classifyRow(row.category, row.type);
  }

  return rawRows;
}
