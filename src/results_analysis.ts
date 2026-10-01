import type { AnalysisPeriod, EngineResult, PageRequest, PageResult, ResultsAnalysis, Row } from "./types.ts";
import { chargeExpense, fmtYMD, nz, roundTo } from "./util.ts";

export const movementDate = (row: Row): string => row.date || fmtYMD(row.datetime);
export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function validatePeriod(period: AnalysisPeriod): number {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!valid(period.start) || !valid(period.end) || period.start > period.end) throw new Error("Invalid analysis period");
  const days = Math.round((Date.parse(period.end) - Date.parse(period.start)) / 86400000) + 1;
  if (days > 36600) throw new Error("Analysis period exceeds 100 years");
  return days;
}
export function paginate<T>(items: T[], request: PageRequest = {}): PageResult<T> {
  const search = String(request.search || "").trim().toLocaleLowerCase();
  const filtered = search ? items.filter(item => {
    const record = item as Record<string, unknown>;
    return [record.name, record.isin, record.symbol].some(v => String(v ?? "").toLocaleLowerCase().includes(search));
  }) : items;
  const page_size = Number.isFinite(request.page_size) ? Math.max(1, Math.min(500, Math.floor(request.page_size!))) : 25;
  const pages = Math.ceil(filtered.length / page_size);
  const page = Number.isFinite(request.page) ? Math.max(1, Math.min(pages || 1, Math.floor(request.page!))) : 1;
  return { items: filtered.slice((page - 1) * page_size, page * page_size), total: filtered.length, page, page_size, pages };
}
export function analyzeResults(rows: Row[], result: EngineResult, period: AnalysisPeriod, revision: string): ResultsAnalysis {
  const days = validatePeriod(period);
  const events = result.realization_events ?? [];
  const within = (d: string) => d >= period.start && d <= period.end;
  const realizations = events.filter(e => within(e.date)).slice().sort((a,b) => b.datetime.localeCompare(a.datetime) || b.id.localeCompare(a.id));
  const valid = realizations.filter(e => e.cost_quality === "known" && e.net_result !== null);
  const values = valid.map(e => roundTo(e.net_result!, 2));
  const wins = values.filter(v => v > 0), losses = values.filter(v => v < 0);
  const sum = (vs: number[]) => roundTo(vs.reduce((a,b) => a + b, 0), 2);
  const net_result = sum(values);
  const raw_net_result = roundTo(valid.reduce((s,e) => s + e.net_result!, 0), 2);
  const rounding_difference = roundTo(net_result - raw_net_result, 2);
  let cumulative = 0;
  const grouped = new Map<string, typeof realizations>();
  for (const e of realizations) { const group = grouped.get(e.date) || []; group.push(e); grouped.set(e.date, group); }
  const daily = Array.from({ length: days }, (_, index) => {
    const date = shiftDay(period.start, index), group = grouped.get(date) || [];
    const net_result = sum(group.filter(e => e.cost_quality === "known" && e.net_result !== null).map(e => roundTo(e.net_result!, 2)));
    cumulative = roundTo(cumulative + net_result, 2);
    return { date, net_result, cumulative, operations: group.length, incomplete: group.filter(e => e.cost_quality === "unknown").length };
  });
  const dates = rows.map(movementDate).sort(), first = dates[0] || null, last = dates.at(-1) || null;
  const prior = { start: shiftDay(period.start, -days), end: shiftDay(period.start, -1) };
  const priorEvents = events.filter(e => e.date >= prior.start && e.date <= prior.end);
  const selectedRows = rows.filter(r => within(movementDate(r)));
  const income = (type: string) => sum(selectedRows.filter(r => r.tx_type === type).map(r => nz(r.amount) - chargeExpense(r,r.fee) - chargeExpense(r,r.tax)));
  return {
    revision, period: { ...period }, coverage: { first_movement: first, last_movement: last, complete: false,
      warning: "Movement dates do not establish complete statement coverage." + (rounding_difference ? ` Operation-level cent rounding differs from raw accounting by EUR ${rounding_difference.toFixed(2)}.` : "") },
    metrics: { net_result, operations: realizations.length, valid_operations: valid.length,
      incomplete_operations: realizations.length - valid.length, wins: wins.length, losses: losses.length,
      zeros: values.filter(v => v === 0).length, win_rate: valid.length ? roundTo(wins.length / valid.length, 4) : null,
      average_win: wins.length ? roundTo(sum(wins) / wins.length, 2) : null,
      average_loss: losses.length ? roundTo(sum(losses) / losses.length, 2) : null,
      average_result: valid.length ? roundTo(net_result / valid.length, 2) : null,
      profit_factor: losses.length ? roundTo(sum(wins) / -sum(losses), 4) : null },
    daily, realizations, income: { dividends: income("DIVIDEND"), interest: income("INTEREST") },
    previous: { period: prior, net_result: sum(priorEvents.filter(e => e.cost_quality === "known" && e.net_result !== null).map(e => roundTo(e.net_result!,2))), comparable: false },
  };
}
