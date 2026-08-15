import type { Row, EngineResult, LotMatch, OpenPosition, ClosedPosition, Product, CardRule } from "./types.ts";
import { isna, nz, absnz, roundTo, fmtYM, fmtYMD, isoFormat, sumOf, sumAbs, normalize } from "./util.ts";

interface Lot {
  id: number;
  shares: number;
  price: number;
  total_cost: number;
  datetime: Date | null;
}

const MCC_CATEGORIES: Record<string, string> = {
  "5411": "Groceries", "5499": "Groceries", "5412": "Groceries",
  "5812": "Restaurants", "5814": "Fast Food", "5813": "Bars",
  "5541": "Fuel", "5542": "Fuel",
  "4111": "Public Transport", "4121": "Taxi & Rideshare", "4789": "Transport",
  "5311": "Department Stores", "5651": "Clothing", "5732": "Electronics",
  "5912": "Pharmacy", "5977": "Cosmetics",
  "4814": "Telecom", "4899": "Streaming & TV",
  "5734": "Software", "7372": "Software", "5817": "Digital Goods", "5818": "Digital Goods",
  "6011": "ATM Withdrawal", "4900": "Utilities",
  "7832": "Cinema", "7941": "Sports", "7922": "Events",
  "5944": "Jewelry", "5999": "Misc Shopping", "5947": "Gifts",
  "7011": "Hotels", "3000": "Travel", "4511": "Travel",
};

function emptyProduct(isin: string, name: string, assetClass: string): Product {
  return {
    isin,
    name,
    asset_class: assetClass,
    status: "closed",
    total_invested: 0,
    total_realized_pl: 0,
    total_dividends: 0,
    total_dividend_tax: 0,
    total_dividends_net: 0,
    total_fees: 0,
    total_trades: 0,
  };
}

function emptyClosed(isin: string, name: string): ClosedPosition {
  return { isin, name, total_realized_pl: 0, closed_lots: 0, total_shares_sold: 0 };
}

function cmpDatetime(a: Date, b: Date): number {
  return a.getTime() - b.getTime();
}

