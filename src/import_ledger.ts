import { parseCSVDetailed } from "./csv.ts";
import type { Row } from "./types.ts";

export interface LedgerSource { id: string; text: string; headers: string[]; }
export interface LedgerMovement { movement_id: string; source_id: string; record: number; }
export interface ImportLedger {
  format: "klarwert-ledger"; version: 1; revision: string;
  next_source: number; sources: LedgerSource[]; movements: LedgerMovement[];
}
export interface ImportSummary { added: number; duplicates: number; count: number; removed: number; mode: "incremental" | "replace"; }
export interface PreparedImport { ledger: ImportLedger; summary: ImportSummary; }
export function emptyLedger(): ImportLedger {
  return { format: "klarwert-ledger", version: 1, revision: "0", next_source: 1, sources: [], movements: [] };
}
function clone<T>(v: T): T { return JSON.parse(JSON.stringify(v)); }
function schema(headers: string[]): string { return JSON.stringify(headers.map(h => h.trim()).sort()); }
export function ledgerRows(ledger: ImportLedger): Row[] {
  const parsed = new Map(ledger.sources.map(s => [s.id, parseCSVDetailed(s.text)]));
  return ledger.movements.map(m => {
    const row = parsed.get(m.source_id)?.records[m.record]?.row;
    if (!row) throw new Error("Invalid ledger provenance");
    return { ...row, datetime: new Date(row.datetime), movement_id: m.movement_id };
  });
}
export function prepareImport(current: ImportLedger, text: string, options: { mode?: "incremental" | "replace" } = {}): PreparedImport {
  const mode = options.mode ?? "incremental";
  if (typeof text !== "string" || text.length > 50_000_000) throw new Error("Statement exceeds import limits");
  const incoming = parseCSVDetailed(text);
  if (!incoming.records.length) throw new Error("The statement contains no movements");
  if (text.length > 50_000_000 || incoming.records.length > 200_000) throw new Error("Statement exceeds import limits");
  if (mode === "incremental" && current.sources.some(s => schema(s.headers) !== schema(incoming.headers)))
    throw new Error("Incompatible CSV schema. Re-export a complete history and use validated replacement.");
  if (mode === "incremental" && current.sources.some(s => s.text === text))
    return { ledger: clone(current), summary: { added: 0, duplicates: incoming.records.length, count: current.movements.length, removed: 0, mode } };
  const oldRows = ledgerRows(current);
  if (mode === "incremental" && oldRows.length) {
    const incomingRows = incoming.rows;
    const dates = (rows: Row[]) => rows.map(r => r.date).sort();
    const a = dates(oldRows), b = dates(incomingRows);
    if ((oldRows.some(r => !r.transaction_id) || incomingRows.some(r => !r.transaction_id)) && a[0] <= b.at(-1)! && b[0] <= a.at(-1)!)
      throw new Error("Ambiguous anonymous overlap. Re-export a complete history and use validated replacement.");
  }
  const ledger = mode === "replace" ? { ...emptyLedger(), next_source: current.next_source } : clone(current);
  const known = new Map<string, string>();
  for (const source of ledger.sources) {
    for (const record of parseCSVDetailed(source.text).records) if (record.row.transaction_id) known.set(record.row.transaction_id, record.canonical);
  }
  const sourceId = `source-${ledger.next_source}`;
  let added = 0, duplicates = 0;
  incoming.records.forEach((record, index) => {
    const id = record.row.transaction_id;
    if (id && known.has(id)) {
      if (known.get(id) !== record.canonical) throw new Error(`Conflicting transaction ID ${id}; current history remains unchanged`);
      duplicates++; return;
    }
    if (id) known.set(id, record.canonical);
    ledger.movements.push({ movement_id: id ? `tx:${encodeURIComponent(id)}` : `${sourceId}:occurrence-${index}`, source_id: sourceId, record: index });
    added++;
  });
  if (added || mode === "replace") {
    ledger.sources.push({ id: sourceId, text, headers: incoming.headers });
    ledger.next_source++;
    if (!Number.isSafeInteger(Number(current.revision) + 1)) throw new Error("Ledger revision exceeds safe limits");
    ledger.revision = String(Number(current.revision) + 1);
  }
  return { ledger, summary: { added, duplicates, count: ledger.movements.length, removed: mode === "replace" ? current.movements.length : 0, mode } };
}
export function validateLedger(value: unknown): ImportLedger {
  if (!value || typeof value !== "object") throw new Error("Invalid ledger");
  const v = value as ImportLedger;
  if (v.format !== "klarwert-ledger" || v.version !== 1 || typeof v.revision !== "string" || !/^\d+$/.test(v.revision) || !Number.isSafeInteger(Number(v.revision))) throw new Error("Unsupported ledger format or revision");
  if (!Number.isSafeInteger(v.next_source) || v.next_source < 1 || !Array.isArray(v.sources) || !Array.isArray(v.movements) || v.sources.length > 10000 || v.movements.length > 200000) throw new Error("Invalid ledger limits");
  const sources = new Map<string, ReturnType<typeof parseCSVDetailed>>();
  let bytes = 0;
  for (const s of v.sources) {
    if (!s || typeof s.id !== "string" || !/^source-[1-9]\d*$/.test(s.id) || Number(s.id.slice(7)) >= v.next_source || sources.has(s.id) || typeof s.text !== "string" || !Array.isArray(s.headers)) throw new Error("Invalid ledger source");
    bytes += s.text.length;
    if (bytes > 50_000_000) throw new Error("Ledger exceeds size limit");
    const parsed = parseCSVDetailed(s.text);
    if (JSON.stringify(parsed.headers) !== JSON.stringify(s.headers)) throw new Error("Ledger header provenance mismatch");
    if (sources.size && schema(parsed.headers) !== schema([...sources.values()][0].headers)) throw new Error("Incompatible ledger schemas");
    sources.set(s.id, parsed);
  }
  const identities = new Set<string>(), occurrences = new Set<string>();
  for (const m of v.movements) {
    if (!m || !Number.isInteger(m.record) || m.record < 0) throw new Error("Invalid ledger occurrence");
    const record = sources.get(m.source_id)?.records[m.record];
    if (!record || record.duplicate) throw new Error("Invalid ledger source reference");
    const expected = record.row.transaction_id ? `tx:${encodeURIComponent(record.row.transaction_id)}` : `${m.source_id}:occurrence-${m.record}`;
    if (m.movement_id !== expected || identities.has(expected) || occurrences.has(`${m.source_id}:${m.record}`)) throw new Error("Invalid or duplicate movement identity");
    identities.add(expected); occurrences.add(`${m.source_id}:${m.record}`);
  }
  // Every unique source occurrence must be represented (ID duplicates across sources may reference the original).
  const contents = new Map<string, string>();
  for (const [sourceId, parsed] of sources) for (const [index, record] of parsed.records.entries()) {
    const id = record.row.transaction_id;
    if (id) {
      if (contents.has(id) && contents.get(id) !== record.canonical) throw new Error("Conflicting ledger source content");
      contents.set(id, record.canonical);
      if (!identities.has(`tx:${encodeURIComponent(id)}`)) throw new Error("Missing ledger movement");
    } else if (!occurrences.has(`${sourceId}:${index}`)) throw new Error("Missing anonymous occurrence");
  }
  return clone(v);
}
