export interface Row {
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
}

export interface LotMatch {
  isin: string;
  name: string;
  sell_id: string;
  sell_datetime: string;
  lot_datetime: string;
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
  weight?: number;
  market_price?: number | null;
  market_value?: number | null;
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

export interface CardRule {
  pattern: string;
  category: string;
}