export function run_engine(df: Row[]): EngineResult {
  const trades = df
    .filter((r) => r.tx_type === "BUY" || r.tx_type === "SELL")
    .slice()
    .sort((a, b) => cmpDatetime(a.datetime, b.datetime));
  const cash_rows = df.filter((r) => r.tx_type !== "BUY" && r.tx_type !== "SELL");

  const we_dates = new Map<string, Date>();
  for (const r of df) {
    if (r.type === "WARRANT_EXERCISE") {
      const cur = we_dates.get(r.symbol);
      if (cur === undefined || r.datetime < cur) we_dates.set(r.symbol, r.datetime);
    }
  }

  const by_isin = new Map<string, Row[]>();
  for (const row of trades) {
    let list = by_isin.get(row.symbol);
    if (!list) {
      list = [];
      by_isin.set(row.symbol, list);
    }
    list.push(row);
  }

  const tilg_by_isin = new Map<string, Row[]>();
  for (const r of cash_rows) {
    if (r.tx_type === "TILG") {
      let list = tilg_by_isin.get(r.symbol);
      if (!list) {
        list = [];
        tilg_by_isin.set(r.symbol, list);
      }
      list.push(r);
    }
  }

  const all_isins: string[] = [...by_isin.keys()];
  for (const isin of tilg_by_isin.keys()) {
    if (!by_isin.has(isin)) all_isins.push(isin);
  }

  const monthly_pl: Record<string, number> = {};
  const daily_pl: Record<string, number> = {};
  const lot_matches: LotMatch[] = [];
  const per_product = new Map<string, Product>();
  const closed_positions = new Map<string, ClosedPosition>();
  const open_positions: OpenPosition[] = [];

  const getClosed = (isin: string, name: string): ClosedPosition => {
    let cp = closed_positions.get(isin);
    if (!cp) {
      cp = emptyClosed(isin, name);
      closed_positions.set(isin, cp);
    }
    return cp;
  };

  for (const isin of all_isins) {
    const rows = by_isin.get(isin) ?? [];
    const tilg_rows = tilg_by_isin.get(isin) ?? [];
    let name: string;
    let asset_class: string;
    if (rows.length > 0) {
      name = rows[0].name;
      asset_class = rows[0].asset_class;
    } else {
      name = tilg_rows[0].name || isin;
      asset_class = tilg_rows[0].asset_class;
    }
    let total_invested = 0;
    let total_fees = 0;
    let total_trades = 0;
    let lot_id = 1;
    let open_lots: Lot[] = [];
    let last_dt: Date | null = null;

    const events: Array<{ dt: Date; kind: number; row: Row }> = [];
    for (const row of rows) events.push({ dt: row.datetime, kind: 0, row });
    for (const r of tilg_rows) events.push({ dt: r.datetime, kind: 1, row: r });
    events.sort((a, b) => {
      const c = cmpDatetime(a.dt, b.dt);
      if (c !== 0) return c;
      return a.kind - b.kind;
    });

    for (const ev of events) {
      const row = ev.row;
      last_dt = row.datetime;

      if (ev.kind === 1) {
        const amount = isna(row.amount) ? 0 : Math.abs(nz(row.amount));
        const cost = open_lots.reduce((acc, l) => acc + l.total_cost, 0);
        const shares_taken = open_lots.reduce((acc, l) => acc + l.shares, 0);
        const realized_pl = amount - cost;
        const month = fmtYM(row.datetime);
        monthly_pl[month] = (monthly_pl[month] ?? 0) + realized_pl;
        daily_pl[fmtYMD(row.datetime)] = (daily_pl[fmtYMD(row.datetime)] ?? 0) + realized_pl;
        const cp = getClosed(isin, name);
        cp.total_realized_pl += realized_pl;
        if (shares_taken > 0.001) {
          cp.closed_lots += 1;
          cp.total_shares_sold += shares_taken;
        }
        for (const l of open_lots) {
          const share_ratio = shares_taken > 0 ? l.shares / shares_taken : 0;
          const proceeds_lot = amount * share_ratio;
          lot_matches.push({
            isin,
            name,
            sell_id: String(row.transaction_id ?? ""),
            sell_datetime: isoFormat(row.datetime),
            lot_datetime: isoFormat(l.datetime),
            shares: roundTo(l.shares, 6),
            proceeds: roundTo(proceeds_lot, 2),
            cost_basis: roundTo(l.total_cost, 2),
            pl: roundTo(proceeds_lot - l.total_cost, 2),
          });
        }
        open_lots = [];
        continue;
      }

      const shares = nz(row.shares);
      const price = isna(row.price) ? 0 : Math.abs(nz(row.price));
      const fee = isna(row.fee) ? 0 : Math.abs(nz(row.fee));
      const tax = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
      const total_cost = shares * price + fee + tax;

      if (row.tx_type === "BUY") {
        total_invested += shares * price;
        total_fees += fee;
        total_trades += 1;

        if (row.knocked === true) {
          const lot: Lot = { id: lot_id++, shares, price, total_cost, datetime: row.datetime };
          const realized_pl = -lot.total_cost;
          const ko_dt = we_dates.get(isin) ?? row.datetime;
          const month = fmtYM(ko_dt);
          monthly_pl[month] = (monthly_pl[month] ?? 0) + realized_pl;
          daily_pl[fmtYMD(ko_dt)] = (daily_pl[fmtYMD(ko_dt)] ?? 0) + realized_pl;
          const cp = getClosed(isin, name);
          cp.total_realized_pl += realized_pl;
          cp.closed_lots += 1;
          cp.total_shares_sold += shares;
          lot_matches.push({
            isin,
            name,
            sell_id: "",
            sell_datetime: isoFormat(ko_dt),
            lot_datetime: isoFormat(row.datetime),
            shares: roundTo(shares, 6),
            proceeds: 0,
            cost_basis: roundTo(lot.total_cost, 2),
            pl: roundTo(-lot.total_cost, 2),
          });
        } else {
          let to_allocate = shares;
          while (to_allocate > 0.001 && open_lots.length > 0 && open_lots[0].shares < 0) {
            const neg = open_lots[0];
            const covered = Math.min(to_allocate, -neg.shares);
            const proceeds_portion = -neg.total_cost * (covered / -neg.shares);
            const cover_pl = proceeds_portion - covered * price;
            const month = fmtYM(row.datetime);
            daily_pl[fmtYMD(row.datetime)] = (daily_pl[fmtYMD(row.datetime)] ?? 0) + cover_pl;
            monthly_pl[month] = (monthly_pl[month] ?? 0) + cover_pl;
            const cp = getClosed(isin, name);
            cp.total_realized_pl += cover_pl;
            cp.closed_lots += 1;
            cp.total_shares_sold += covered;
            lot_matches.push({
              isin,
              name,
              sell_id: String(row.transaction_id ?? ""),
              sell_datetime: isoFormat(row.datetime),
              lot_datetime: isoFormat(neg.datetime),
              shares: roundTo(covered, 6),
              proceeds: roundTo(proceeds_portion, 2),
              cost_basis: roundTo(covered * price, 2),
              pl: roundTo(cover_pl, 2),
            });
            neg.shares += covered;
            neg.total_cost += proceeds_portion;
            to_allocate -= covered;
            if (-neg.shares < 0.001) {
              monthly_pl[month] = (monthly_pl[month] ?? 0) + -neg.total_cost;
              daily_pl[fmtYMD(row.datetime)] = (daily_pl[fmtYMD(row.datetime)] ?? 0) + -neg.total_cost;
              cp.total_realized_pl += -neg.total_cost;
              open_lots.shift();
            }
          }
          if (to_allocate > 0) {
            const ratio = to_allocate / shares;
            const lot_cost = to_allocate * price + (fee + tax) * ratio;
            open_lots.push({ id: lot_id++, shares: to_allocate, price, total_cost: lot_cost, datetime: row.datetime });
          }
        }
      } else if (row.tx_type === "SELL") {
        total_fees += fee;
        total_trades += 1;
        let remaining = shares;
        let sell_proceeds = 0;
        let cost_basis_total = 0;

        while (remaining > 0.001 && open_lots.length > 0 && open_lots[0].shares > 0) {
          const lot = open_lots[0];
          const used = Math.min(remaining, lot.shares);
          const ratio = used / lot.shares;
          const lot_cost_portion = lot.total_cost * ratio;
          sell_proceeds += used * price;
          cost_basis_total += lot_cost_portion;
          lot_matches.push({
            isin,
            name,
            sell_id: String(row.transaction_id ?? ""),
            sell_datetime: isoFormat(row.datetime),
            lot_datetime: isoFormat(lot.datetime),
            shares: roundTo(used, 6),
            proceeds: roundTo(used * price, 2),
            cost_basis: roundTo(lot_cost_portion, 2),
            pl: roundTo(used * price - lot_cost_portion, 2),
          });
          lot.total_cost -= lot_cost_portion;
          lot.shares -= used;
          remaining -= used;
          if (lot.shares < 0.001) {
            cost_basis_total += lot.total_cost;
            open_lots.shift();
          }
        }

        if (remaining > 0 && remaining <= 0.001) {
          sell_proceeds += remaining * price;
          remaining = 0;
        }

        if (remaining > 0.001) {
          if (price > 0) {
            console.warn(`SELL ${isin} exceeds bought quantity: ${remaining.toFixed(4)} shares tracked as short`);
            open_lots.push({ id: lot_id++, shares: -remaining, price, total_cost: -(remaining * price), datetime: row.datetime });
          } else {
            console.info(`SELL ${isin}: ${remaining.toFixed(4)} unmatched shares at zero price (expiration), ignored`);
          }
        }

        const realized_pl = sell_proceeds - cost_basis_total - fee - tax;
        const month = fmtYM(row.datetime);
        if (realized_pl !== 0) {
          monthly_pl[month] = (monthly_pl[month] ?? 0) + realized_pl;
          daily_pl[fmtYMD(row.datetime)] = (daily_pl[fmtYMD(row.datetime)] ?? 0) + realized_pl;
        }
        const cp = getClosed(isin, name);
        cp.total_realized_pl += realized_pl;
        const matched_shares = shares - remaining;
        if (matched_shares > 0.001) {
          cp.closed_lots += 1;
          cp.total_shares_sold += matched_shares;
        }
      }
    }

    const dust_cost = open_lots
      .filter((l) => Math.abs(l.shares) < 0.001)
      .reduce((acc, l) => acc + l.total_cost, 0);
    open_lots = open_lots.filter((l) => Math.abs(l.shares) >= 0.001);
    if (Math.abs(dust_cost) > 0 && last_dt !== null) {
      const month = fmtYM(last_dt);
      monthly_pl[month] = (monthly_pl[month] ?? 0) + -dust_cost;
      daily_pl[fmtYMD(last_dt)] = (daily_pl[fmtYMD(last_dt)] ?? 0) + -dust_cost;
      const cp = getClosed(isin, name);
      cp.total_realized_pl += -dust_cost;
    }

    if (open_lots.length > 0) {
      const remaining_shares = open_lots.reduce((acc, l) => acc + l.shares, 0);
      const total_cost_basis = open_lots.reduce((acc, l) => acc + l.total_cost, 0);
      const avg_cost = Math.abs(remaining_shares) > 0 ? total_cost_basis / remaining_shares : 0;
      open_positions.push({
        isin,
        name,
        asset_class,
        shares: roundTo(remaining_shares, 6),
        average_cost: roundTo(avg_cost, 4),
        total_cost: roundTo(total_cost_basis, 2),
      });
    }

    const cp = getClosed(isin, name);
    per_product.set(isin, {
      isin,
      name,
      asset_class,
      status: open_lots.length > 0 ? "open" : "closed",
      total_invested: roundTo(total_invested, 2),
      total_realized_pl: roundTo(cp.total_realized_pl, 2),
      total_dividends: 0,
      total_dividend_tax: 0,
      total_dividends_net: 0,
      total_fees: roundTo(total_fees, 2),
      total_trades,
    });
  }

  const total_open_cost = open_positions
    .filter((p) => p.total_cost > 0)
    .reduce((acc, p) => acc + p.total_cost, 0);
  for (const p of open_positions) {
    p.weight = total_open_cost > 0 && p.total_cost > 0 ? roundTo(p.total_cost / total_open_cost, 4) : 0;
  }

  for (const row of cash_rows) {
    if (row.tx_type !== "DIVIDEND") continue;
    const isin = row.symbol;
    if (!isin) continue;
    let product = per_product.get(isin);
    if (!product) {
      product = emptyProduct(isin, row.name, row.asset_class);
      per_product.set(isin, product);
    }
    const gross = isna(row.amount) ? 0 : nz(row.amount);
    const wht = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
    product.total_dividends += gross;
    product.total_dividend_tax += wht;
    product.total_dividends_net += gross - wht;
  }
  for (const p of per_product.values()) {
    p.total_dividends = roundTo(p.total_dividends, 2);
    p.total_dividend_tax = roundTo(p.total_dividend_tax, 2);
    p.total_dividends_net = roundTo(p.total_dividends_net, 2);
  }

  const open_cost_by_isin = new Map<string, number>();
  for (const p of open_positions) open_cost_by_isin.set(p.isin, p.total_cost);
  for (const [isin, p] of per_product) {
    const cost = open_cost_by_isin.get(isin);
    p.yield_on_cost = cost !== undefined && cost > 0 ? roundTo((100 * p.total_dividends_net) / cost, 2) : null;
  }

  const total_realized_pl = [...closed_positions.values()].reduce((acc, cp) => acc + cp.total_realized_pl, 0);

  const summary = computeSummary(df, cash_rows);
  summary.total_realized_pl = roundTo(total_realized_pl, 2);
  summary.total_income = roundTo(
    total_realized_pl + summary.total_dividends + summary.total_interest + summary.total_saveback,
    2
  );

  let cash_balance = sumOf(df, "amount") - summary.total_dividend_tax;
  const trade_rows = df.filter((r) => r.tx_type === "BUY" || r.tx_type === "SELL");
  const trade_fees = sumAbs(trade_rows, "fee");
  const trade_taxes = sumAbs(trade_rows, "tax");
  const fee_rows = cash_rows.filter((r) => r.tx_type === "FEE");
  const standalone_fee_col = sumAbs(fee_rows, "fee");
  cash_balance -= trade_fees + trade_taxes + standalone_fee_col;
  const open_cost = open_positions.reduce((acc, p) => acc + p.total_cost, 0);
  const standalone_fees = sumAbs(fee_rows, "amount") + standalone_fee_col;
  const income = summary.total_dividends_net + summary.total_interest + summary.total_saveback;
  const sources = summary.net_deposits + income + summary.total_realized_pl;
  const uses = cash_balance + open_cost + summary.total_card_spending + standalone_fees;
  summary.reconciliation = {
    net_deposits: summary.net_deposits,
    income: roundTo(income, 2),
    realized_pl: summary.total_realized_pl,
    cash_balance: roundTo(cash_balance, 2),
    open_positions_cost: roundTo(open_cost, 2),
    card_spending: summary.total_card_spending,
    fees: roundTo(standalone_fees, 2),
    difference: roundTo(sources - uses, 2),
  };

  const by_class: Record<string, Record<string, number>> = {};
  for (const p of per_product.values()) {
    const ac = p.asset_class || "(empty)";
    if (!by_class[ac]) {
      by_class[ac] = { total_invested: 0, total_realized_pl: 0, total_dividends: 0, total_dividend_tax: 0, total_fees: 0, count: 0 };
    }
    by_class[ac].total_invested += p.total_invested;
    by_class[ac].total_realized_pl += p.total_realized_pl;
    by_class[ac].total_dividends += p.total_dividends;
    by_class[ac].total_dividend_tax += p.total_dividend_tax;
    by_class[ac].total_fees += p.total_fees;
    by_class[ac].count += 1;
  }
  const by_asset_class: Record<string, Record<string, number>> = {};
  for (const [k, v] of Object.entries(by_class)) {
    by_asset_class[k] = {};
    for (const [sk, sv] of Object.entries(v)) {
      by_asset_class[k][sk] = roundTo(sv, 2);
    }
  }
  summary.by_asset_class = by_asset_class;

  const cash_flow = computeCashFlow(cash_rows);
  const transactions = getRecentTransactions(trades, 50);

  const closedOut: ClosedPosition[] = [];
  for (const cp of closed_positions.values()) {
    if (cp.closed_lots > 0 || Math.abs(cp.total_realized_pl) > 0.005) closedOut.push(cp);
  }

  return {
    summary,
    open_positions,
    closed_positions: closedOut,
    cash_flow,
    transactions,
    products: [...per_product.values()],
    monthly_pl: Object.entries(monthly_pl)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([month, v]) => ({ month, realized_pl: roundTo(v, 2) })),
    daily_pl: Object.entries(daily_pl)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, v]) => ({ date, realized_pl: roundTo(v, 2) })),
    lot_matches,
  };
}

