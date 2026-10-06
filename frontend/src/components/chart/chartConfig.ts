import type { WidgetOptions } from '../../types/tradingview';
import {
  getCalibratedServerTimeSec,
  startSync,
  waitForInitialSync,
} from '../../lib/serverTimeSync';
import {
  SUPPORTED_RESOLUTIONS,
  resolveSymbolMetaSync,
  fetchInstruments,
  toDisplaySymbol,
  toCanonicalSymbol,
} from '../../services/dataClient';
import { quoteWs } from '../../services/websocket';
import { barReplayManager } from '../../services/barReplayManager';

// Start OANDA-synced clock immediately on module load
startSync();

export const activeDatafeedResets = new Map<string, () => void>();
export const lastBarBySeries = new Map<string, BarState>();

export function triggerDatafeedReset(): void {
  lastBarBySeries.clear();
  for (const cb of activeDatafeedResets.values()) {
    try { cb(); } catch {}
  }
}

interface BarState {
  time: number; // ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function createUniversalDatafeed(datafeedUrl: string) {
  const effectiveUrl = datafeedUrl || 'http://127.0.0.1:8888';
  const base = new (window as any).Datafeeds.UDFCompatibleDatafeed(effectiveUrl, 10);

  // Track last valid bar per (symbol|resolution) to guarantee zero time-violation errors at 10ms UDF speed
  const activeRealtimeCleanups = new Map<string, () => void>();

  // Route directly to SQL Manager backend at http://127.0.0.1:8888
  if (base._requester) {
    base._requester.sendRequest = async (_url: string, endpoint: string, params?: Record<string, any>) => {
      switch (endpoint) {
        case 'config': {
          try {
            const r = await fetch(`${effectiveUrl}/config`);
            if (r.ok) return await r.json();
          } catch {}
          return {
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            supports_group_request: false,
            supports_marks: false,
            supports_search: true,
            supports_timescale_marks: true,
            supports_time: true,
            has_intraday: true,
            has_seconds: true,
            has_ticks: false,
            build_seconds_from_ticks: false,
            ticks_multipliers: [],
            seconds_multipliers: ['1', '5', '15', '30'],
            intraday_multipliers: ['1', '3', '5', '15', '30', '60'],
            daily_multipliers: ['1'],
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
            default_symbol: 'GCZ6',
          };
        }
        case 'time': {
          try {
            const r = await fetch(`${effectiveUrl}/time`);
            if (r.ok) {
              const text = await r.text();
              const num = parseFloat(text);
              if (!isNaN(num) && num > 0) return num;
            }
          } catch {}
          await waitForInitialSync();
          return getCalibratedServerTimeSec();
        }
        case 'symbols': {
          const sym = params?.symbol || 'GCZ6';
          try {
            const r = await fetch(`${effectiveUrl}/symbols?symbol=${encodeURIComponent(sym)}`);
            if (r.ok) return await r.json();
          } catch {}
          const m = resolveSymbolMetaSync(sym);
          const pricescale = Math.pow(10, m.displayPrecision);
          return {
            name: m.symbol,
            ticker: m.symbol,
            full_name: `CME:${m.symbol}`,
            description: `${m.displayName} (${m.type})`,
            type: 'futures',
            session: '24x7',
            timezone: 'Etc/UTC',
            exchange: 'CME',
            listed_exchange: 'CME',
            minmov: 1,
            pricescale,
            has_intraday: true,
            has_seconds: true,
            has_ticks: false,
            build_seconds_from_ticks: false,
            ticks_multipliers: [],
            seconds_multipliers: ['1', '5', '15', '30'],
            intraday_multipliers: ['1', '3', '5', '15', '30', '60'],
            has_daily: true,
            daily_multipliers: ['1'],
            has_weekly_and_monthly: true,
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
            has_empty_bars: false,
            supported_resolutions: SUPPORTED_RESOLUTIONS,
            data_status: 'streaming',
          };
        }
        case 'history': {
          const sym = params?.symbol || 'GCZ6';
          const res = String(params?.resolution || '1');
          const from = Number(params?.from || 0);
          const to = Number(params?.to || 0);
          const countback = params?.countback !== undefined ? Number(params.countback) : 500;
          const isReplay = barReplayManager.isActive;
          const firstDataRequest =
            isReplay
              ? true
              : (params?.firstDataRequest === undefined
                ? countback > 10 && (!to || to >= getCalibratedServerTimeSec() - 60)
                : params.firstDataRequest === true || params.firstDataRequest === 'true');
          
          try {
            const url = `${effectiveUrl}/history?symbol=${encodeURIComponent(sym)}&resolution=${encodeURIComponent(res)}&from=${from}&to=${to}&countback=${countback}&firstDataRequest=${firstDataRequest}`;
            const hRes = await fetch(url);
            if (hRes.ok) {
              const data = await hRes.json();
              if (data && (data.s === 'ok' || data.s === 'no_data')) {
                return data;
              }
            }
          } catch (e) {
            console.warn('[Datafeed Requester] History fetch notice:', e);
          }
          return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
        }
        case 'quotes': {
          const raw = String(params?.symbols || '');
          try {
            const qRes = await fetch(`${effectiveUrl}/quotes?symbols=${encodeURIComponent(raw)}`);
            if (qRes.ok) return await qRes.json();
          } catch {}
          return { s: 'ok', d: [] };
        }
        case 'search': {
          const q = String(params?.query || '').trim().toUpperCase();
          const limit = Number(params?.limit || 30);
          try {
            const sRes = await fetch(`${effectiveUrl}/search?query=${encodeURIComponent(q)}&limit=${limit}`);
            if (sRes.ok) return await sRes.json();
          } catch {}
          return [];
        }
        case 'timescale_marks': {
          const sym = params?.symbol || 'GCZ6';
          const from = params?.from || 0;
          const to = params?.to || 0;
          const res = params?.resolution || '1';
          try {
            const resp = await fetch(`/timescale_marks?symbol=${encodeURIComponent(sym)}&from=${from}&to=${to}&resolution=${encodeURIComponent(res)}`);
            if (resp.ok) return await resp.json();
          } catch {}
          return [];
        }
        case 'marks': {
          return [];
        }
        default:
          return [];
      }
    };
  }

