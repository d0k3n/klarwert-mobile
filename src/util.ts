export function isna(val: unknown): boolean {
  return val === null || val === undefined || (typeof val === "number" && Number.isNaN(val));
}

export function nz(val: number | null | undefined): number {
  return isna(val) ? 0 : (val as number);
}

export function absnz(val: number | null | undefined): number {
  return Math.abs(nz(val));
}

const PRECISION_TABLE = new Map<number, number>([
  [0, 1],
  [1, 10],
  [2, 100],
  [3, 1000],
  [4, 10000],
  [5, 100000],
  [6, 1000000],
]);

/**
 * Round half away from zero, matching Python round() closely enough for
 * financial display values (differences only occur at exact x.xx5 float
 * boundaries, handled by test tolerances).
 */
export function roundTo(val: number, decimals: number): number {
  const f = PRECISION_TABLE.get(decimals) ?? 10 ** decimals;
  const scaled = (val + Number.EPSILON) * f;
  return Number.isFinite(scaled) ? Math.round(scaled) / f : val;
}

export function fmtYM(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export function fmtYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function fmtYMDHMS(d: Date): string {
  return `${fmtYMD(d)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes()
  ).padStart(2, "0")}:${String(d.getUTCSeconds()).padStart(2, "0")}`;
}

export function isoFormat(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString();
}

export function sumOf(rows: any[], key: string): number {
  let acc = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && !Number.isNaN(v)) acc += v;
  }
  return acc;
}

export function sumAbs(rows: any[], key: string): number {
  let acc = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && !Number.isNaN(v)) acc += Math.abs(v);
  }
  return acc;
}

export function normalize(s: unknown): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable identity in the original input order, including operations without IDs. */
export function operationIdentity(row: { transaction_id?: string }, index: number): string {
  return row.transaction_id?.trim() || `@row:${index}`;
}

/** Signed imports preserve cash debits and refunds. Legacy income reversals
 * reverse their associated charges too.
 * Positive charges remain supported for manually entered / legacy gross rows.
 */
export function chargeExpense(row: { tx_type: string; amount: number | null; charges_signed?: boolean }, value: number | null | undefined): number {
  if (row.charges_signed) return -nz(value);
  const reversal = ["DIVIDEND", "INTEREST", "SAVEBACK", "TILG"].includes(row.tx_type) && nz(row.amount) < 0;
  return (reversal ? -1 : 1) * Math.abs(nz(value));
}

/** Gross settlement amount is authoritative; displayed unit prices can be rounded. */
export function tradeGross(row: { amount: number | null; shares: number | null; price: number | null }): number {
  return isna(row.amount) ? Math.abs(nz(row.shares) * nz(row.price)) : Math.abs(nz(row.amount));
}