function computeSummary(df: Row[], cash_rows: Row[]): Record<string, any> {
  const deposits = sumOf(cash_rows.filter((r) => r.tx_type === "DEPOSIT"), "amount");
  const withdrawals = Math.abs(sumOf(cash_rows.filter((r) => r.tx_type === "WITHDRAWAL"), "amount"));
  const dividends = sumOf(cash_rows.filter((r) => r.tx_type === "DIVIDEND"), "amount");
  const dividend_tax = Math.abs(sumOf(cash_rows.filter((r) => r.tx_type === "DIVIDEND"), "tax"));
  const interest = sumOf(cash_rows.filter((r) => r.tx_type === "INTEREST"), "amount");
  const saveback = sumOf(cash_rows.filter((r) => r.tx_type === "SAVEBACK"), "amount");
  const fees = Math.abs(sumOf(cash_rows.filter((r) => r.tx_type === "FEE"), "amount")) + Math.abs(sumOf(df, "fee"));
  const card_spending = Math.abs(sumOf(cash_rows.filter((r) => r.tx_type === "CARD"), "amount"));

  const total_buys = Math.abs(sumOf(df.filter((r) => r.tx_type === "BUY"), "amount"));
  const total_sells = sumOf(df.filter((r) => r.tx_type === "SELL"), "amount");
  const invested = total_buys - total_sells;

  return {
    total_deposits: roundTo(deposits, 2),
    total_withdrawals: roundTo(withdrawals, 2),
    net_deposits: roundTo(deposits - withdrawals, 2),
    total_dividends: roundTo(dividends, 2),
    total_dividend_tax: roundTo(dividend_tax, 2),
    total_dividends_net: roundTo(dividends - dividend_tax, 2),
    total_interest: roundTo(interest, 2),
    total_saveback: roundTo(saveback, 2),
    total_fees: roundTo(fees, 2),
    total_card_spending: roundTo(card_spending, 2),
    total_invested: roundTo(invested, 2),
  };
}