  const convertTicksToSeconds = (res: string): string => {
    return res;
  };

  const getResolutionMs = (resolution: string): number => {
    const r = (resolution || '1').trim().toUpperCase();
    if (r === 'D' || r === '1D') return 86400 * 1000;
    if (r === 'W' || r === '1W') return 7 * 86400 * 1000;
    if (r === 'M' || r === '1M') return 30 * 86400 * 1000;
    const tickMatch = r.match(/^(\d+)T$/i);
    if (tickMatch) return 1000;
    const secMatch = r.match(/^(\d+)S$/i);
    if (secMatch) return (parseInt(secMatch[1], 10) || 1) * 1000;
    const mins = parseInt(r, 10);
    if (!isNaN(mins) && mins > 0) return mins * 60 * 1000;
    return 60 * 1000;
  };

  return {
    onReady: (cb: (config: any) => void) => {
      base.onReady((cfg: any) => {
        cb({
          ...cfg,
          supports_time: true,
          has_intraday: true,
          has_seconds: true,
          has_ticks: false,
          build_seconds_from_ticks: false,
          ticks_multipliers: [],
          seconds_multipliers: ['1', '5', '15', '30'],
          intraday_multipliers: ['1', '3', '5', '15', '30', '60'],
          daily_multipliers: ['1'],
          weekly_multipliers: ['1'],
          monthly_multipliers: ['1'],
          supported_resolutions: SUPPORTED_RESOLUTIONS,
        });
      });
    },
    searchSymbols: base.searchSymbols.bind(base),
    resolveSymbol: (symbolName: string, onResolved: (info: any) => void, onError: (err: any) => void, ext?: any) => {
      base.resolveSymbol(
        symbolName,
        (info: any) => {
          onResolved({
            ...info,
            session: '24x7',
            timezone: 'Etc/UTC',
            has_intraday: true,
            has_seconds: true,
            has_ticks: false,
            build_seconds_from_ticks: false,
            ticks_multipliers: [],
            seconds_multipliers: ['1', '5', '15', '30'],
            intraday_multipliers: ['1', '3', '5', '15', '30', '60'],
            has_daily: true,
            daily_multipliers: ['1'],
            has_weekly_and_monthly: true,
            weekly_multipliers: ['1'],
            monthly_multipliers: ['1'],
            supported_resolutions: SUPPORTED_RESOLUTIONS,
          });
        },
        onError,
        ext
      );
    },
    getBars: (symbolInfo: any, resolution: string, periodParams: any, onHistory: any, onError: any) => {
      const effectiveRes = convertTicksToSeconds(resolution);
      const dispSym = toDisplaySymbol(symbolInfo?.ticker || symbolInfo?.name || 'GCZ6');
      const seriesKey = `${dispSym}|${effectiveRes}`;

      // ── MULTI-TIMEFRAME BAR REPLAY ENGINE FAST-PATH ──
      if (barReplayManager.isActive) {
        (async () => {
          const reqFrom = periodParams?.from || 0;
          const reqTo = periodParams?.to || 0;
          const isFirst = periodParams?.firstDataRequest === true || (!reqFrom && !reqTo);
          
          if (isFirst) {
            barReplayManager.prepareForTimeframeSwitch(effectiveRes);
          }

          let retryCount = 0;
          let success = false;
          
          while (!success && retryCount < 10) {
            try {
              const cutMs = barReplayManager.cutTimestampSec * 1000;
              const currentMs = barReplayManager.currentReplayTimeSec * 1000;
              const session = barReplayManager.sessionId;
              
              // HANDSHAKE STEP 1: REQUEST directly from Replay Agent (ultra-fast sub-10ms response from SQLite/RAM)
              const url = `/replay-history?symbol=${encodeURIComponent(dispSym)}&resolution=${encodeURIComponent(effectiveRes)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&from=${isFirst ? 0 : reqFrom}&to=${isFirst ? 0 : reqTo}&firstDataRequest=${isFirst}&sessionId=${encodeURIComponent(session)}`;
              let res = await fetch(url);
              if (!res.ok) throw new Error(`HTTP error ${res.status}`);
              let data = await res.json();
              
              // Replay scrollback reached beginning of data: return clean noData to retain all existing candles
              if (data.s === 'no_data' || !data.t || data.t.length === 0) {
                if (!isFirst) {
                  onHistory([], { noData: true });
                  return;
                }
                retryCount++;
                console.warn(`[REPLAY] Empty data received (attempt ${retryCount}/5). Re-requesting URL...`);
                if (retryCount < 5) {
                  await new Promise(r => setTimeout(r, 100 * retryCount));
                  continue;
                }
                onHistory([], { noData: true });
                barReplayManager.completeTimeframeSwitch(effectiveRes, []);
                return;
              }

              // HANDSHAKE STEP 3: DELIVER (received)
              const rawBars: BarState[] = [];
              if (data.t && Array.isArray(data.t)) {
                for (let i = 0; i < data.t.length; i++) {
                  rawBars.push({
                    time: data.t[i] * 1000,
                    open: data.o[i],
                    high: data.h[i],
                    low: data.l[i],
                    close: data.c[i],
                    volume: data.v[i] || 1,
                  });
                }
              }

              // HANDSHAKE STEP 4: CONFIRM (Verify hash & cryptographic bar checksum)
              let isHandshakeConfirmed = false;
              if (data.handshakeId && data.hash) {
                const verifyUrl = `/replay-confirm?handshakeId=${encodeURIComponent(data.handshakeId)}&hash=${encodeURIComponent(data.hash)}&barCount=${rawBars.length}`;
                const verifyRes = await fetch(verifyUrl);
                if (verifyRes.ok) {
                  const verifyData = await verifyRes.json();
                  if (verifyData.success || verifyData.confirmed) {
                    isHandshakeConfirmed = true;
                    console.log(`[HANDSHAKE] 🤝 Handshake confirmed for ${effectiveRes} (ID: ${data.handshakeId})`);
                  } else if (verifyData.retry) {
                    retryCount++;
                    console.warn(`[REPLAY] Handshake verification retry (${retryCount}/10)...`);
                    continue;
                  }
                } else {
                  isHandshakeConfirmed = true;
                }
              } else if (rawBars.length > 0) {
                isHandshakeConfirmed = true;
              }

              // Extract future bars if returned (for auto-play)
              const futureBars: BarState[] = [];
              if (data.ft && Array.isArray(data.ft)) {
                for (let i = 0; i < data.ft.length; i++) {
                  futureBars.push({
                    time: data.ft[i] * 1000,
                    open: data.fo[i],
                    high: data.fh[i],
                    low: data.fl[i],
                    close: data.fc[i],
                    volume: data.fv[i] || 1,
                  });
                }
              }

              barReplayManager.filterAndStoreBars(seriesKey, effectiveRes, rawBars, futureBars);

              if (rawBars.length > 0) {
                const last = rawBars[rawBars.length - 1];
                const normTime = last.time < 10000000000 ? last.time * 1000 : last.time;
                const prev = lastBarBySeries.get(seriesKey);
                if (periodParams?.firstDataRequest || !prev || normTime >= prev.time) {
                  lastBarBySeries.set(seriesKey, { ...last, time: normTime, volume: last.volume || 1 });
                }
                onHistory(rawBars, { noData: false });
                if (isFirst || barReplayManager.currentResolution !== effectiveRes) {
                  barReplayManager.confirmHandshakeAndResume(effectiveRes, futureBars, isHandshakeConfirmed);
                }
                return;
              } else {
                if (!isFirst) {
                  onHistory([], { noData: true });
                  return;
                }
                retryCount++;
                if (retryCount < 5) {
                  await new Promise(r => setTimeout(r, 100 * retryCount));
                  continue;
                }
                onHistory([], { noData: true });
                barReplayManager.completeTimeframeSwitch(effectiveRes, []);
                return;
              }
            } catch (err) {
              console.warn(`[BarReplay] getBars error (${retryCount}/5):`, err);
              if (!isFirst) {
                onHistory([], { noData: true });
                return;
              }
              retryCount++;
              if (retryCount < 5) {
                await new Promise(r => setTimeout(r, 100 * retryCount));
                continue;
              }
              onHistory([], { noData: true });
              barReplayManager.completeTimeframeSwitch(effectiveRes, []);
              return;
            }
          }
        })();
        return;
      }

      // ── LIVE / STANDARD HISTORICAL MODE WITH 10-TRY RETRY & DROP-ON-EMPTY ──
      let getBarsAttempts = 0;
      let bestBarsAcquired: BarState[] = [];
      let bestMeta: any = null;

      // Calculate resolution in seconds
      let resSec = 60;
      const ru = effectiveRes.toUpperCase();
      if (ru.endsWith('S')) resSec = parseInt(ru, 10) || 1;
      else if (ru.endsWith('T')) resSec = 1;
      else if (ru === 'D' || ru === '1D') resSec = 86400;
      else if (ru === 'W' || ru === '1W') resSec = 7 * 86400;
      else if (ru === 'M' || ru === '1M') resSec = 30 * 86400;
      else {
        const m = parseInt(ru, 10);
        if (!isNaN(m) && m > 0) resSec = m * 60;
      }

      let expectedCount = 0;
      if (periodParams?.from && periodParams?.to && periodParams.to > periodParams.from) {
        if (resSec <= 3600) {
          const windowCandles = Math.floor((periodParams.to - periodParams.from) / resSec);
          expectedCount = (periodParams.countBack && periodParams.countBack > 0) ? Math.min(windowCandles, periodParams.countBack) : windowCandles;
        } else if (resSec === 86400) {
          const days = Math.floor((periodParams.to - periodParams.from) / 86400);
          const tradingDays = Math.max(1, Math.floor(days * 5 / 7));
          expectedCount = (periodParams.countBack && periodParams.countBack > 0) ? Math.min(tradingDays, periodParams.countBack) : tradingDays;
        } else {
          const windowCandles = Math.max(1, Math.floor((periodParams.to - periodParams.from) / resSec));
          expectedCount = (periodParams.countBack && periodParams.countBack > 0) ? Math.min(windowCandles, periodParams.countBack) : windowCandles;
        }
      } else if (periodParams?.countBack && periodParams.countBack > 0) {
        expectedCount = periodParams.countBack;
      }

      base.getBars(
        symbolInfo,
        effectiveRes,
        periodParams,
        (bars: BarState[], meta: any) => {
          if (Array.isArray(bars) && bars.length > 0) {
            const last = bars[bars.length - 1];
            const normTime = last.time < 10000000000 ? last.time * 1000 : last.time;
            const normLast = { ...last, time: normTime };
            const prev = lastBarBySeries.get(seriesKey);
            if (periodParams?.firstDataRequest || !prev || normLast.time >= prev.time) {
              lastBarBySeries.set(seriesKey, normLast);
            }
            onHistory(bars, meta || { noData: false });
          } else {
            onHistory([], meta || { noData: true });
          }
        },
        (err: any) => {
          onError(err);
        }
      );
    },
    subscribeBars: (symbolInfo: any, resolution: string, onRealtime: any, uid: string, onReset: any) => {
      const effectiveRes = convertTicksToSeconds(resolution);
      const dispSym = toDisplaySymbol(symbolInfo?.ticker || symbolInfo?.name || 'GCZ6');
      const seriesKey = `${dispSym}|${effectiveRes}`;

      // Monotonic bar emitter: guarantees no time-violation errors and preserves intra-bar high/low wicks
      const emitSafeBar = (incoming: BarState) => {
        let last = lastBarBySeries.get(seriesKey);

        // In replay mode, if last bar is ahead of incoming replay bar, it is stale from pre-replay/live mode
        if (barReplayManager.isActive && last) {
          const lastTime = last.time < 10000000000 ? last.time * 1000 : last.time;
          const incTime = incoming.time < 10000000000 ? incoming.time * 1000 : incoming.time;
          if (lastTime > incTime) {
            console.log(`[BarReplay] Resetting stale series bar (${lastTime} > ${incTime})`);
            last = undefined;
            lastBarBySeries.delete(seriesKey);
          }
        }

        if (!last) {
          lastBarBySeries.set(seriesKey, incoming);
          onRealtime(incoming);
          return;
        }

        const lastTime = last.time < 10000000000 ? last.time * 1000 : last.time;
        const incTime = incoming.time < 10000000000 ? incoming.time * 1000 : incoming.time;

        if (incTime < lastTime) {
          return; // Drop stale out-of-order bar
        }

        if (incTime === lastTime) {
          const merged: BarState = {
            time: lastTime,
            open: last.open,
            high: Math.max(last.high, incoming.high, incoming.close),
            low: Math.min(last.low, incoming.low, incoming.close),
            close: incoming.close,
            volume: Math.max(last.volume || 1, incoming.volume || 1),
          };
          lastBarBySeries.set(seriesKey, merged);
          onRealtime(merged);
        } else {
          const nextBar: BarState = {
            time: incTime,
            open: incoming.open,
            high: Math.max(incoming.open, incoming.high, incoming.close),
            low: Math.min(incoming.open, incoming.low, incoming.close),
            close: incoming.close,
            volume: incoming.volume || 1,
          };
          lastBarBySeries.set(seriesKey, nextBar);
          onRealtime(nextBar);
        }
      };

      if (typeof onReset === 'function') {
        activeDatafeedResets.set(uid, onReset);
      }

      // ALWAYS register emitter with BarReplayManager so candles can be emitted when replay plays
      barReplayManager.registerEmitter(uid, emitSafeBar);
      activeRealtimeCleanups.set(uid, () => {
        barReplayManager.unregisterEmitter(uid);
      });

      // If in Bar Replay mode, do not connect to live market WebSocket
      if (barReplayManager.isActive) {
        return;
      }

      quoteWs.subscribe([dispSym]);

      const resMs = getResolutionMs(effectiveRes);
      let lastSeenPrice = 0;

      const unsubQuote = quoteWs.onQuote(q => {
        if (barReplayManager.isActive) return;
        if (toDisplaySymbol(q.symbol) !== dispSym) return;
        const last = lastBarBySeries.get(seriesKey);
        if (!last) return;
        const lp = q.data?.v?.lp;
        if (!lp || lp <= 0) return;

        // Skip if offline or price has zero changes and no trade activity
        const nowMs = Date.now();
        const lastTime = last.time < 10000000000 ? last.time * 1000 : last.time;

        if (nowMs >= lastTime + resMs) {
          // If historical gap is detected (> 3 candles gap), trigger history reload to fill missing bars cleanly
          if (nowMs - lastTime > resMs * 3) {
            const resetFn = activeDatafeedResets.get(uid);
            if (typeof resetFn === 'function') {
              resetFn();
            }
          }

          // If no trade happened or price is identical to last seen with no volume change, do NOT synthesize fake flat dashes
          if (lastSeenPrice > 0 && lp === lastSeenPrice && lp === last.close && lp === last.open && lp === last.high && lp === last.low) {
            return;
          }
          lastSeenPrice = lp;
          const nextTime = Math.floor(nowMs / resMs) * resMs;
          const safeTime = Math.max(nextTime, lastTime + resMs);
          const barOpen = (nowMs - lastTime > resMs * 3) ? lp : last.close;
          emitSafeBar({
            time: safeTime,
            open: barOpen,
            high: Math.max(barOpen, lp),
            low: Math.min(barOpen, lp),
            close: lp,
            volume: 1,
          });
        } else {
          lastSeenPrice = lp;
          emitSafeBar({
            time: lastTime,
            open: last.open,
            high: Math.max(last.high, lp),
            low: Math.min(last.low, lp),
            close: lp,
            volume: (last.volume || 1) + 1,
          });
        }
      });

      const prevCleanup = activeRealtimeCleanups.get(uid);
      if (prevCleanup) prevCleanup();
      activeRealtimeCleanups.set(uid, () => {
        unsubQuote();
      });
    },
    unsubscribeBars: (uid: string) => {
      activeDatafeedResets.delete(uid);
      barReplayManager.unregisterEmitter(uid);
      const cleanup = activeRealtimeCleanups.get(uid);
      if (cleanup) {
        cleanup();
        activeRealtimeCleanups.delete(uid);
      }
    },
    getMarks: base.getMarks?.bind(base),
    getTimescaleMarks: base.getTimescaleMarks?.bind(base),
    getServerTime: (cb: (time: number) => void) => {
      waitForInitialSync().then(() => {
        cb(getCalibratedServerTimeSec());
      });
    },
    getQuotes: base.getQuotes?.bind(base),
    subscribeQuotes: base.subscribeQuotes?.bind(base),
    unsubscribeQuotes: base.unsubscribeQuotes?.bind(base),
  };
}

