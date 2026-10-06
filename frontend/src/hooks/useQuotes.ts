import { useEffect, useState, useRef } from 'react';
import type { LiveQuote } from '../types/quote';
import { quoteWs } from '../services/websocket';
import { api } from '../services/api';

export function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const symbolsRef = useRef(symbols);

  useEffect(() => {
    symbolsRef.current = symbols;
  }, [symbols]);

  useEffect(() => {
    if (symbols.length === 0) return;

    quoteWs.subscribe(symbols);

    const unsubQuote = quoteWs.onQuote((quote) => {
      setQuotes(prev => ({
        ...prev,
        [quote.symbol]: quote
      }));
    });

    const unsubConnect = quoteWs.onConnect(() => {
      // Fetch initial snapshot or missing quotes
      api.getQuotes(symbols).then(res => {
        if (res && res.d) {
          const newQuotes: Record<string, LiveQuote> = {};
          res.d.forEach((q: any) => {
            newQuotes[q.s] = {
              type: 'quote',
              symbol: q.s,
              data: q,
              time_msc: Date.now(),
              time_utc_msc: Date.now()
            };
          });
          setQuotes(prev => ({ ...prev, ...newQuotes }));
        }
      }).catch(console.error);
    });

    return () => {
      quoteWs.unsubscribe(symbols);
      unsubQuote();
      unsubConnect();
    };
  }, [symbols.join(',')]); // re-run only when symbols list changes

  return quotes;
}
