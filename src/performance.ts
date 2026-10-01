import type { Row, EngineResult, OpenPosition } from "./types.ts";
import { nz, roundTo, isoFormat, chargeExpense, tradeGross } from "./util.ts";

interface Flow { d: Date; amount: number }

export function xirr(flows: Flow[]): number | null {
  if (!flows.length || flows.some(f => !Number.isFinite(f.amount) || !Number.isFinite(f.d.getTime()))) return null;
  // Net flows at identical instants first: a same-day deposit and terminal value
  // cannot determine an annual return, even if both signs were supplied.
  const grouped = new Map<number, number>();
  for (const f of flows) grouped.set(f.d.getTime(), (grouped.get(f.d.getTime()) ?? 0) + f.amount);
  const entries = [...grouped].filter(([, amount]) => amount !== 0).sort((a, b) => a[0] - b[0]);
  if (entries.length < 2 || !entries.some(([, a]) => a > 0) || !entries.some(([, a]) => a < 0)) return null;
  const t0 = entries[0][0];
  const times = entries.map(([d]) => (d - t0) / 86400000 / 365);
  if (entries.some(([,a])=>!Number.isFinite(a))) return null;
  // In x=log(1+rate), NPV is an exponential polynomial. Its derivative
  // (after factoring out the earliest exponential) has one fewer term.
  // Recursively isolate its turning points, then bisect each monotone interval.
  // Unlike a grid scan, this cannot skip two nearby crossings in one interval.
  const lower=Math.log(Number.EPSILON/2),upper=Math.log(Number.MAX_VALUE);
  let evaluations=0;
  const exhausted=Symbol("XIRR computation budget");
  const roots = (ts:number[], amounts:number[],depth=0):number[] => {
    if(depth>500) throw exhausted;
    if (amounts.length < 2) return [];
    const scale=Math.max(...amounts.map(Math.abs));
    const coefficients=amounts.map(a=>a/scale);
    const offset=ts[0], normalized=ts.map(t=>t-offset);
    const evaluate=(x:number) => {
      if(++evaluations>100_000) throw exhausted;
      const shift=x < 0 ? -x*normalized[normalized.length-1] : 0;
      let sum=0, magnitude=0;
      coefficients.forEach((a,i)=> {
        const term=a*Math.exp(-x*normalized[i]-shift);
        sum+=term; magnitude+=Math.abs(term);
      });
      return {value:sum, relative:sum/magnitude};
    };
    let variations=0;
    coefficients.forEach((a,i)=> { if(i && Math.sign(a)!==Math.sign(coefficients[i-1])) variations++; });
    if (!variations) return [];
    // One coefficient sign change guarantees at most one real zero. This
    // shortcut keeps ordinary investment cash flows inexpensive.
    const turning=variations === 1 ? [] : roots(normalized.slice(1),coefficients.slice(1).map((a,i)=>-a*normalized[i+1]),depth+1);
    const points=[lower,...turning,upper], found:number[]=[];
    for (const point of turning) if (Math.abs(evaluate(point).relative)<1e-12) found.push(point);
    for(let i=1;i<points.length;i++) {
      let a=points[i-1],b=points[i],fa=evaluate(a).value,fb=evaluate(b).value;
      if (fa === 0) found.push(a);
      if (fb === 0) found.push(b);
      if (!fa || !fb || Math.sign(fa)===Math.sign(fb)) continue;
      for(let j=0;j<200 && b-a>1e-12;j++) {
        const mid=(a+b)/2,fm=evaluate(mid).value;
        if(fm===0) { a=b=mid; break; }
        if(Math.sign(fa)!==Math.sign(fm)) b=mid;
        else { a=mid; fa=fm; }
      }
      found.push((a+b)/2);
    }
    return found.sort((a,b)=>a-b).filter((r,i,all)=>i===0 || r-all[i-1]>1e-8);
  };
  let candidates:number[];
  try { candidates=roots(times,entries.map(([,a])=>a)); }
  catch(error) { if(error === exhausted) return null; throw error; }
  if(candidates.length!==1) return null;
  const rate = Math.expm1(candidates[0]);
  return Number.isFinite(rate) ? (Math.abs(rate)<1e-12 ? 0 : rate) : null;
}

