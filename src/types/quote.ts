export interface LiveQuote {
  type: 'quote';
  symbol: string;
  data: {
    s: string;
    n: string;
    v: {
      lp: number;
      bid: number;
      ask: number;
      spread: number;
      ch: number;
      chp: number;
      open_price: number;
      high_price: number;
      low_price: number;
      prev_close_price: number;
      volume: number;
    };
  };
  time_msc: number;
  time_utc_msc: number;
}

export interface WsSubscribeMessage {
  action: 'subscribe' | 'unsubscribe';
  symbols: string[];
}
