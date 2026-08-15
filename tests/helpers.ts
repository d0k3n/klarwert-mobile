import type { Row } from "../src/types.ts";

export function dt(s: string): Date {
  return new Date(s.endsWith("Z") ? s : s + "Z");
}

export function makeDf(rows: Array<Record<string, any>>): Row[] {
  return rows.map((r) => ({
    datetime: r.datetime instanceof Date ? r.datetime : dt(String(r.datetime ?? "2025-01-01")),
    date: "",
    category: r.category ?? "",
    type: r.type ?? "",
    tx_type: r.tx_type ?? "",
    asset_class: r.asset_class ?? "",
    name: r.name ?? "",
    symbol: r.symbol ?? "",
    shares: r.shares ?? null,
    price: r.price ?? null,
    amount: r.amount ?? null,
    fee: r.fee ?? null,
    tax: r.tax ?? null,
    currency: r.currency ?? "",
    original_amount: null,
    original_currency: r.original_currency ?? "",
    fx_rate: null,
    description: "",
    transaction_id: r.transaction_id ?? "",
    counterparty_name: "",
    counterparty_iban: "",
    payment_reference: "",
    mcc_code: r.mcc_code ?? "",
    knocked: r.knocked,
  }));
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ]|$)/;

function parseDate(s: string): number | null {
  if (!DATE_RE.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export interface Diff {
  path: string;
  expected: unknown;
  actual: unknown;
}

export function deepCompare(expected: any, actual: any, path = "", diffs: Diff[] = []): Diff[] {
  if (expected === null || expected === undefined || actual === null || actual === undefined) {
    if (!(expected === null || expected === undefined) || !(actual === null || actual === undefined)) {
      diffs.push({ path, expected, actual });
    }
    return diffs;
  }
  if (typeof expected === "number" && typeof actual === "number") {
    const diff = Math.abs(expected - actual);
    const rel = Math.abs(expected) > 1e6 ? diff / Math.abs(expected) : 0;
    if (!(diff <= 0.011 || rel <= 1e-9)) {
      diffs.push({ path, expected, actual });
    }
    return diffs;
  }
  if (typeof expected === "string" && typeof actual === "string") {
    const ed = parseDate(expected);
    const ad = parseDate(actual);
    if (ed !== null && ad !== null) {
      if (Math.abs(ed - ad) > 1000) diffs.push({ path, expected, actual });
    } else if (expected !== actual) {
      diffs.push({ path, expected, actual });
    }
    return diffs;
  }
  if (typeof expected === "boolean" || typeof actual === "boolean") {
    if (expected !== actual) diffs.push({ path, expected, actual });
    return diffs;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      diffs.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
      deepCompare(expected[i], actual[i], `${path}[${i}]`, diffs);
    }
    return diffs;
  }
  if (typeof expected === "object" && typeof actual === "object") {
    const eKeys = Object.keys(expected).sort();
    const aKeys = Object.keys(actual).sort();
    if (eKeys.join(",") !== aKeys.join(",")) {
      diffs.push({ path: `${path}.keys`, expected: eKeys, actual: aKeys });
    }
    for (const k of eKeys) {
      if (k in actual) deepCompare(expected[k], actual[k], `${path}.${k}`, diffs);
    }
    return diffs;
  }
  if (expected !== actual) diffs.push({ path, expected, actual });
  return diffs;
}

export function expectDeepEqual(expected: any, actual: any, message = ""): void {
  const diffs = deepCompare(expected, actual);
  if (diffs.length > 0) {
    const shown = diffs.slice(0, 20).map((d) => `${d.path}: expected ${JSON.stringify(d.expected)} got ${JSON.stringify(d.actual)}`);
    throw new Error(`${message || "structures differ"} (${diffs.length} diffs)\n${shown.join("\n")}`);
  }
}