function computeCashFlow(cash_rows: Row[]): Array<Record<string, any>> {
  const grouped = new Map<string, Row[]>();
  for (const r of cash_rows) {
    const month = fmtYM(r.datetime);
    let list = grouped.get(month);
    if (!list) {
      list = [];
      grouped.set(month, list);
    }
    list.push(r);
  }
  const flow_types = ["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "INTEREST"];
  const result: Array<Record<string, any>> = [];
  for (const [month, group] of [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const entry: Record<string, any> = { month };
    for (const t of flow_types) {
      const val = sumOf(group.filter((r) => r.tx_type === t), "amount");
      entry[t.toLowerCase()] = roundTo(t === "WITHDRAWAL" ? Math.abs(val) : val, 2);
    }
    result.push(entry);
  }
  return result;
}

function getRecentTransactions(trades: Row[], limit = 50): Array<Record<string, any>> {
  const recent = trades.slice(-limit).reverse();
  const result: Array<Record<string, any>> = [];
  for (const row of recent) {
    result.push({
      id: row.transaction_id ?? "",
      datetime: isoFormat(row.datetime),
      type: row.tx_type,
      name: row.name,
      symbol: row.symbol,
      shares: isna(row.shares) ? null : roundTo(nz(row.shares), 6),
      price: isna(row.price) ? null : roundTo(nz(row.price), 4),
      amount: isna(row.amount) ? null : roundTo(nz(row.amount), 2),
      asset_class: row.asset_class,
    });
  }
  return result;
}

export function category_for_merchant(name: unknown, mcc: unknown, rules: CardRule[] | null | undefined): string {
  const norm_name = normalize(name);
  if (!norm_name) return "Other";
  let best: CardRule | null = null;
  for (const r of rules ?? []) {
    const norm = normalize(r?.pattern);
    if (norm && norm_name.includes(norm)) {
      if (!best || norm.length > normalize(best.pattern).length) best = r;
    }
  }
  if (best) return best.category;
  return MCC_CATEGORIES[String(mcc ?? "").trim()] ?? "Other";
}

export function compute_spending(df: Row[], rules?: CardRule[]): { by_category: Array<{ category: string; total: number }>; monthly: Array<{ month: string; total: number }> } {
  const by_category = new Map<string, number>();
  const by_month = new Map<string, number>();
  for (const row of df) {
    if (row.tx_type !== "CARD") continue;
    const amount = isna(row.amount) ? 0 : nz(row.amount);
    const mcc = String(row.mcc_code ?? "").trim();
    const category = category_for_merchant(row.name, mcc, rules);
    by_category.set(category, (by_category.get(category) ?? 0) + -amount);
    const month = fmtYM(row.datetime);
    by_month.set(month, (by_month.get(month) ?? 0) + -amount);
  }
  const categories = [...by_category.entries()]
    .sort((a, b) => b[1] - a[1])
    .filter(([, t]) => Math.abs(t) > 0.005)
    .map(([category, total]) => ({ category, total: roundTo(total, 2) }));
  const monthly = [...by_month.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, total]) => ({ month, total: roundTo(total, 2) }));
  return { by_category: categories, monthly };
}

