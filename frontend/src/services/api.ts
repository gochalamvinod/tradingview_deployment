import type { UdfConfig, SymbolInfo, HistoryBars, QuoteData, SearchResult } from '../types/udf';
import type { 
  MarketOrderRequest, PendingOrderRequest, ModifyOrderRequest, 
  CloseOrderRequest, TradeResponse, Position, Order, AccountInfo 
} from '../types/trade';

export class TradingApi {
  async getConfig(): Promise<UdfConfig> {
    const res = await fetch('/config');
    return res.json();
  }

  async getTime(format: 'json' | 'int' = 'int'): Promise<number> {
    const res = await fetch(`/time?format=${format}`);
    return res.json();
  }

  async getSymbol(symbol: string): Promise<SymbolInfo> {
    const res = await fetch(`/symbols?symbol=${encodeURIComponent(symbol)}`);
    return res.json();
  }

  async getHistory(symbol: string, resolution: string, from: number, to: number, countback?: number): Promise<HistoryBars> {
    let url = `/history?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${to}`;
    if (countback !== undefined) url += `&countback=${countback}`;
    const res = await fetch(url);
    return res.json();
  }

  async getQuotes(symbols: string[]): Promise<{s: string, d: QuoteData[]}> {
    const res = await fetch(`/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
    return res.json();
  }

  async search(query: string, type?: string, exchange?: string, limit?: number): Promise<SearchResult[]> {
    let url = `/search?query=${encodeURIComponent(query)}`;
    if (type) url += `&type=${encodeURIComponent(type)}`;
    if (exchange) url += `&exchange=${encodeURIComponent(exchange)}`;
    if (limit) url += `&limit=${limit}`;
    const res = await fetch(url);
    return res.json();
  }

  async placeOrder(req: MarketOrderRequest): Promise<TradeResponse> {
    const res = await fetch('/trade/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return res.json();
  }

  async placePending(req: PendingOrderRequest): Promise<TradeResponse> {
    const res = await fetch('/trade/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return res.json();
  }

  async modifyOrder(req: ModifyOrderRequest): Promise<TradeResponse> {
    const res = await fetch('/trade/modify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return res.json();
  }

  async closePosition(req: CloseOrderRequest): Promise<TradeResponse> {
    const res = await fetch('/trade/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req)
    });
    return res.json();
  }

  async getPositions(): Promise<Position[]> {
    const res = await fetch('/trade/positions');
    return res.json();
  }

  async getOrders(): Promise<Order[]> {
    const res = await fetch('/trade/orders');
    return res.json();
  }

  async getAccount(): Promise<AccountInfo> {
    const res = await fetch('/trade/account');
    return res.json();
  }

  async getTradeHistory(days?: number): Promise<{deals: any[], orders: any[]}> {
    const res = await fetch(`/trade/history${days ? `?days=${days}` : ''}`);
    return res.json();
  }



  /**
   * Fetch ALL tradable instruments from the server.
   * The server discovers these dynamically from the broker (OANDA) at startup.
   * No hardcoded symbol lists — everything is dynamic.
   */
  async getInstruments(): Promise<{
    instruments: Array<{
      symbol: string;
      oanda_name: string;
      type: string;
      display_name: string;
      pip: number;
      display_precision: number;
      min_trade_size: string;
      max_trade_size: string;
    }>;
  }> {
    const res = await fetch('/instruments');
    return res.json();
  }

  /**
   * Fetch server config including dynamically-resolved default symbol.
   * The server picks the default based on what's available from the broker.
   */
  async getServerConfig(): Promise<UdfConfig & { default_symbol?: string }> {
    const res = await fetch('/config');
    return res.json();
  }
}

export const api = new TradingApi();
