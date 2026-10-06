/**
 * Bar Replay Manager (Market Replay / Cut / Time-Travel Engine)
 * Supports Multi-Timeframe bar replay across Daily, Hourly, Minute, and Sub-minute resolutions.
 * Preserves the exact replay cutoff timestamp when switching resolutions.
 */

export interface BarState {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ReplayStatus {
  isActive: boolean;
  isSelectingBar: boolean;
  isPlaying: boolean;
  cutTimestampSec: number;
  currentReplayTimeSec: number;
  speedMultiplier: number;
  speedMs: number;
  futureBarsCount: number;
  currentResolution: string;
  sessionId: string;
  isHandshakeInProgress: boolean;
  handshakeMessage: string;
  handshakeConfirmed: boolean;
  wasPlayingBeforeSwitch: boolean;
}

type ReplayListener = (status: ReplayStatus) => void;
type BarEmitter = (bar: BarState) => void;

class BarReplayManager {
  private _isActive = false;
  private _isSelectingBar = false;
  private _isPlaying = false;
  private _cutTimestampSec = 0;
  private _currentReplayTimeSec = 0;
  private _speedMultiplier = 1;
  private _speedMs = 1000;
  private _currentResolution = '1';
  private _sessionId = '';
  private _currentSymbol = 'GCZ6';

  private _isHandshakeInProgress = false;
  private _handshakeMessage = '';
  private _handshakeConfirmed = false;
  private _timeframeSwitchTimer: any = null;

  private _futureBars: BarState[] = [];
  private _allBarsCache: Map<string, BarState[]> = new Map(); // seriesKey -> all bars

  private _activeEmitters: Map<string, BarEmitter> = new Map();
  private _listeners: Set<ReplayListener> = new Set();
  private _playInterval: any = null;
  private _onChartReset: (() => void) | null = null;
  private _wasPlayingBeforeSwitch = false;
  private _fetchingFutureBars = false;

  get isActive(): boolean {
    return this._isActive;
  }

  get isSelectingBar(): boolean {
    return this._isSelectingBar;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  get cutTimestampSec(): number {
    return this._cutTimestampSec;
  }

  get currentReplayTimeSec(): number {
    return this._currentReplayTimeSec;
  }

  get futureBarsCount(): number {
    return this._futureBars.length;
  }

  get sessionId(): string {
    return this._sessionId;
  }

  get currentResolution(): string {
    return this._currentResolution;
  }

  get isHandshakeInProgress(): boolean {
    return this._isHandshakeInProgress;
  }

  get handshakeMessage(): string {
    return this._handshakeMessage;
  }

  get handshakeConfirmed(): boolean {
    return this._handshakeConfirmed;
  }

  get wasPlayingBeforeSwitch(): boolean {
    return this._wasPlayingBeforeSwitch;
  }

  public setChartResetCallback(fn: () => void): void {
    this._onChartReset = fn;
  }

  public setIsSelectingBar(selecting: boolean): void {
    this._isSelectingBar = selecting;
    this._notifyListeners();
  }

  public subscribe(listener: ReplayListener): () => void {
    this._listeners.add(listener);
    listener(this.getStatus());
    return () => this._listeners.delete(listener);
  }

  private _notifyListeners(): void {
    const status = this.getStatus();
    for (const listener of this._listeners) {
      try {
        listener(status);
      } catch (err) {
        console.warn('[BarReplay] Listener error:', err);
      }
    }
  }

  public getStatus(): ReplayStatus {
    return {
      isActive: this._isActive,
      isSelectingBar: this._isSelectingBar,
      isPlaying: this._isPlaying,
      cutTimestampSec: this._cutTimestampSec,
      currentReplayTimeSec: this._currentReplayTimeSec,
      speedMultiplier: this._speedMultiplier,
      speedMs: this._speedMs,
      futureBarsCount: this._futureBars.length,
      currentResolution: this._currentResolution,
      sessionId: this._sessionId,
      isHandshakeInProgress: this._isHandshakeInProgress,
      handshakeMessage: this._handshakeMessage,
      handshakeConfirmed: this._handshakeConfirmed,
      wasPlayingBeforeSwitch: this._wasPlayingBeforeSwitch,
    };
  }

  public setSymbol(symbol: string) {
    this._currentSymbol = symbol;
  }

  /**
   * Activate Replay mode at a specific cutoff timestamp (in seconds).
   */
  public async startReplay(cutTimestampSec: number, chartResetFn?: () => void): Promise<void> {
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
    }

    this._isActive = true;
    this._isSelectingBar = false;
    this._isPlaying = false;
    this._cutTimestampSec = cutTimestampSec;
    this._currentReplayTimeSec = cutTimestampSec;
    this._futureBars = [];
    this._allBarsCache.clear();

    try {
      const activeRes = (window as any).tvWidget?.activeChart?.()?.resolution?.();
      if (activeRes) {
        this._currentResolution = activeRes;
      }
    } catch {}

    if (chartResetFn) {
      this._onChartReset = chartResetFn;
    }

    // HANDSHAKE STEP: Call backend to lock snapshot and generate session ID
    try {
      const cutMs = cutTimestampSec * 1000;
      const res = await fetch(`/replay-activate?symbol=${encodeURIComponent(this._currentSymbol)}&resolution=${this._currentResolution}&cutTimestamp=${cutMs}`);
      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          this._sessionId = data.sessionId;
          console.log(`[BarReplay] Activated session ${this._sessionId} at ${cutTimestampSec}s`);
        }
      }
    } catch (err) {
      console.warn('[BarReplay] Failed to activate replay on backend', err);
    }