export function compute_income(df: Row[]): { monthly: Array<Record<string, any>>; dividends: Array<Record<string, any>> } {
  const monthly = new Map<string, { dividends: number; interest: number; saveback: number }>();
  const dividends: Array<Record<string, any>> = [];
  for (const row of df) {
    if (row.tx_type !== "DIVIDEND" && row.tx_type !== "INTEREST" && row.tx_type !== "SAVEBACK") continue;
    const month = fmtYM(row.datetime);
    const amount = isna(row.amount) ? 0 : nz(row.amount);
    let entry = monthly.get(month);
    if (!entry) {
      entry = { dividends: 0, interest: 0, saveback: 0 };
      monthly.set(month, entry);
    }
    if (row.tx_type === "DIVIDEND") {
      const wht = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
      entry.dividends += amount - wht;
      const currency = (row.original_currency || row.currency || "").trim();
      dividends.push({
        date: isoFormat(row.datetime).slice(0, 10),
        name: row.name,
        isin: row.symbol,
        gross: roundTo(amount, 2),
        wht: roundTo(wht, 2),
        net: roundTo(amount - wht, 2),
        currency,
      });
    } else if (row.tx_type === "INTEREST") {
      entry.interest += amount;
    } else if (row.tx_type === "SAVEBACK") {
      entry.saveback += amount;
    }
  }
  const monthly_list = [...monthly.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([m, v]) => ({
      month: m,
      dividends: roundTo(v.dividends, 2),
      interest: roundTo(v.interest, 2),
      saveback: roundTo(v.saveback, 2),
      total: roundTo(v.dividends + v.interest + v.saveback, 2),
    }));
  dividends.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { monthly: monthly_list, dividends };
}

