import type { Row, LotMatch } from "./types.ts";
import { nz, roundTo, sumOf, isoFormat, operationIdentity, chargeExpense } from "./util.ts";

export function build_tax_report(df: Row[], lot_matches: LotMatch[], year: number): Record<string, any> {
  const fee_by_sell = new Map<string, number>();
  const legacy_fee_by_sell = new Map<string, number>();
  df.forEach((row, index) => {
    if (row.tx_type !== "SELL") return;
    const expense = chargeExpense(row, row.fee) + chargeExpense(row, row.tax);
    legacy_fee_by_sell.set(operationIdentity(row, index), expense);
    fee_by_sell.set(`@row:${index}`, expense);
  });

  const disposals = new Map<string, any>();
  const parents=new Map<string,string>();
  const lotIdentity=(m:LotMatch)=>m.lot_key ?? `${m.isin}|${m.lot_datetime}`;
  const find=(key:string):string=> {
    const parent=parents.get(key);
    if(!parent) { parents.set(key,key); return key; }
    if(parent === key) return key;
    const root=find(parent); parents.set(key,root); return root;
  };
  const lotsByDisposal=new Map<string,string>();
  for(const m of lot_matches) {
    if(!m.lot_datetime && !m.lot_key) continue;
    const operation=`${m.sell_key ?? m.sell_id}|${m.sell_datetime}|${m.isin}`;
    const key=lotIdentity(m),first=lotsByDisposal.get(operation);
    if(first) parents.set(find(key),find(first));
    else { lotsByDisposal.set(operation,key); find(key); }
  }
  const consumed_cost = new Map<string,number>();
  const ordered = lot_matches.map((m,index)=>({m,index})).sort((a,b)=>Date.parse(a.m.sell_datetime)-Date.parse(b.m.sell_datetime) || a.index-b.index);
  for (const {m,index} of ordered) {
    // Carry a purchase lot's fraction of a cent into its next disposal. Process
    // the complete history first so a year boundary cannot reset that carry.
    // Lots consumed together share a carry, preserving sub-cent precision
    // inside that operation. Unrelated purchase lots keep separate carries.
    const lotKey=find(lotIdentity(m));
    const previous=consumed_cost.get(lotKey) ?? 0;
    const cumulative=previous+m.cost_basis;
    const allocatedCost=roundTo(cumulative,2)-roundTo(previous,2);
    consumed_cost.set(lotKey,cumulative);
    const dt = new Date(m.sell_datetime);
    if (dt.getUTCFullYear() !== year) continue;
    const identity = m.sell_key ?? m.sell_id;
    const key = `${identity}|${m.sell_datetime}|${m.isin}`;
    let d = disposals.get(key);
    if (!d) {
      d = {date:m.sell_datetime.slice(0,10),order:index,name:m.name,isin:m.isin,shares:0,proceeds:0,cost_basis:0,
        fees:m.disposal_fees !== undefined ? 0 : (m.sell_key ? fee_by_sell.get(m.sell_key) : legacy_fee_by_sell.get(m.sell_id)) ?? 0,acquired_dates:new Set<string>()};
      disposals.set(key,d);
    }
    d.shares += m.shares;
    d.proceeds += m.proceeds;
    d.cost_basis += allocatedCost;
    if (m.disposal_fees !== undefined) d.fees += m.disposal_fees;
    if (m.lot_datetime) d.acquired_dates.add(m.lot_datetime.slice(0,10));
  }
  const disposal_list = [...disposals.values()].sort((a,b)=>a.date.localeCompare(b.date) || a.order-b.order).map(d => ({
    date:d.date,name:d.name,isin:d.isin,shares:d.shares,proceeds:roundTo(d.proceeds,2),
    cost_basis:roundTo(d.cost_basis,2),fees:roundTo(d.fees,2),gain:roundTo(roundTo(d.proceeds,2)-roundTo(d.cost_basis,2)-roundTo(d.fees,2),2),
    acquired:[...d.acquired_dates].sort().join(", "),
  }));
  // Each operation aggregates its full-precision FIFO matches before rounding.
  // Annual totals then sum those finalized transactions without reallocating
  // cents from one independent disposal to another.
  const totals = {
    proceeds:roundTo(disposal_list.reduce((sum,d)=>sum+d.proceeds,0),2),
    cost_basis:roundTo(disposal_list.reduce((sum,d)=>sum+d.cost_basis,0),2),
    fees:roundTo(disposal_list.reduce((sum,d)=>sum+d.fees,0),2),
    gain:roundTo(disposal_list.reduce((sum,d)=>sum+d.gain,0),2),
  };
  disposal_list.sort((a,b)=>a.date.localeCompare(b.date));
  const dividendRows = df.filter(r=>r.tx_type === "DIVIDEND" && r.datetime.getUTCFullYear() === year);
  const dividends = dividendRows.map(row => {
    const gross=nz(row.amount),wht=chargeExpense(row,row.tax),fee=chargeExpense(row,row.fee);
    return {date:isoFormat(row.datetime).slice(0,10),name:row.name,isin:row.symbol,
      gross:roundTo(gross,2),wht:roundTo(wht,2),fees:roundTo(fee,2),net:roundTo(gross-wht-fee,2),currency:row.currency.trim()};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  const incomeTotals = (rows:Row[]) => ({
    gross:roundTo(sumOf(rows,"amount"),2),
    wht:roundTo(rows.reduce((sum,r)=>sum+chargeExpense(r,r.tax),0),2),
    fees:roundTo(rows.reduce((sum,r)=>sum+chargeExpense(r,r.fee),0),2),
    net:roundTo(rows.reduce((sum,r)=>sum+nz(r.amount)-chargeExpense(r,r.tax)-chargeExpense(r,r.fee),0),2),
  });
  const interest_totals = incomeTotals(df.filter(r=>r.tx_type === "INTEREST" && r.datetime.getUTCFullYear() === year));
  const saveback_totals = incomeTotals(df.filter(r=>r.tx_type === "SAVEBACK" && r.datetime.getUTCFullYear() === year));
  return {year,disposals:disposal_list,disposal_totals:totals,dividends,dividend_totals:incomeTotals(dividendRows),
    interest:interest_totals.gross,interest_totals,saveback:saveback_totals.gross,saveback_totals};
}
