export interface MarketOrderRequest {
  symbol: string;
  action?: string;
  side?: string;
  order_type?: string;
  volume: number;
  price?: number;
  sl?: number;
  tp?: number;
  deviation?: number;
  comment?: string;
  magic?: number;
}

export interface PendingOrderRequest {
  symbol: string;
  type?: string;
  order_type?: string;
  price: number;
  stoplimit?: number;
  volume: number;
  sl?: number;
  tp?: number;
}

export interface ModifyOrderRequest {
  ticket: number | string;
  sl?: number;
  tp?: number;
  price?: number;
  symbol?: string;
}

export interface CloseOrderRequest {
  ticket: number | string;
  volume?: number;
  price?: number;
  deviation?: number;
}

export interface TradeResponse {
  success: boolean;
  retcode: number;
  retcode_name: string;
  retcode_description: string;
  order: number;
  ticket: number;
  deal: number;
  volume: number;
  price: number;
  comment: string;
  symbol: string;
  action: string;
  error?: string;
}

export interface Position {
  ticket: number;
  time: number;
  time_msc: number;
  symbol: string;
  type: number;
  type_name: string;
  volume: number;
  price_open: number;
  price_current: number;
  sl: number;
  tp: number;
  profit: number;
  swap: number;
  commission: number;
  comment: string;
  magic: number;
}

export interface Order {
  ticket: number;
  time_setup: number;
  symbol: string;
  type: number;
  type_name: string;
  volume_initial: number;
  volume_current: number;
  price_open: number;
  sl: number;
  tp: number;
  state: string;
  comment: string;
}

export interface AccountInfo {
  login: number;
  name: string;
  server: string;
  currency: string;
  balance: number;
  equity: number;
  profit: number;
  margin: number;
  margin_free: number;
  margin_level: number;
  leverage: number;
}