export function compute_derivative_executions(df: Row[], knocked_ids: Set<string>): Array<Record<string, any>> {
  const deriv = df.filter((r) => r.asset_class === "DERIVATIVE");
  if (deriv.length === 0) return [];

  const buys = deriv.filter((r) => r.tx_type === "BUY");
  const warrant_ex = deriv.filter((r) => r.type === "WARRANT_EXERCISE");
  const tilg = deriv.filter((r) => r.tx_type === "TILG");

  const by_isin = new Map<string, Record<string, any>>();
  const ensure = (row: Row): Record<string, any> => {
    let entry = by_isin.get(row.symbol);
    if (!entry) {
      entry = {
        name: row.name, isin: row.symbol, asset_class: "DERIVATIVE",
        ko_quantity: 0, ko_loss: 0, ko_fees: 0, ko_tax: 0,
        warrant_quantity: 0, warrant_return: 0,
      };
      by_isin.set(row.symbol, entry);
    }
    return entry;
  };

  for (const row of buys) {
    if (knocked_ids.has(row.transaction_id ?? "")) {
      const entry = ensure(row);
      entry.ko_quantity += nz(row.shares);
      const price = isna(row.price) ? 0 : Math.abs(nz(row.price));
      const fee = isna(row.fee) ? 0 : Math.abs(nz(row.fee));
      entry.ko_loss += -(nz(row.shares) * price);
      entry.ko_fees += -fee;
      const tax = isna(row.tax) ? 0 : Math.abs(nz(row.tax));
      entry.ko_tax += -tax;
    }
  }

  for (const row of warrant_ex) {
    ensure(row).warrant_quantity += Math.abs(nz(row.shares));
  }

  for (const row of tilg) {
    const entry = ensure(row);
    if (!isna(row.amount)) entry.warrant_return += Math.abs(nz(row.amount));
  }

  const result: Array<Record<string, any>> = [];
  for (const entry of by_isin.values()) {
    if (entry.ko_quantity === 0 && entry.warrant_quantity === 0 && entry.warrant_return === 0) continue;
    entry.ko_loss = roundTo(entry.ko_loss, 2);
    entry.ko_fees = roundTo(entry.ko_fees, 2);
    entry.ko_tax = roundTo(entry.ko_tax, 2);
    entry.ko_total = roundTo(entry.ko_loss + entry.ko_fees + entry.ko_tax, 2);
    entry.warrant_return = roundTo(entry.warrant_return, 2);
    entry.net_result = roundTo(entry.ko_total + entry.warrant_return, 2);
    entry.reconciled = Math.abs(entry.ko_quantity - entry.warrant_quantity) < 0.01;
    result.push(entry);
  }

  return result.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function auto_detect_knocked(df: Row[]): Set<string> {
  const deriv = df.filter((r) => r.asset_class === "DERIVATIVE");
  if (deriv.length === 0) return new Set();

  const buys = deriv.filter((r) => r.tx_type === "BUY");
  const regular_sells = deriv.filter((r) => r.tx_type === "SELL" && r.type !== "WARRANT_EXERCISE");
  const warrant_ex = deriv.filter((r) => r.type === "WARRANT_EXERCISE");

  const auto_ids = new Set<string>();
  const seen = new Set<string>();
  for (const row of deriv) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    const isin = row.symbol;
    const isin_we = warrant_ex.filter((r) => r.symbol === isin);
    if (isin_we.length === 0) continue;

    const total_we = sumOf(isin_we, "shares");

    const lots: Array<[number, string]> = buys
      .filter((r) => r.symbol === isin)
      .map((r) => [nz(r.shares), r.transaction_id ?? ""]);

    for (const sell_row of regular_sells.filter((r) => r.symbol === isin)) {
      let remaining = nz(sell_row.shares);
      while (remaining > 0.001 && lots.length > 0) {
        const lot = lots[0];
        const used = Math.min(remaining, lot[0]);
        lot[0] -= used;
        remaining -= used;
        if (lot[0] < 0.001) lots.shift();
      }
    }

    const remaining_shares = lots.reduce((acc, lot) => acc + lot[0], 0);

    if (Math.abs(remaining_shares - total_we) < 0.01) {
      for (const lot of lots) auto_ids.add(lot[1]);
    }
  }

  return auto_ids;
}