    // HANDSHAKE STEP: Preload future bars for initial resolution so playback can start immediately
    try {
      const cutMs = cutTimestampSec * 1000;
      const currentMs = cutTimestampSec * 1000;
      const session = this._sessionId;
      const url = `/replay-history?symbol=${encodeURIComponent(this._currentSymbol)}&resolution=${encodeURIComponent(this._currentResolution)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&firstDataRequest=true&sessionId=${encodeURIComponent(session)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
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
        this._futureBars = futureBars;
        console.log(`[BarReplay] Preloaded ${this._futureBars.length} future bars for ${this._currentResolution} at ${cutTimestampSec}s`);
      }
    } catch (err) {
      console.warn('[BarReplay] Failed to preload future bars on start:', err);
    }

    this._notifyListeners();

    if (this._onChartReset) {
      try {
        this._onChartReset();
      } catch (e) {
        console.warn('[BarReplay] Chart reset error on start:', e);
      }
    }
  }

  /**
   * Handshake Step: Pause playback immediately on timeframe switch and display loading status.
   * Playback remains paused until the handshake is fully confirmed for the new timeframe!
   */
  public prepareForTimeframeSwitch(targetResolution: string): void {
    if (!this._isActive) return;
    if (this._currentResolution === targetResolution && !this._isHandshakeInProgress) return;

    console.log(`[BarReplay] ⏸️ Handshake: pausing playback for timeframe switch ${this._currentResolution} -> ${targetResolution}`);
    
    if (this._timeframeSwitchTimer) {
      clearTimeout(this._timeframeSwitchTimer);
      this._timeframeSwitchTimer = null;
    }

    // Always pause playback immediately when switching timeframe and record playing state
    this._wasPlayingBeforeSwitch = true;
    this._isPlaying = false;
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
    }

    this._isHandshakeInProgress = true;
    this._handshakeConfirmed = false;
    this._handshakeMessage = `Loading ${targetResolution} candles... Awaiting Handshake confirmation`;
    this._notifyListeners();

    // Fallback safeguard: if TradingView reuses cached canvas or onHistory is delayed,
    // fetch future bars directly from /replay-history and confirm handshake so chart never hangs
    this._timeframeSwitchTimer = setTimeout(async () => {
      if (this._isHandshakeInProgress) {
        console.warn(`[BarReplay] ⏱️ Handshake direct sync for resolution ${targetResolution}`);
        try {
          const cutMs = this._cutTimestampSec * 1000;
          const currentMs = this._currentReplayTimeSec * 1000;
          const session = this._sessionId;
          const url = `/replay-history?symbol=${encodeURIComponent(this._currentSymbol)}&resolution=${encodeURIComponent(targetResolution)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&firstDataRequest=true&sessionId=${encodeURIComponent(session)}`;
          const res = await fetch(url);
          if (res.ok) {
            const data = await res.json();
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
            this.confirmHandshakeAndResume(targetResolution, futureBars, true);
            return;
          }
        } catch (e) {
          console.warn('[BarReplay] Handshake direct sync failed:', e);
        }
        this._currentResolution = targetResolution;
        this._isHandshakeInProgress = false;
        this._handshakeConfirmed = true;
        this._notifyListeners();
      }
    }, 2500);
  }

  /**
   * Handshake Step: Finalize timeframe switch after Handshake is verified and confirmed.
   * Playback CONTINUES only after handshake confirmation!
   */
  public confirmHandshakeAndResume(
    targetResolution: string,
    futureBars: BarState[],
    isConfirmed: boolean = true
  ): void {
    if (!this._isActive) return;
    if (!isConfirmed) {
      console.warn(`[BarReplay] ⚠️ Handshake not confirmed for ${targetResolution}. Playback remains paused.`);
      return;
    }

    this._currentResolution = targetResolution;
    if (futureBars && futureBars.length > 0) {
      this._futureBars = futureBars;
    }
    this._handshakeMessage = '';

    if (this._timeframeSwitchTimer) {
      clearTimeout(this._timeframeSwitchTimer);
      this._timeframeSwitchTimer = null;
    }

    const finalizeAndResume = () => {
      this._isHandshakeInProgress = false;
      this._handshakeConfirmed = true;
      this._notifyListeners();

      if (this._wasPlayingBeforeSwitch) {
        this._wasPlayingBeforeSwitch = false;
        if (this._futureBars.length > 0) {
          console.log(`[BarReplay] ▶️ Handshake confirmed for ${targetResolution}. Continuing playback!`);
          this.play();
        } else {
          // If future bars are still empty, fetch fresh future runway from backend before resuming
          const cutMs = this._cutTimestampSec * 1000;
          const currentMs = this._currentReplayTimeSec * 1000;
          const session = this._sessionId;
          const url = `/replay-history?symbol=${encodeURIComponent(this._currentSymbol)}&resolution=${encodeURIComponent(targetResolution)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&firstDataRequest=true&sessionId=${encodeURIComponent(session)}`;
          fetch(url)
            .then(r => r.json())
            .then(data => {
              if (data.ft && Array.isArray(data.ft)) {
                const fb: BarState[] = [];
                for (let i = 0; i < data.ft.length; i++) {
                  fb.push({
                    time: data.ft[i] * 1000,
                    open: data.fo[i],
                    high: data.fh[i],
                    low: data.fl[i],
                    close: data.fc[i],
                    volume: data.fv[i] || 1,
                  });
                }
                this._futureBars = fb;
              }
              if (this._futureBars.length > 0) {
                console.log(`[BarReplay] ▶️ Replenished ${this._futureBars.length} future bars for ${targetResolution}. Continuing playback!`);
                this.play();
              }
            })
            .catch(() => {});
        }
      }
    };

    if (this._futureBars.length === 0) {
      const cutMs = this._cutTimestampSec * 1000;
      const currentMs = this._currentReplayTimeSec * 1000;
      const session = this._sessionId;
      const url = `/replay-history?symbol=${encodeURIComponent(this._currentSymbol)}&resolution=${encodeURIComponent(targetResolution)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&firstDataRequest=true&sessionId=${encodeURIComponent(session)}`;
      fetch(url)
        .then(r => r.json())
        .then(data => {
          if (data.ft && Array.isArray(data.ft)) {
            const fb: BarState[] = [];
            for (let i = 0; i < data.ft.length; i++) {
              fb.push({
                time: data.ft[i] * 1000,
                open: data.fo[i],
                high: data.fh[i],
                low: data.fl[i],
                close: data.fc[i],
                volume: data.fv[i] || 1,
              });
            }
            this._futureBars = fb;
          }
          finalizeAndResume();
        })
        .catch(() => {
          finalizeAndResume();
        });
    } else {
      // 300ms layout stabilization for TradingView canvas before continuing playback
      this._timeframeSwitchTimer = setTimeout(finalizeAndResume, 300);
    }
  }

  public completeTimeframeSwitch(targetResolution: string, futureBars: BarState[]): void {
    this.confirmHandshakeAndResume(targetResolution, futureBars, true);
  }

  /**
   * Called by datafeed.getBars() to update visible vs future bars cache.
   */
  public filterAndStoreBars(
    seriesKey: string,
    resolution: string,
    visibleBars: BarState[],
    futureBars: BarState[]
  ): void {
    if (this._isPlaying && this._currentResolution !== resolution) {
      if (this._playInterval) {
        clearInterval(this._playInterval);
        this._playInterval = null;
      }
      this._wasPlayingBeforeSwitch = true;
      this._isPlaying = false;
    }

    this._currentResolution = resolution;
    if (futureBars && futureBars.length > 0) {
      this._futureBars = futureBars;
    }
    this._notifyListeners();
  }

  /**
   * Register a realtime bar emitter for the current chart series
   */
  public registerEmitter(uid: string, emitter: BarEmitter): void {
    this._activeEmitters.set(uid, emitter);
    // Note: Playback resumption is deferred to completeTimeframeSwitch after canvas stabilization.
  }

  public unregisterEmitter(uid: string): void {
    this._activeEmitters.delete(uid);
  }

  /**
   * Advance replay by 1 single candle/bar.
   */
  public step(): boolean {
    if (!this._isActive || this._isHandshakeInProgress || this._futureBars.length === 0) {
      if (this._isPlaying) {
        this.pause();
      }
      return false;
    }

    const nextBar = this._futureBars.shift()!;
    // Exact millisecond conversion for time tracking
    const nextSec = nextBar.time > 10000000000 ? Math.floor(nextBar.time / 1000) : nextBar.time;
    this._currentReplayTimeSec = nextSec;

    // Emit the new candle to all active subscribers (TradingView chart series)
    for (const emit of this._activeEmitters.values()) {
      try {
        emit(nextBar);
      } catch (err) {
        console.warn('[BarReplay] Emit error on step:', err);
      }
    }

    // Proactively replenish future bars when low so playback never stalls
    if (this._futureBars.length <= 10 && !this._fetchingFutureBars) {
      this._fetchingFutureBars = true;
      const cutMs = this._cutTimestampSec * 1000;
      const currentMs = this._currentReplayTimeSec * 1000;
      const session = this._sessionId;
      const sym = this._currentSymbol;
      const res = this._currentResolution;
      const url = `/replay-history?symbol=${encodeURIComponent(sym)}&resolution=${encodeURIComponent(res)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&sessionId=${encodeURIComponent(session)}`;
      fetch(url)
        .then(r => r.json())
        .then(data => {
          if (data.ft && Array.isArray(data.ft)) {
            const more: BarState[] = [];
            const existingTimes = new Set(this._futureBars.map(b => b.time));
            for (let i = 0; i < data.ft.length; i++) {
              const t = data.ft[i] * 1000;
              if (!existingTimes.has(t)) {
                more.push({
                  time: t,
                  open: data.fo[i],
                  high: data.fh[i],
                  low: data.fl[i],
                  close: data.fc[i],
                  volume: data.fv[i] || 1,
                });
              }
            }
            if (more.length > 0) {
              this._futureBars.push(...more);
            }
          }
        })
        .catch(() => {})
        .finally(() => {
          this._fetchingFutureBars = false;
        });
    }

    this._notifyListeners();
    return true;
  }

  public play(): void {
    if (!this._isActive || this._isPlaying || this._isHandshakeInProgress) return;
    if (this._futureBars.length === 0) {
      const cutMs = this._cutTimestampSec * 1000;
      const currentMs = this._currentReplayTimeSec * 1000;
      const session = this._sessionId;
      const sym = this._currentSymbol;
      const res = this._currentResolution;
      const url = `/replay-history?symbol=${encodeURIComponent(sym)}&resolution=${encodeURIComponent(res)}&currentReplayTime=${currentMs}&cutTimestamp=${cutMs}&firstDataRequest=true&sessionId=${encodeURIComponent(session)}`;
      fetch(url)
        .then(r => r.json())
        .then(data => {
          if (data.ft && Array.isArray(data.ft)) {
            const more: BarState[] = [];
            for (let i = 0; i < data.ft.length; i++) {
              more.push({
                time: data.ft[i] * 1000,
                open: data.fo[i],
                high: data.fh[i],
                low: data.fl[i],
                close: data.fc[i],
                volume: data.fv[i] || 1,
              });
            }
            if (more.length > 0) {
              this._futureBars = more;
              this.play();
            }
          }
        })
        .catch(() => {});
      return;
    }

    this._isPlaying = true;
    this._wasPlayingBeforeSwitch = false;
    if (this._playInterval) clearInterval(this._playInterval);

    this._playInterval = setInterval(() => {
      const hasMore = this.step();
      if (!hasMore) {
        this.pause();
      }
    }, this._speedMs);

    this._notifyListeners();
  }

  public pause(): void {
    this._wasPlayingBeforeSwitch = false;
    if (!this._isPlaying && !this._playInterval) return;

    this._isPlaying = false;
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
    }

    this._notifyListeners();
  }

  public setSpeed(multiplier: number): void {
    this._speedMultiplier = multiplier;
    const delayMap: Record<number, number> = {
      0.1: 10000, 0.3: 3000, 0.5: 2000, 1: 1000, 2: 500, 3: 330, 5: 200, 10: 100,
    };
    this._speedMs = delayMap[multiplier] || Math.max(50, Math.floor(1000 / multiplier));

    if (this._isPlaying) {
      if (this._playInterval) clearInterval(this._playInterval);
      this._playInterval = setInterval(() => {
        const hasMore = this.step();
        if (!hasMore) {
          this.pause();
        }
      }, this._speedMs);
    }

    this._notifyListeners();
  }

  public async exitReplay(chartResetFn?: () => void): Promise<void> {
    if (this._playInterval) {
      clearInterval(this._playInterval);
      this._playInterval = null;
    }

    if (this._timeframeSwitchTimer) {
      clearTimeout(this._timeframeSwitchTimer);
      this._timeframeSwitchTimer = null;
    }

    this._isActive = false;
    this._isSelectingBar = false;
    this._isPlaying = false;
    this._isHandshakeInProgress = false;
    this._handshakeMessage = '';
    this._wasPlayingBeforeSwitch = false;
    this._cutTimestampSec = 0;
    this._currentReplayTimeSec = 0;
    this._futureBars = [];
    this._sessionId = '';
    this._allBarsCache.clear();
    this._activeEmitters.clear();

    try {
      await fetch(`/replay-deactivate`);
    } catch (err) {
      console.warn('[BarReplay] Failed to deactivate on backend', err);
    }

    const reset = chartResetFn || this._onChartReset;
    this._notifyListeners();

    if (reset) {
      try {
        reset();
      } catch (e) {
        console.warn('[BarReplay] Chart reset error on exit:', e);
      }
    }
  }
}

export const barReplayManager = new BarReplayManager();

if (typeof window !== 'undefined') {
  (window as any).__barReplayManager = barReplayManager;
}
