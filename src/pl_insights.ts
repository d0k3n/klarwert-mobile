export interface DailyPL {
  date: string;
  realized_pl: number;
}

export interface AnnualPLProjection {
  year: number;
  as_of: string;
  ytd_pl: number;
  projected_pl: number;
  projected_remaining_pl: number;
  average_calendar_day: number;
  average_active_day: number;
  active_days: number;
  positive_days: number;
  positive_day_rate: number;
  elapsed_days: number;
  days_in_year: number;
  remaining_days: number;
  active_days_per_week: number;
  projected_future_active_days: number;
  best_day: DailyPL;
  worst_day: DailyPL;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysBetweenInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000) + 1;
}

export function computeAnnualPLProjection(
  daily: DailyPL[],
  asOf: Date = new Date(),
  activeDaysPerWeek = 3,
): AnnualPLProjection | null {
  if (!Number.isInteger(activeDaysPerWeek) || activeDaysPerWeek < 1 || activeDaysPerWeek > 7) {
    throw new Error("Active days per week must be an integer from 1 to 7");
  }
  const asOfKey = dateKey(asOf);
  const year = asOf.getFullYear();
  const yearPrefix = `${year}-`;
  const entries = daily
    .filter((entry) => entry.date.startsWith(yearPrefix) && entry.date <= asOfKey)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!entries.length) return null;

  const startOfYear = `${year}-01-01`;
  const endOfYear = `${year}-12-31`;
  const elapsedDays = daysBetweenInclusive(startOfYear, asOfKey);
  const daysInYear = daysBetweenInclusive(startOfYear, endOfYear);
  const remainingDays = daysInYear - elapsedDays;
  const ytdPL = entries.reduce((sum, entry) => sum + entry.realized_pl, 0);
  const positiveDays = entries.filter((entry) => entry.realized_pl > 0).length;
  const bestDay = entries.reduce((best, entry) => entry.realized_pl > best.realized_pl ? entry : best);
  const worstDay = entries.reduce((worst, entry) => entry.realized_pl < worst.realized_pl ? entry : worst);
  const averageActiveDay = ytdPL / entries.length;
  const projectedFutureActiveDays = remainingDays / 7 * activeDaysPerWeek;
  const projectedRemainingPL = averageActiveDay * projectedFutureActiveDays;
  const projectedPL = ytdPL + projectedRemainingPL;

  return {
    year,
    as_of: asOfKey,
    ytd_pl: roundCurrency(ytdPL),
    projected_pl: roundCurrency(projectedPL),
    projected_remaining_pl: roundCurrency(projectedRemainingPL),
    average_calendar_day: roundCurrency(ytdPL / elapsedDays),
    average_active_day: roundCurrency(averageActiveDay),
    active_days: entries.length,
    positive_days: positiveDays,
    positive_day_rate: Math.round(positiveDays / entries.length * 1000) / 10,
    elapsed_days: elapsedDays,
    days_in_year: daysInYear,
    remaining_days: remainingDays,
    active_days_per_week: activeDaysPerWeek,
    projected_future_active_days: Math.round(projectedFutureActiveDays * 10) / 10,
    best_day: { ...bestDay, realized_pl: roundCurrency(bestDay.realized_pl) },
    worst_day: { ...worstDay, realized_pl: roundCurrency(worstDay.realized_pl) },
  };
}

// Automatic scenarios use only imported movements and valid realized operations.
import type { Row, EngineResult } from "./types.ts";
import { movementDate, shiftDay } from "./results_analysis.ts";
import { roundTo } from "./util.ts";

export interface AutomaticProjectionScenario {
  status: "available" | "insufficient_sample" | "unknown_cost" | "closed_year";
  observed_start: string; observed_end: string;
  observation_days: number; active_days: number; average_active_day: number | null;
  cadence: number; observed_pl: number; ytd_pl: number; remaining_days: number;
  projected_remaining_pl: number | null; projected_pl: number | null; formula: string;
}
export interface AutomaticProjection {
  year: number; as_of: string; reference: "last_imported_movement"; year_closed: boolean;
  coverage_assumption: string;
  historical: AutomaticProjectionScenario; recent: AutomaticProjectionScenario;
}
export function computeAutomaticProjection(rows: Row[], result: EngineResult): AutomaticProjection | null {
  if (!rows.length) return null;
  const dates = rows.map(movementDate).sort(), as_of = dates.at(-1)!;
  const year = Number(as_of.slice(0,4)), yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
  const observedStart = dates.find(d => d >= yearStart)!;
  const year_closed = year < new Date().getUTCFullYear() || as_of === yearEnd;
  const annual = (result.realization_events ?? []).filter(e => e.date >= yearStart && e.date <= as_of);
  const ytd = roundTo(annual.filter(e => e.cost_quality === "known" && e.net_result !== null).reduce((sum,e) => sum + roundTo(e.net_result!,2),0),2);
  const unknownAnnual = annual.some(e => e.cost_quality === "unknown");
  const scenario = (start: string): AutomaticProjectionScenario => {
    const events = annual.filter(e => e.date >= start);
    const grouped = new Map<string, number>();
    for (const e of events) if (e.cost_quality === "known" && e.net_result !== null)
      grouped.set(e.date, (grouped.get(e.date) ?? 0) + roundTo(e.net_result,2));
    const observation_days = daysBetweenInclusive(start, as_of), active_days = grouped.size;
    const observed_pl = roundTo([...grouped.values()].reduce((s,v) => s + v,0),2);
    const average = active_days ? observed_pl / active_days : null;
    const cadence = active_days / observation_days;
    const remaining_days = year_closed ? 0 : Math.max(0, daysBetweenInclusive(as_of, yearEnd)-1);
    const status = unknownAnnual ? "unknown_cost" : year_closed ? "closed_year" : observation_days < 30 || active_days < 10 ? "insufficient_sample" : "available";
    const future = status === "available" ? (average ?? 0) * cadence * remaining_days : status === "closed_year" ? 0 : null;
    return { status, observed_start: start, observed_end: as_of, observation_days, active_days,
      average_active_day: average === null ? null : roundTo(average,2), cadence,
      observed_pl, ytd_pl: ytd, remaining_days,
      projected_remaining_pl: future === null ? null : roundTo(future,2),
      projected_pl: future === null ? null : roundTo(ytd + future,2),
      formula: "annual observed net + (window net / realization days) × (realization days / observed calendar days) × remaining calendar days" };
  };
  return { year, as_of, reference: "last_imported_movement", year_closed,
    coverage_assumption: "Assumes imported movements cover the interval from first movement in this year through the last imported movement; completeness is unverified.",
    historical: scenario(observedStart), recent: scenario([observedStart, shiftDay(as_of,-59)].sort().at(-1)!) };
}
