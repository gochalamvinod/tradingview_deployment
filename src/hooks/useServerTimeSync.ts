import { useState, useEffect } from 'react';
import {
  startSync,
  stopSync,
  getCalibratedServerTimeSec,
  getCalibratedServerTimeMs,
  getOffset,
  isSynced,
  getSyncStats,
} from '../lib/serverTimeSync';

/**
 * React hook that exposes the OANDA-calibrated server time.
 * Updates every second for UI display; the underlying sync engine
 * runs Cristian's algorithm every 30s for <1ms accuracy.
 */
export function useServerTimeSync() {
  const [syncState, setSyncState] = useState({
    serverTimeSec: getCalibratedServerTimeSec(),
    serverTimeMs: getCalibratedServerTimeMs(),
    offset: getOffset(),
    isSynced: isSynced(),
  });

  useEffect(() => {
    startSync();

    const interval = setInterval(() => {
      setSyncState({
        serverTimeSec: getCalibratedServerTimeSec(),
        serverTimeMs: getCalibratedServerTimeMs(),
        offset: getOffset(),
        isSynced: isSynced(),
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      stopSync();
    };
  }, []);

  return { ...syncState, getSyncStats };
}
