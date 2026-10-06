export const SUPPORTED_RESOLUTIONS = [
  '1S', '5S', '15S', '30S',
  '1', '3', '5', '15', '30',
  '60',
  '1D', '1W', '1M',
];

export const DEFAULT_WATCHLIST_NAME = 'POPULAR';
export const DEFAULT_WATCHLIST = [
  'GCZ6',
  'SIZ6',
  'NQZ6',
  'ESZ6',
  'GC1!',
  'SI1!',
  'NQ1!',
  'ES1!'
];

export interface InstrumentMeta {
  name: string;
  symbol: string;
  displayName: string;
  type: string;
  displayPrecision: number;
  tickSize: number;
  contractSize: number;
}

export const KNOWN_CONTRACTS: Record<string, InstrumentMeta> = {
  ESZ6: {
    name: 'ESZ6',
    symbol: 'ESZ6',
    displayName: 'E-Mini S&P 500 (Dec 2026)',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 50,
  },
  MESZ6: {
    name: 'MESZ6',
    symbol: 'MESZ6',
    displayName: 'Micro E-Mini S&P 500 (Dec 2026)',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 5,
  },
  NQZ6: {
    name: 'NQZ6',
    symbol: 'NQZ6',
    displayName: 'E-Mini Nasdaq-100 (Dec 2026)',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 20,
  },
  MNQZ6: {
    name: 'MNQZ6',
    symbol: 'MNQZ6',
    displayName: 'Micro E-Mini Nasdaq-100 (Dec 2026)',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 2,
  },
  GCZ6: {
    name: 'GCZ6',
    symbol: 'GCZ6',
    displayName: 'Gold Futures (Dec 2026)',
    type: 'futures',
    displayPrecision: 1,
    tickSize: 0.1,
    contractSize: 100,
  },
  MGCZ6: {
    name: 'MGCZ6',
    symbol: 'MGCZ6',
    displayName: 'Micro Gold (Dec 2026)',
    type: 'futures',
    displayPrecision: 1,
    tickSize: 0.1,
    contractSize: 10,
  },
  SIZ6: {
    name: 'SIZ6',
    symbol: 'SIZ6',
    displayName: 'Silver Futures (Dec 2026)',
    type: 'futures',
    displayPrecision: 3,
    tickSize: 0.005,
    contractSize: 5000,
  },
  SILZ6: {
    name: 'SILZ6',
    symbol: 'SILZ6',
    displayName: 'Micro Silver (Dec 2026)',
    type: 'futures',
    displayPrecision: 3,
    tickSize: 0.001,
    contractSize: 1000,
  },
  'GC1!': {
    name: 'GC1!',
    symbol: 'GC1!',
    displayName: 'Gold Continuous Contract',
    type: 'futures',
    displayPrecision: 1,
    tickSize: 0.1,
    contractSize: 100,
  },
  'SI1!': {
    name: 'SI1!',
    symbol: 'SI1!',
    displayName: 'Silver Continuous Contract',
    type: 'futures',
    displayPrecision: 3,
    tickSize: 0.005,
    contractSize: 5000,
  },
  'NQ1!': {
    name: 'NQ1!',
    symbol: 'NQ1!',
    displayName: 'Nasdaq-100 Continuous Contract',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 20,
  },
  'ES1!': {
    name: 'ES1!',
    symbol: 'ES1!',
    displayName: 'S&P 500 Continuous Contract',
    type: 'futures',
    displayPrecision: 2,
    tickSize: 0.25,
    contractSize: 50,
  },
};

export function toDisplaySymbol(symbol: string): string {
  const clean = String(symbol || 'GCZ6').trim().toUpperCase().replace(/^CME:/i, '').replace(/^TRADOVATE:/i, '');
  if (clean === '@GC') return 'GC1!';
  if (clean === '@SI') return 'SI1!';
  if (clean === '@NQ') return 'NQ1!';
  if (clean === '@ES') return 'ES1!';
  return clean;
}

export function toCanonicalSymbol(symbol: string): string {
  return toDisplaySymbol(symbol);
}

export function resolveSymbolMetaSync(symbol: string): InstrumentMeta {
  const clean = toCanonicalSymbol(symbol);
  if (KNOWN_CONTRACTS[clean]) {
    return KNOWN_CONTRACTS[clean];
  }
  let dp = 2;
  let tick = 0.01;
  if (clean.startsWith('GC')) { dp = 1; tick = 0.1; }
  else if (clean.startsWith('SI')) { dp = 3; tick = 0.005; }
  else if (clean.startsWith('ES') || clean.startsWith('NQ')) { dp = 2; tick = 0.25; }

  return {
    name: clean,
    symbol: clean,
    displayName: `${clean} Futures`,
    type: 'futures',
    displayPrecision: dp,
    tickSize: tick,
    contractSize: 1,
  };
}

export async function fetchInstruments(): Promise<InstrumentMeta[]> {
  try {
    const res = await fetch('/search?limit=100');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          name: item.symbol || item.name,
          symbol: item.symbol || item.name,
          displayName: item.description || item.name,
          type: item.type || 'futures',
          displayPrecision: resolveSymbolMetaSync(item.symbol).displayPrecision,
          tickSize: resolveSymbolMetaSync(item.symbol).tickSize,
          contractSize: 1,
        }));
      }
    }
  } catch {}
  return Object.values(KNOWN_CONTRACTS);
}

export const latestQuoteMap = new Map<string, { lp: number; bid: number; ask: number; timeMs: number }>();

export async function fetchQuotes(symbols: string[]): Promise<any[]> {
  try {
    const res = await fetch(`/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (res.ok) {
      const json = await res.json();
      if (json && Array.isArray(json.d)) {
        return json.d;
      }
    }
  } catch {}
  return [];
}

export function clearHistoryCache(): void {
  // no-op for pure SQL
}
