import type { AnalysisPeriod, ResultsAnalysis, Row } from "./types.ts";
import { roundTo } from "./util.ts";

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function resolveAnalysisPeriod(query: URLSearchParams, rows: Row[]): AnalysisPeriod {
  const dates = rows.map(row => row.date).filter(validDate).sort();
  const fallback = new Date().toISOString().slice(0, 10);
  const start = query.get("start") ?? dates[0] ?? fallback;
  const end = query.get("end") ?? dates.at(-1) ?? fallback;
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("Invalid inclusive analysis period");
  if ((Date.parse(end) - Date.parse(start)) / 86400000 > 36600) throw new Error("Analysis period exceeds 100 years");
  return { start, end };
}

/** Immutable snapshot input: no DOM or later API responses can change the export. */
export function analysisCSV(analysis: ResultsAnalysis): string {
  const columns = ["revision", "period_start", "period_end", "id", "transaction_id", "date", "datetime", "kind", "isin", "name", "shares", "gross_proceeds", "gross_cost", "acquisition_charges", "exit_charges", "gross_result", "net_result", "known_net_result", "cost_quality", "unmatched_shares"] as const;
  const escape = (value: unknown) => {
    let text = value == null ? "" : String(value);
    // Spreadsheet formula injection protection applies to text, not signed numeric amounts.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [columns.join(","), ...analysis.realizations.map(event => {
    const record = { ...event, net_result: event.net_result == null ? null : roundTo(event.net_result, 2),
      known_net_result: roundTo(event.known_net_result, 2), revision: analysis.revision, period_start: analysis.period.start, period_end: analysis.period.end };
    return columns.map(column => escape(record[column])).join(",");
  })].join("\r\n");
}
