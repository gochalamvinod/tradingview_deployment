export interface UdfConfig {
  supports_search: boolean;
  supports_group_request: boolean;
  supports_marks: boolean;
  supports_timescale_marks: boolean;
  supports_time: boolean;
  supports_quotes: boolean;
  supported_resolutions: string[];
  has_seconds: boolean;
  has_ticks: boolean;
  has_intraday: boolean;
  has_daily: boolean;
  has_weekly_and_monthly: boolean;
}

export interface HistoryBars {
  s: 'ok' | 'no_data' | 'error';
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  nextTime?: number;
}

export interface SymbolInfo {
  name: string;
  ticker: string;
  description: string;
  type: string;
  session: string;
  timezone: string;
  exchange: string;
  listed_exchange: string;
  minmov: number;
  pricescale: number;
  has_intraday: boolean;
  has_seconds: boolean;
  has_ticks: boolean;
  supported_resolutions: string[];
  data_status: string;
}

export interface QuoteData {
  s: string;
  n: string;
  v: {
    ch: number;
    chp: number;
    lp: number;
    ask: number;
    bid: number;
    spread: number;
    open_price: number;
    high_price: number;
    low_price: number;
    prev_close_price: number;
    volume: number;
    description: string;
    exchange: string;
    original_name: string;
    short_name: string;
  };
}

export interface SearchResult {
  symbol: string;
  ticker: string;
  full_name: string;
  description: string;
  exchange: string;
  type: string;
}
