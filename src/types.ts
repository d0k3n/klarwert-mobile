export interface Row {
  /** Stable ledger occurrence identity, independent of the original broker ID. */
  movement_id?: string;
  datetime: Date;
  date: string;
  category: string;
  type: string;
  tx_type: string;
  asset_class: string;
  name: string;
  symbol: string;
  shares: number | null;
  price: number | null;
  amount: number | null;
  fee: number | null;
  tax: number | null;
  currency: string;
  original_amount: number | null;
  original_currency: string;
  fx_rate: number | null;
  description: string;
  transaction_id: string;
  counterparty_name: string;
  counterparty_iban: string;
  payment_reference: string;
  mcc_code: string;
  knocked?: boolean;
  /** Imported fee/tax are signed cash movements, separate from gross amount. */
  charges_signed?: boolean;
}

export interface LotMatch {
  isin: string;
  name: string;
  sell_id: string;
  sell_key?: string;
  sell_datetime: string;
  lot_datetime: string;
  lot_key?: string;
  /** Disposal charges from the original short sale, when covered by a buy. */
  disposal_fees?: number;
  shares: number;
  proceeds: number;
  cost_basis: number;
  pl: number;
}

export interface OpenPosition {
  isin: string;
  name: string;
  asset_class: string;
  shares: number;
  average_cost: number;
  total_cost: number;
  /** Exact FIFO cost for aggregation; total_cost remains rounded for display. */
  total_cost_raw?: number;
  weight?: number;
  market_price?: number | null;
  market_value?: number | null;
  market_value_raw?: number | null;
  unrealized_pl?: number | null;
}

export interface ClosedPosition {
  isin: string;
  name: string;
  total_realized_pl: number;
  closed_lots: number;
  total_shares_sold: number;
}

export interface Product {
  isin: string;
  name: string;
  underlying?: string;
  asset_class: string;
  status: string;
  total_invested: number;
  total_realized_pl: number;
  total_dividends: number;
  total_dividend_tax: number;
  total_dividends_net: number;
  total_fees: number;
  total_trades: number;
  yield_on_cost?: number | null;
}

export interface EngineResult {
  realization_events?: RealizationEvent[];
  summary: Record<string, any>;
  open_positions: OpenPosition[];
  closed_positions: ClosedPosition[];
  cash_flow: Array<Record<string, any>>;
  transactions: Array<Record<string, any>>;
  products: Product[];
  monthly_pl: Array<{ month: string; realized_pl: number }>;
  daily_pl: Array<{ date: string; realized_pl: number }>;
  lot_matches: LotMatch[];
}

export interface AnalysisPeriod { start: string; end: string; }
export interface PageRequest { page?: number; page_size?: number; search?: string; }
export interface PageResult<T> { items: T[]; total: number; page: number; page_size: number; pages: number; }
export interface RealizationEvent {
  id: string; movement_id: string; transaction_id: string;
  date: string; datetime: string; kind: "sale" | "redemption" | "extinction" | "legacy_cover";
  isin: string; name: string; shares: number;
  gross_proceeds: number; gross_cost: number; acquisition_charges: number;
  exit_charges: number; gross_result: number; net_result: number | null;
  known_net_result: number; cost_quality: "known" | "unknown";
  unmatched_shares: number; lots: LotMatch[];
}
export interface DailyAnalysis {
  date: string; net_result: number; cumulative: number; operations: number; incomplete: number;
}
export interface ResultsAnalysis {
  revision: string; period: AnalysisPeriod;
  coverage: { first_movement: string | null; last_movement: string | null; complete: boolean; warning: string };
  metrics: { net_result: number; operations: number; valid_operations: number; incomplete_operations: number;
    wins: number; losses: number; zeros: number; win_rate: number | null;
    average_win: number | null; average_loss: number | null; average_result: number | null; profit_factor: number | null };
  daily: DailyAnalysis[]; realizations: RealizationEvent[];
  income: { dividends: number; interest: number };
  previous: { period: AnalysisPeriod; net_result: number; comparable: boolean } | null;
}

export interface CardRule {
  pattern: string;
  category: string;
}
