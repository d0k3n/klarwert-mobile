import type { Row, LotMatch } from "./types.ts";
import { isna, nz, roundTo, sumOf, isoFormat } from "./util.ts";

export function build_tax_report(df: Row[], lot_matches: LotMatch[], year: number): Record<string, any> {
  const fee_by_sell = new Map<string, number>();
  for (const row of df) {
    if (row.tx_type !== "SELL") continue;
    const sid = String(row.transaction_id ?? "");
    const fee = isna(row.fee) ? 0 : Math.abs(nz(row.fee));
    const tax = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
    fee_by_sell.set(sid, fee + tax);
  }

  const disposals = new Map<string, any>();
  for (const m of lot_matches) {
    const dt = new Date(m.sell_datetime);
    if (dt.getUTCFullYear() !== year) continue;
    const key = `${m.sell_id}|${m.sell_datetime}|${m.isin}`;
    let d = disposals.get(key);
    if (!d) {
      d = {
        date: m.sell_datetime.slice(0, 10),
        name: m.name,
        isin: m.isin,
        shares: 0,
        proceeds: 0,
        cost_basis: 0,
        fees: fee_by_sell.get(m.sell_id) ?? 0,
        acquired_dates: new Set<string>(),
      };
      disposals.set(key, d);
    }
    d.shares += m.shares;
    d.proceeds += m.proceeds;
    d.cost_basis += m.cost_basis;
    if (m.lot_datetime) d.acquired_dates.add(m.lot_datetime.slice(0, 10));
  }

  const disposal_list: Array<Record<string, any>> = [];
  for (const d of disposals.values()) {
    disposal_list.push({
      date: d.date,
      name: d.name,
      isin: d.isin,
      shares: roundTo(d.shares, 6),
      proceeds: roundTo(d.proceeds, 2),
      cost_basis: roundTo(d.cost_basis, 2),
      fees: roundTo(d.fees, 2),
      gain: roundTo(d.proceeds - d.cost_basis - d.fees, 2),
      acquired: [...d.acquired_dates].sort().join(", "),
    });
  }
  disposal_list.sort((a, b) => (a.date < b.date ? -1 : 1));

  const totals = {
    proceeds: roundTo(disposal_list.reduce((acc, d) => acc + d.proceeds, 0), 2),
    cost_basis: roundTo(disposal_list.reduce((acc, d) => acc + d.cost_basis, 0), 2),
    fees: roundTo(disposal_list.reduce((acc, d) => acc + d.fees, 0), 2),
    gain: roundTo(disposal_list.reduce((acc, d) => acc + d.gain, 0), 2),
  };

  const dividends: Array<Record<string, any>> = [];
  for (const row of df) {
    if (row.tx_type !== "DIVIDEND") continue;
    if (row.datetime.getUTCFullYear() !== year) continue;
    const gross = isna(row.amount) ? 0 : nz(row.amount);
    const wht = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
    const currency = (row.original_currency || row.currency || "").trim();
    dividends.push({
      date: isoFormat(row.datetime).slice(0, 10),
      name: row.name,
      isin: row.symbol,
      gross: roundTo(gross, 2),
      wht: roundTo(wht, 2),
      net: roundTo(gross - wht, 2),
      currency,
    });
  }
  dividends.sort((a, b) => (a.date < b.date ? -1 : 1));
  const div_totals = {
    gross: roundTo(dividends.reduce((acc, d) => acc + d.gross, 0), 2),
    wht: roundTo(dividends.reduce((acc, d) => acc + d.wht, 0), 2),
    net: roundTo(dividends.reduce((acc, d) => acc + d.net, 0), 2),
  };

  const interest = sumOf(
    df.filter((r) => r.tx_type === "INTEREST" && r.datetime.getUTCFullYear() === year),
    "amount"
  );
  const saveback = sumOf(
    df.filter((r) => r.tx_type === "SAVEBACK" && r.datetime.getUTCFullYear() === year),
    "amount"
  );

  return {
    year,
    disposals: disposal_list,
    disposal_totals: totals,
    dividends,
    dividend_totals: div_totals,
    interest: roundTo(interest, 2),
    saveback: roundTo(saveback, 2),
  };
}