export function compute_card_transactions(df: Row[], rules?: CardRule[]): Array<Record<string, any>> {
  const card = df
    .filter((r) => r.tx_type === "CARD")
    .slice()
    .sort((a, b) => cmpDatetime(b.datetime, a.datetime));
  const result: Array<Record<string, any>> = [];
  for (const row of card) {
    const mcc = String(row.mcc_code ?? "").trim();
    result.push({
      id: row.transaction_id ?? "",
      datetime: isoFormat(row.datetime),
      name: row.name,
      amount: isna(row.amount) ? null : roundTo(Math.abs(nz(row.amount)), 2),
      description: row.description ?? "",
      category: category_for_merchant(row.name, mcc, rules),
    });
  }
  return result;
}

export function uncategorized_vendors(df: Row[], rules?: CardRule[]): Array<{ name: string; count: number; total: number }> {
  const groups = new Map<string, { name: string; count: number; total: number }>();
  for (const row of df) {
    if (row.tx_type !== "CARD") continue;
    const name = String(row.name ?? "").trim();
    if (!name) continue;
    const mcc = String(row.mcc_code ?? "").trim();
    if (category_for_merchant(name, mcc, rules) !== "Other") continue;
    const amount = isna(row.amount) ? 0 : nz(row.amount);
    let g = groups.get(name);
    if (!g) {
      g = { name, count: 0, total: 0 };
      groups.set(name, g);
    }
    g.count += 1;
    g.total += -amount;
  }
  const out = [...groups.values()].map((g) => ({ name: g.name, count: g.count, total: roundTo(g.total, 2) }));
  return out.sort((a, b) => (a.total !== b.total ? b.total - a.total : a.name < b.name ? -1 : 1));
}

export function apply_prices(
  open_positions: OpenPosition[],
  prices: Record<string, { price: number; source?: string } | number>
): { positions: OpenPosition[]; totals: { market_value: number; unrealized_pl: number } } {
  const positions: OpenPosition[] = [];
  let total_value = 0;
  let total_unrealized = 0;
  for (const p of open_positions) {
    const entry = prices[p.isin];
    const price = entry !== undefined ? (typeof entry === "object" ? entry.price : entry) : undefined;
    const row: OpenPosition = { ...p };
    if (price !== undefined && price !== null) {
      row.market_price = price;
      row.market_value = roundTo(p.shares * price, 2);
      row.unrealized_pl = roundTo(p.shares * price - p.total_cost, 2);
      total_value += row.market_value;
      total_unrealized += row.unrealized_pl;
    } else {
      row.market_price = null;
      row.market_value = null;
      row.unrealized_pl = null;
    }
    positions.push(row);
  }
  return {
    positions,
    totals: {
      market_value: roundTo(total_value, 2),
      unrealized_pl: roundTo(total_unrealized, 2),
    },
  };
}