export interface PerformanceOptions {
  valuedPositions?: OpenPosition[];
  asOf?: Date;
}

export function compute_performance(df: Row[], result: EngineResult, options: PerformanceOptions = {}): Record<string, any> {
  const open_cost = result.open_positions.reduce((acc, p) => acc + (p.total_cost_raw ?? p.total_cost), 0);
  const cash_balance = df.reduce((sum,row)=> {
    const amount=row.amount === null && ["BUY","SELL"].includes(row.tx_type)
      ? (row.tx_type === "BUY" ? -1 : 1)*tradeGross(row) : nz(row.amount);
    return sum+amount-chargeExpense(row,row.fee)-chargeExpense(row,row.tax);
  },0);
  const costTerminal=cash_balance+open_cost;
  const terminal_value_at_cost = Number.isFinite(costTerminal) ? roundTo(costTerminal, 2) : null;
  const lastDate = df.length ? df.reduce((acc, r) => r.datetime > acc ? r.datetime : acc, df[0].datetime) : null;
  const asOf = options.asOf ?? lastDate;
  if (asOf && (!Number.isFinite(asOf.getTime()) || (lastDate && asOf < lastDate))) throw new Error("Performance valuation date must be valid and no earlier than the last transaction");
  const valued = options.valuedPositions ?? [];
  const values = result.open_positions.map(p => {
    const match = valued.find(v => v.isin === p.isin && v.shares === p.shares);
    return match?.market_value_raw ?? match?.market_value;
  });
  const priced_positions = values.filter(v => typeof v === "number" && Number.isFinite(v)).length;
  const marketTerminal=cash_balance+values.reduce<number>((sum,v)=>sum+(v ?? 0),0);
  const valuation_complete = priced_positions === result.open_positions.length && Number.isFinite(marketTerminal);
  const terminal_value = valuation_complete ? roundTo(marketTerminal, 2) : null;
  const flows: Flow[] = df.filter(r => ["DEPOSIT", "WITHDRAWAL", "CARD"].includes(r.tx_type)).map(r => ({d:r.datetime, amount:-nz(r.amount)}));
  const rateAt = (value: number | null) => value !== null && asOf ? xirr([...flows, {d:asOf,amount:value}]) : null;
  const rate = rateAt(valuation_complete ? marketTerminal : null), costRate = rateAt(Number.isFinite(costTerminal) ? costTerminal : null);
  const realizedValues = result.realization_events
    ? result.realization_events.filter(e => e.cost_quality === "known" && e.net_result !== null).map(e => roundTo(e.net_result!, 2))
    : result.closed_positions.map(c => roundTo(c.total_realized_pl, 2));
  const wins = realizedValues.filter(v => v > 0), losses = realizedValues.filter(v => v < 0);
  const total_closed = realizedValues.length;
  return {
    xirr: rate !== null ? roundTo(rate, 4) : null,
    xirr_total: rate !== null ? roundTo(rate, 4) : null,
    xirr_at_cost: costRate !== null ? roundTo(costRate, 4) : null,
    terminal_value, terminal_value_at_cost,
    valuation_basis: valuation_complete ? "market" : "incomplete",
    valuation_complete, priced_positions, total_positions:result.open_positions.length,
    as_of: asOf ? isoFormat(asOf) : null,
    winners:wins.length, losers:losses.length,
    win_rate:total_closed ? roundTo(100 * wins.length / total_closed,1):null,
    avg_win:wins.length ? roundTo(wins.reduce((a,b)=>a+b,0)/wins.length,2):null,
    avg_loss:losses.length ? roundTo(losses.reduce((a,b)=>a+b,0)/losses.length,2):null,
  };
}
