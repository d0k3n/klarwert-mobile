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
): AnnualPLProjection | null {
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
  const ytdPL = entries.reduce((sum, entry) => sum + entry.realized_pl, 0);
  const positiveDays = entries.filter((entry) => entry.realized_pl > 0).length;
  const bestDay = entries.reduce((best, entry) => entry.realized_pl > best.realized_pl ? entry : best);
  const worstDay = entries.reduce((worst, entry) => entry.realized_pl < worst.realized_pl ? entry : worst);
  const projectedPL = ytdPL / elapsedDays * daysInYear;

  return {
    year,
    as_of: asOfKey,
    ytd_pl: roundCurrency(ytdPL),
    projected_pl: roundCurrency(projectedPL),
    projected_remaining_pl: roundCurrency(projectedPL - ytdPL),
    average_calendar_day: roundCurrency(ytdPL / elapsedDays),
    average_active_day: roundCurrency(ytdPL / entries.length),
    active_days: entries.length,
    positive_days: positiveDays,
    positive_day_rate: Math.round(positiveDays / entries.length * 1000) / 10,
    elapsed_days: elapsedDays,
    days_in_year: daysInYear,
    best_day: { ...bestDay, realized_pl: roundCurrency(bestDay.realized_pl) },
    worst_day: { ...worstDay, realized_pl: roundCurrency(worstDay.realized_pl) },
  };
}
