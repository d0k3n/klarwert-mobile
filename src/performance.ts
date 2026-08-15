import type { Row, EngineResult } from "./types.ts";
import { isna, nz, roundTo } from "./util.ts";

interface Flow {
  d: Date;
  amount: number;
}

export function xirr(flows: Flow[]): number | null {
  if (!flows.length) return null;
  const amounts = flows.map((f) => f.amount);
  if (!(amounts.some((a) => a > 0) && amounts.some((a) => a < 0))) return null;
  const t0 = flows.reduce((acc, f) => (f.d < acc ? f.d : acc), flows[0].d).getTime();

  const npv = (rate: number): number =>
    flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, (f.d.getTime() - t0) / 86400000 / 365), 0);

  let lo = -0.9999;
  let hi = 10.0;
  let flo = npv(lo);
  const fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-9) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

export function compute_performance(df: Row[], result: EngineResult): Record<string, any> {
  const summary = result.summary;
  const open_cost = result.open_positions.reduce((acc, p) => acc + p.total_cost, 0);
  const cash_balance = summary.reconciliation?.cash_balance ?? 0;
  const terminal_value = roundTo(cash_balance + open_cost, 2);

  const flows: Flow[] = [];
  for (const row of df) {
    if (row.tx_type === "DEPOSIT" || row.tx_type === "WITHDRAWAL") {
      flows.push({ d: row.datetime, amount: -nz(row.amount) });
    }
  }
  if (df.length > 0) {
    const maxDt = df.reduce((acc, r) => (r.datetime > acc ? r.datetime : acc), df[0].datetime);
    flows.push({ d: maxDt, amount: terminal_value });
  }
  const rate = xirr(flows);

  const closed = result.closed_positions;
  const wins = closed.filter((c) => c.total_realized_pl > 0).map((c) => c.total_realized_pl);
  const losses = closed.filter((c) => c.total_realized_pl < 0).map((c) => c.total_realized_pl);
  const total_closed = wins.length + losses.length;

  return {
    xirr: rate !== null ? roundTo(rate, 4) : null,
    terminal_value,
    winners: wins.length,
    losers: losses.length,
    win_rate: total_closed ? roundTo((100 * wins.length) / total_closed, 1) : null,
    avg_win: wins.length ? roundTo(wins.reduce((a, b) => a + b, 0) / wins.length, 2) : null,
    avg_loss: losses.length ? roundTo(losses.reduce((a, b) => a + b, 0) / losses.length, 2) : null,
  };
}
