import { useEffect, useRef, useState, useCallback } from 'react';
import { getWidgetOptions, triggerDatafeedReset } from './chartConfig';
import { DEFAULT_WATCHLIST, fetchInstruments } from '../../services/dataClient';
import { bindTradingViewClock } from '../../lib/serverTimeSync';
import {
  LocalStorageSaveLoadAdapter,
  getSavedChartState,
  saveActiveChartState,
} from '../../lib/saveLoadAdapter';
import { barReplayManager } from '../../services/barReplayManager';
import { quoteWs } from '../../services/websocket';

export function useChartWidget(
  containerId: string,
  datafeedUrl: string,
  theme: 'Dark' | 'Light',
  brokerFactory?: any,
  saveLoadAdapter?: any
) {
  const widgetRef = useRef<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const container = document.getElementById(containerId);
    if (!container) return;

    if (!window.TradingView || !window.TradingView.widget) {
      console.error('TradingView library is not loaded globally.');
      return;
    }

    // Clear legacy mock, obsolete watchlist entries, or corrupted chart states from localStorage
    try {
      const keysToClean: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('tradingview.savedwatch.') || key.includes('watchlist') || key.includes('Watchlist'))) {
          keysToClean.push(key);
        }
      }
      for (const k of keysToClean) {
        localStorage.removeItem(k);
      }

      // Check if saved chart state is corrupt (e.g. invalid groups or schema mismatch)
      const rawState = localStorage.getItem('tv_active_chart_state');
      if (rawState) {
        try {
          const parsed = JSON.parse(rawState);
          if (!parsed || !Array.isArray(parsed.charts) || parsed.charts.length === 0) {
            localStorage.removeItem('tv_active_chart_state');
            localStorage.removeItem('tv_chart_content_default_chart');
          }
        } catch {
          localStorage.removeItem('tv_active_chart_state');
          localStorage.removeItem('tv_chart_content_default_chart');
        }
      }
    } catch {}

    // Pre-warm full Tradovate instruments catalog in background without blocking 0ms widget boot
    fetchInstruments().catch(() => {});

    // ── Auto-save helpers ──
    let saveTimeout: ReturnType<typeof setTimeout> | null = null;

    const persistCurrentChartMetadata = () => {
      try {
        if (widgetRef.current) {
          const chart = widgetRef.current.activeChart?.();
          if (chart) {
            const s = chart.symbol?.();
            if (s) localStorage.setItem('tv_last_symbol', s);
            const r = chart.resolution?.();
            if (r) localStorage.setItem('tv_last_interval', r);
            const ct = chart.chartType?.();
            if (ct !== null && ct !== undefined) localStorage.setItem('tv_last_chart_type', String(ct));
          }
        }
      } catch {}
    };

    const triggerSave = () => {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        try {
          persistCurrentChartMetadata();
          if (widgetRef.current && typeof widgetRef.current.save === 'function') {
            widgetRef.current.save((state: any) => {
              if (state) saveActiveChartState(state);
            });
          }
        } catch (e) {
          console.warn('Auto-save failed', e);
        }
      }, 1000);
    };

    const triggerSaveSync = () => {
      try {
        persistCurrentChartMetadata();
        if (widgetRef.current && typeof widgetRef.current.save === 'function') {
          widgetRef.current.save((state: any) => {
            if (state) saveActiveChartState(state);
          });
        }
      } catch {}
    };

    // ── Auto-save on visibility change / window unload (NO chart.resetData calls) ──
    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerSaveSync();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', triggerSaveSync);

    const adapter = saveLoadAdapter || new LocalStorageSaveLoadAdapter();
    const savedChartData = getSavedChartState();
    const savedSymbol = localStorage.getItem('tv_last_symbol') || 'GCZ6';
    const savedInterval = localStorage.getItem('tv_last_interval') || '1';

    const options = getWidgetOptions(
      containerId,
      datafeedUrl,
      theme,
      brokerFactory,
      adapter,
      savedSymbol,
      DEFAULT_WATCHLIST,
      savedChartData,
      savedInterval
    );

    const widget = new window.TradingView.widget(options);
    widgetRef.current = widget;
    (window as any).tvWidget = widget;
    bindTradingViewClock(containerId);

    widget.onChartReady(() => {
      if (!cancelled) {
        (window as any).tvWidget = widget;
        bindTradingViewClock(containerId);

        const stripLogoWatermark = () => {
          try {
            const chartObj = (widget as any).activeChart?.();
            const model = chartObj?._chartWidget?.model?.()?.model?.() || chartObj?._chartWidget?._model?.m_model;
            const sources = model?._dataSources || model?.dataSources?.() || [];
            for (const src of sources) {
              if (src && ('_tradingviewLogoLinkToPath' in src || '_customLogoSrc' in src || '_showBranding' in src)) {
                src.paneViews = () => [];
                model?.updateSource?.(src);
              }
            }
          } catch {}
        };
        stripLogoWatermark();
        setTimeout(stripLogoWatermark, 500);


        // Auto-save triggers on any user chart interaction or drawing
        try {
          widget.subscribe('onAutoSaveNeeded', triggerSave);
        } catch {}

        try {
          const chart = widget.activeChart();
          chart.onIntervalChanged?.().subscribe(null, (interval: string) => {
            try { localStorage.setItem('tv_last_interval', interval); } catch {}
            if (barReplayManager.isActive) {
              barReplayManager.prepareForTimeframeSwitch(interval);
              triggerDatafeedReset();
            }
            triggerSave();
          });
          chart.onSymbolResolved?.().subscribe(null, (symInfo: any) => {
            try {
              const s = symInfo?.ticker || symInfo?.name;
              if (s) localStorage.setItem('tv_last_symbol', s);
            } catch {}
            triggerSave();
          });
          (chart as any).onSymbolChanged?.().subscribe(null, (sym: any) => {
            try {
              if (typeof sym === 'string') localStorage.setItem('tv_last_symbol', sym);
            } catch {}
            triggerSave();
          });
        } catch {}

        // Connect to TradingView's WatchList API for instant bidirectional symbol synchronization
        if (typeof (widget as any).watchList === 'function') {
          (widget as any).watchList().then(async (wl: any) => {
            if (!wl) return;

            // 1. Fetch current synchronized watchlist from backend
            let syncedSymbols: string[] = ['GCZ6', 'SIZ6', 'NQZ6', 'ESZ6', 'GC1!', 'SI1!', 'NQ1!', 'ES1!'];
            try {
              const res = await fetch('/api/watchlist');
              if (res.ok) {
                const data = await res.json();
                const list = data.watchlists?.[data.defaultWatchlist || 'POPULAR'];
                if (Array.isArray(list) && list.length > 0) {
                  syncedSymbols = list;
                }
              }
            } catch {}

            // 2. Set the TradingView widget's active watchlist to the backend synced symbols
            try {
              wl.setList(syncedSymbols);
            } catch (e) {
              console.warn('[Watchlist UI] setList error:', e);
            }

            let currentWatchlistSymbols: string[] = [...syncedSymbols];

            // 3. Listen to realtime additions and removals from the TradingView Watchlist UI
            wl.onListChanged?.().subscribe(null, () => {
              try {
                const list = wl.getList();
                const newSymbols: string[] = Array.isArray(list) ? list : [];
                if (newSymbols.length === 0) return;

                const added = newSymbols.filter(s => !currentWatchlistSymbols.includes(s));
                const removed = currentWatchlistSymbols.filter(s => !newSymbols.includes(s));
                if (added.length === 0 && removed.length === 0) return;

                currentWatchlistSymbols = [...newSymbols];

                // Realtime Sync ADD to backend server
                for (const sym of added) {
                  console.log(`[Watchlist UI Realtime Sync] Symbol ADDED: ${sym}`);
                  fetch('/api/watchlist/add', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: sym })
                  }).catch(e => console.warn('[Watchlist UI] Add failed:', e));
                }

                // Realtime Sync REMOVE to backend server
                for (const sym of removed) {
                  console.log(`[Watchlist UI Realtime Sync] Symbol REMOVED: ${sym}`);
                  fetch('/api/watchlist/remove', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: sym })
                  }).catch(e => console.warn('[Watchlist UI] Remove failed:', e));
                }
              } catch (e) {
                console.warn('[Watchlist UI] Sync error:', e);
              }
            });
          }).catch(() => {});
        }

        // Header button for Bar Replay & B-ADJ (CME Rollover Back-Adjustment)
        if (typeof (widget as any).headerReady === 'function') {
          (widget as any).headerReady().then(() => {
            try {
              const replayBtn = (widget as any).createButton();
              replayBtn.setAttribute('title', 'Bar Replay / Crop (Multi-Timeframe)');
              replayBtn.innerHTML = `
                <div style="display:inline-flex; align-items:center; gap:5px; padding:2px 8px; cursor:pointer;">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="20" height="20">
                    <path fill="none" stroke="currentColor" stroke-width="1.8" d="M13.5 20V9l-6 5.5 6 5.5zM21.5 20V9l-6 5.5 6 5.5z"></path>
                  </svg>
                  <span style="font-size:13px; font-weight:500;">Replay</span>
                </div>
              `;
              replayBtn.addEventListener('click', () => {
                requestBarSelection();
              });

              // B-ADJ (Back-Adjusted) Button
              const adjBtn = (widget as any).createButton();
              adjBtn.setAttribute('title', 'Adjust for contract rollover changes (Back-Adjusted continuous futures)');
              
              const updateAdjBtnState = () => {
                const chart = widget.activeChart?.();
                const curSym = String(chart?.symbol?.() || '').toUpperCase();
                const isCont = curSym.includes('1!') || curSym.startsWith('@') || curSym.includes('ADJ');
                const isAdj = curSym.includes('ADJ');
                
                adjBtn.style.display = isCont ? 'inline-block' : 'none';
                adjBtn.innerHTML = `
                  <div style="display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:4px; cursor:pointer; font-size:11px; font-weight:700; letter-spacing:0.5px; transition:all 0.15s ease; ${
                    isAdj 
                      ? 'background:#2962ff; color:#ffffff; box-shadow:0 1px 4px rgba(41,98,255,0.4);' 
                      : 'background:rgba(255,255,255,0.08); color:#b2b5be;'
                  }">
                    <span>B-ADJ</span>
                  </div>
                `;
              };

              adjBtn.addEventListener('click', () => {
                const chart = widget.activeChart?.();
                if (!chart) return;
                const curSym = String(chart.symbol?.() || '').toUpperCase();
                const interval = chart.resolution?.() || '1';
                let targetSym = `${curSym}_ADJ`;
                if (curSym.includes('_ADJ')) {
                  targetSym = curSym.replace('_ADJ', '');
                } else if (curSym.includes('ADJ')) {
                  targetSym = curSym.replace('ADJ', '');
                } else if (curSym.endsWith('1!')) {
                  targetSym = `${curSym}_ADJ`;
                } else if (curSym.startsWith('@')) {
                  targetSym = `${curSym.slice(1)}1!_ADJ`;
                } else {
                  const root = curSym.replace(/[FGHJKMNQUVXZ]\d{1,2}$/i, '');
                  targetSym = `${root}1!_ADJ`;
                }
                if (typeof (widget as any).setSymbol === 'function') {
                  (widget as any).setSymbol(targetSym, interval, () => {
                    updateAdjBtnState();
                  });
                }
              });

              updateAdjBtnState();
              try {
                const activeChart = widget.activeChart?.();
                (activeChart as any)?.onSymbolChanged?.().subscribe(null, updateAdjBtnState);
              } catch {}
              try {
                widget.subscribe('symbol_change', updateAdjBtnState);
              } catch {}
            } catch (err) {
              console.warn('[Header Buttons] Creation error:', err);
            }
          });
        }

        // Inject and maintain TradingView Bottom Status Bar B-ADJ Button
        const setupBottomBadjButton = () => {
          try {
            const container = document.getElementById(containerId);
            if (!container) return;
            const iframe = container.querySelector('iframe');
            if (!iframe || !iframe.contentDocument) return;
            const doc = iframe.contentDocument;
            if (doc.querySelector('button[data-name="badj-toggle-btn"]')) return;

            const tzBtn = doc.querySelector('button[data-name="time-zone-menu"]');
            if (!tzBtn) return;

            const tzWrap = tzBtn.closest('.inline-BXXUwft2') || tzBtn.parentElement;
            if (!tzWrap || !tzWrap.parentElement) return;

            const badjWrap = doc.createElement('div');
            badjWrap.className = tzWrap.className;
            badjWrap.innerHTML = `
              <button type="button" data-name="badj-toggle-btn"
                class="${tzBtn.className}"
                title="Adjust for contract rollover changes (Back-Adjusted continuous futures)"
                style="cursor: pointer; padding: 0 8px; margin: 0 2px;"
              >
                <div class="js-button-text text-GwQQdU8S" style="display:flex; align-items:center; font-weight:700; font-size:11px; letter-spacing:0.5px;">
                  <span class="badj-text">B-ADJ</span>
                </div>
              </button>
            `;

            const badjBtn = badjWrap.querySelector('button');

            const syncBadjState = () => {
              try {
                const chart = widget.activeChart?.();
                const curSym = String(chart?.symbol?.() || '').toUpperCase();
                const isAdj = curSym.includes('ADJ');
                const isCont = curSym.includes('1!') || curSym.startsWith('@') || curSym.includes('ADJ');

                badjWrap.style.display = isCont ? 'inline-flex' : 'none';
                if (badjBtn) {
                  if (isAdj) {
                    badjBtn.style.color = '#2962ff';
                    badjBtn.style.fontWeight = '800';
                  } else {
                    badjBtn.style.color = '#b2b5be';
                    badjBtn.style.fontWeight = '600';
                  }
                }
              } catch {}
            };

            badjBtn?.addEventListener('click', () => {
              const chart = widget.activeChart?.();
              if (!chart) return;
              const curSym = String(chart.symbol?.() || '').toUpperCase();
              const interval = chart.resolution?.() || '1';
              let targetSym = '';
              if (curSym.includes('_ADJ')) {
                targetSym = curSym.replace('_ADJ', '');
              } else if (curSym.includes('ADJ')) {
                targetSym = curSym.replace('ADJ', '');
              } else if (curSym.endsWith('1!')) {
                targetSym = `${curSym}_ADJ`;
              } else if (curSym.startsWith('@')) {
                targetSym = `${curSym.slice(1)}1!_ADJ`;
              } else {
                const root = curSym.replace(/[FGHJKMNQUVXZ]\d{1,2}$/i, '');
                targetSym = `${root}1!_ADJ`;
              }
              if (typeof (widget as any).setSymbol === 'function') {
                (widget as any).setSymbol(targetSym, interval, () => {
                  syncBadjState();
                });
              }
            });

            tzWrap.parentElement.insertBefore(badjWrap, tzWrap.nextSibling);
            syncBadjState();

            try {
              const activeChart = widget.activeChart?.();
              (activeChart as any)?.onSymbolChanged?.().subscribe(null, syncBadjState);
            } catch {}
            try {
              widget.subscribe?.('symbol_change', syncBadjState);
            } catch {}
          } catch {}
        };

        const badjPollInterval = setInterval(setupBottomBadjButton, 800);
        setTimeout(() => clearInterval(badjPollInterval), 40000);

        // Periodic auto-save every 5 seconds
        const periodicSaveInterval = setInterval(triggerSave, 5000);

        (window as any).__tvWidget = widget;
        setIsReady(true);
        setIsLoading(false);

        return () => {
          clearInterval(periodicSaveInterval);
          clearInterval(badjPollInterval);
        };
      }
    });

    return () => {
      cancelled = true;
      triggerSaveSync();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', triggerSaveSync);
      if (saveTimeout) clearTimeout(saveTimeout);
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch (e) {
          console.error('Error removing widget', e);
        }
        widgetRef.current = null;
        setIsReady(false);
      }
    };
  }, [containerId, datafeedUrl, brokerFactory, saveLoadAdapter]);

  useEffect(() => {
    if (isReady && widgetRef.current) {
      widgetRef.current.changeTheme(theme);
    }
  }, [theme, isReady]);

  const requestBarSelection = useCallback(() => {
    if (!widgetRef.current) return;
    const chart = widgetRef.current.activeChart?.();
    if (!chart) return;

    if (typeof chart.requestSelectBar === 'function') {
      const curSym = chart.symbol?.() || 'GCZ6';
      barReplayManager.setSymbol(curSym);
      barReplayManager.setIsSelectingBar(true);
      chart.requestSelectBar().then((time: any) => {
        barReplayManager.setIsSelectingBar(false);
        let timeSec = typeof time === 'number' ? time : (time?.time || 0);
        if (timeSec > 10000000000) timeSec = Math.floor(timeSec / 1000);
        if (timeSec > 0) {
          barReplayManager.startReplay(timeSec, () => {
            triggerDatafeedReset();
            chart.resetData?.();
          });
        }
      }).catch(() => {
        barReplayManager.setIsSelectingBar(false);
      });
    } else {
      console.warn('[BarReplay] requestSelectBar not available on chart');
    }
  }, []);

  const cancelBarSelection = useCallback(() => {
    if (!widgetRef.current) return;
    const chart = widgetRef.current.activeChart?.();
    if (chart && typeof chart.cancelSelectBar === 'function') {
      chart.cancelSelectBar();
    }
  }, []);

  const resetChart = useCallback(() => {
    if (!widgetRef.current) return;
    triggerDatafeedReset();
    const chart = widgetRef.current.activeChart?.();
    if (chart && typeof chart.resetData === 'function') {
      chart.resetData();
    }
  }, []);

  const saveLayout = useCallback(() => {
    if (widgetRef.current && typeof widgetRef.current.save === 'function') {
      widgetRef.current.save((state: any) => {
        if (state) saveActiveChartState(state);
      });
    }
  }, []);

  const loadLayout = useCallback(() => {
    const saved = getSavedChartState();
    if (saved && widgetRef.current && typeof widgetRef.current.load === 'function') {
      widgetRef.current.load(saved);
    }
  }, []);

  return { 
    widgetRef, 
    isReady, 
    isLoading, 
    chartActions: { 
      saveLayout, 
      loadLayout, 
      requestBarSelection, 
      cancelBarSelection, 
      resetChart 
    } 
  };
}