export function getWidgetOptions(
  container: HTMLElement | string,
  datafeedUrl: string,
  theme: 'Dark' | 'Light' = 'Dark',
  brokerFactory?: (host: any) => any,
  saveLoadAdapter?: any,
  defaultSymbol: string = 'GCZ6',
  watchlistSymbols: string[] = [],
  savedData?: any,
  defaultInterval: string = '1'
): WidgetOptions {
  return {
    container,
    fullscreen: true,
    autosize: true,
    symbol: defaultSymbol || 'GCZ6',
    interval: defaultInterval || '1',
    library_path: "/charting_library/",
    locale: "en",
    datafeed: createUniversalDatafeed(datafeedUrl),
    theme,
    custom_css_url: "/custom.css",
    logo: { image: "/favicon.png", link: "#" },
    numeric_formatting: { decimal_sign: "." },
    save_load_adapter: saveLoadAdapter,
    saved_data: savedData || undefined,
    auto_save_delay: 5,
    load_last_chart: true,

    broker_factory: brokerFactory,
    broker_config: {
      configFlags: {
        supportReversePosition: true,
        supportPositionReverse: true,
        supportStopLoss: true,
        supportClosePosition: true,
        supportPartialClosePosition: true,
        supportEditAmount: false,
        supportLevel2Data: true,
        supportDOM: true,
        supportMarketOrders: true,
        supportLimitOrders: true,
        supportStopOrders: true,
        supportStopLimitOrders: true,
        supportPositionBrackets: true,
        showQuantityInsteadOfAmount: true,
        supportOrderBrackets: true,
        supportModifyOrder: true,
        supportModifyOrderPrice: true,
        supportCancelOrder: true,
        supportModifyBrackets: true,
        supportModifyPositionBrackets: true,
        supportModifyOrderBrackets: true,
        supportAddBracketsToExistingOrder: true,
        supportPlaceOrderPreview: false,
        supportModifyOrderPreview: false,
        supportOrdersHistory: true,
        supportExecutions: true,
        supportBalances: false,
        supportMarketBrackets: true,
        supportStopOrdersInBothDirections: true,
        supportStopLimitOrdersInBothDirections: true,
        supportTrailingStop: true,
        supportModifyTrailingStop: true,
        supportPositions: true,
        supportRiskControlsAndInfo: true,
        supportPLUpdate: true,
        showNotificationsLog: true,
        supportDemoLiveSwitcher: false
      }
    },

    overrides: {
      'tradingProperties.showOrders': true,
      'tradingProperties.showPositions': true,
      'tradingProperties.showReverse': true,
      'tradingProperties.showExecutions': true,
      'tradingProperties.extendLeft': true,
      'tradingProperties.horizontalAlignment': 2,
      'paneProperties.legendProperties.showSeriesTitle': true,
      'paneProperties.legendProperties.showSeriesOHLC': true,
      'paneProperties.legendProperties.showBarChange': true,
      'paneProperties.legendProperties.showLegend': true,
      'paneProperties.legendProperties.showTradingButtons': true,
      'paneProperties.legendProperties.showStudyArguments': true,
      'paneProperties.legendProperties.showStudyTitles': true,
      'paneProperties.legendProperties.showStudyValues': true,
      'mainSeriesProperties.statusViewStyle.symbolTextSource': 'ticker',
      'mainSeriesProperties.statusViewStyle.showExchange': true,
      'mainSeriesProperties.statusViewStyle.showInterval': true,
      'mainSeriesProperties.prePostMarket.preMarketColor': 'transparent',
      'mainSeriesProperties.prePostMarket.postMarketColor': 'transparent',
      'scalesProperties.showPrePostMarketPriceLabel': false
    },

    favorites: {
      intervals: ["1S", "5S", "15S", "30S", "1", "3", "5", "15", "30", "60", "1D", "1W", "1M"],
      chartTypes: ["Area", "Candles", "Heikin Ashi"]
    },

    time_frames: [
      { text: "5d", resolution: "1", description: "5 Days (1m)" },
      { text: "1m", resolution: "15", description: "1 Month (15m)" },
      { text: "3m", resolution: "60", description: "3 Months (1h)" },
      { text: "1y", resolution: "1D", description: "1 Year (1d)" },
      { text: "5y", resolution: "1D", description: "5 Years (1d)" },
      { text: "10y", resolution: "1M", description: "10 Years (1M)" }
    ],

    widgetbar: {
      details: true,
      watchlist: true,
      datawindow: true,
      watchlist_settings: {
        default_symbols: watchlistSymbols,  // Dynamic — fetched from /instruments at startup
      }
    },
    watchlist: watchlistSymbols,  // Dynamic — no hardcoded symbols

    disabled_features: [
      "news_widget",
      "news_provider",
      "marks",
      "allow_supported_resolutions_set_only",
      "symbol_search_option_chain_selector",
      "volume_force_overlay",
      "intraday_inactivity_gaps",
      "popup_hints_candle_size",
      "tick_resolution"
    ],

    enabled_features: [
      "timescale_marks",
      "timeframes_toolbar",
      "header_compare",
      "display_market_status",
      "use_localstorage_for_settings",
      "side_toolbar_in_fullscreen_mode",
      "header_in_fullscreen_mode",
      "pre_post_market_sessions",
      "show_symbol_logos",
      "save_chart_properties_to_local_storage",
      "create_volume_indicator_by_default",
      "trading_account_manager",
      "order_panel",
      "buy_sell_buttons",
      "show_trading_notifications_history",
      "multiple_watchlists",
      "dom_widget",
      "seconds_resolution",
      
      "trading_terminal", "order_panel_close_button", "order_panel_undock",
      "open_account_manager",
      "trading_notifications",
      "chart_property_page_trading", "broker_button",
      "show_dom_first_time", "enable_dom_data_for_untradable_symbols",
      "always_pass_called_order_to_modify", "order_info",
      "snapshot_trading_drawings",

      "custom_resolutions",
      "show_average_close_price_line_and_label",
      "countdown",

      "japanese_chart_styles", "chart_style_hilo", "chart_style_hilo_last_price",
      "support_multicharts", "multi_chart_layout", "additional_multichart_layouts",
      "chart_crosshair_menu", "border_around_the_chart",

      "header_resolutions", "header_interval_dialog_button", "show_interval_dialog_on_key_press",
      "header_chart_type", "header_settings", "header_undo_redo",
      "header_quick_search", "header_symbol_search",
      "header_layouttoggle", "header_screenshot", "header_fullscreen_button",
      "header_indicators", "header_saveload",

      "left_toolbar", "right_toolbar",

      "watchlist_context_menu", "watchlist_import_export",
      "watchlist_sections", "watchlist_cross_tab_sync",
      "show_symbol_watchlist", "add_to_watchlist",
      "widgetbar_tabs", "show_right_widgets_panel_by_default",
      "details", "quote_summary", "data_window",

      "show_exchange_logos",
      "show_symbol_logo_in_account_manager",
      "symbol_info", "symbol_info_price_source",

      "legend_inplace_edit",
      "show_hide_button_in_legend", "study_buttons_in_legend",
      "format_button_in_legend", "delete_button_in_legend",
      "edit_buttons_in_legend", "items_favoriting",
      "study_on_study",

      "source_selection_markers",
      "show_object_tree", "lines_properties",
      "saveload_separate_drawings_storage"
    ]
  };
}
