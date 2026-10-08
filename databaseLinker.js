/**
 * Database Linker (databaseLinker.js)
 * 
 * Pure SQL Time-Series Engine & Database Linker for TradingView Terminal.
 * 
 * Dual Engine Architecture:
 * - Primary: better-sqlite3 (ultra-fast, native memory-mapped SQLite for Node.js)
 * - Fallback: sql.js (pure WebAssembly SQLite with zero native C++ bindings for Vercel/serverless)
 * 
 * 100% Offline & Pure SQL. Zero external API calls.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_DIR = fs.existsSync(path.join(process.cwd(), 'database'))
  ? path.join(process.cwd(), 'database')
  : path.join(__dirname, 'database');

const FIXED_TIMEFRAMES = [
  '1S', '5S', '15S', '30S',
  '1', '3', '5', '15', '30', '60',
  '1D', '1W', '1M'
];

const KNOWN_SYMBOLS = {
  'GCZ6': { symbol: 'GCZ6', name: 'GCZ6', description: 'Gold Futures (Dec 2026)', pricescale: 10, tickSize: 0.1, minmov: 1, exchange: 'CME', type: 'futures' },
  'SIZ6': { symbol: 'SIZ6', name: 'SIZ6', description: 'Silver Futures (Dec 2026)', pricescale: 1000, tickSize: 0.005, minmov: 5, exchange: 'CME', type: 'futures' },
  'NQZ6': { symbol: 'NQZ6', name: 'NQZ6', description: 'E-Mini Nasdaq-100 (Dec 2026)', pricescale: 100, tickSize: 0.25, minmov: 25, exchange: 'CME', type: 'futures' },
  'ESZ6': { symbol: 'ESZ6', name: 'ESZ6', description: 'E-Mini S&P 500 (Dec 2026)', pricescale: 100, tickSize: 0.25, minmov: 25, exchange: 'CME', type: 'futures' },
  'GC1!': { symbol: 'GC1!', name: 'GC1!', description: 'Gold Continuous Futures', pricescale: 10, tickSize: 0.1, minmov: 1, exchange: 'CME', type: 'futures' },
  'SI1!': { symbol: 'SI1!', name: 'SI1!', description: 'Silver Continuous Futures', pricescale: 1000, tickSize: 0.005, minmov: 5, exchange: 'CME', type: 'futures' },
  'NQ1!': { symbol: 'NQ1!', name: 'NQ1!', description: 'E-Mini Nasdaq-100 Continuous', pricescale: 100, tickSize: 0.25, minmov: 25, exchange: 'CME', type: 'futures' },
  'ES1!': { symbol: 'ES1!', name: 'ES1!', description: 'E-Mini S&P 500 Continuous', pricescale: 100, tickSize: 0.25, minmov: 25, exchange: 'CME', type: 'futures' },
};

function sanitizeSymbol(symbol) {
  let s = String(symbol || 'GCZ6').trim().toUpperCase().replace(/^CME:/i, '').replace(/^TRADOVATE:/i, '');
  if (s === 'GC1!' || s === '@GC') return 'GC1!';
  if (s === 'SI1!' || s === '@SI') return 'SI1!';
  if (s === 'NQ1!' || s === '@NQ') return 'NQ1!';
  if (s === 'ES1!' || s === '@ES') return 'ES1!';
  if (s.startsWith('GC') || s === 'GOLD' || s === 'XAU' || s === 'XAUUSD') return 'GCZ6';
  if (s.startsWith('SI') || s === 'SILVER' || s === 'XAG' || s === 'XAGUSD') return 'SIZ6';
  if (s.startsWith('NQ') || s.startsWith('MNQ') || s === 'NASDAQ' || s === 'NDX') return 'NQZ6';
  if (s.startsWith('ES') || s.startsWith('MES') || s === 'SPX' || s === 'SP500' || s === 'EMINI') return 'ESZ6';
  return s.replace(/[\\/:*?"<>|]/g, '_');
}

function normalizeTimeframe(tf) {
  const u = String(tf || '1').trim().toUpperCase();
  if (u === 'D') return '1D';
  if (u === 'W') return '1W';
  if (u === 'M') return '1M';
  return u;
}

function getTimeframeSeconds(tf) {
  const u = normalizeTimeframe(tf);
  if (u.endsWith('S')) return parseInt(u, 10) || 1;
  if (u === '1D') return 86400;
  if (u === '1W') return 7 * 86400;
  if (u === '1M') return 30 * 86400;
  const m = parseInt(u, 10);
  return (!isNaN(m) && m > 0) ? m * 60 : 60;
}

// Try loading better-sqlite3 at startup
let BetterDatabase = null;
try {
  const mod = await import('better-sqlite3');
  BetterDatabase = mod.default || mod;
} catch {
  BetterDatabase = null;
}

let SqlJsInit = null;

class DatabaseLinker {
  constructor() {
    this.driver = BetterDatabase ? 'better-sqlite3' : 'sql.js';
    this.betterDbMap = new Map();
    this.sqlJsDbMap = new Map();
    this.SQL = null;
    this.lastBetterError = null;
    this.lastSqlJsError = null;
  }

  async ensureSqlJs() {
    if (!this.SQL) {
      if (!SqlJsInit) {
        const mod = await import('sql.js');
        SqlJsInit = mod.default || mod;
      }
      const candidates = [
        path.join(process.cwd(), 'sql-wasm.wasm'),
        path.join(process.cwd(), 'public', 'sql-wasm.wasm'),
        path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
        path.join(__dirname, 'sql-wasm.wasm')
      ];
      const wasmPath = candidates.find(p => fs.existsSync(p));
      this.SQL = await SqlJsInit(wasmPath ? { locateFile: () => wasmPath } : undefined);
    }
    return this.SQL;
  }

  getDbFilePath(symbol) {
    const cleanSym = sanitizeSymbol(symbol);
    const sourcePath = path.join(DB_DIR, `${cleanSym}.db`);
    if (!fs.existsSync(sourcePath)) {
      return null;
    }

    // On AWS Lambda / Vercel serverless / Linux read-only filesystems,
    // copy database to /tmp to guarantee 100% read/lock access without permissions issues.
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || (process.platform === 'linux' && fs.existsSync('/tmp'))) {
      const tmpPath = path.join('/tmp', `${cleanSym}.db`);
      try {
        if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size !== fs.statSync(sourcePath).size) {
          fs.copyFileSync(sourcePath, tmpPath);
        }
        return tmpPath;
      } catch (err) {
        console.warn('[DB] /tmp copy warning:', err.message);
      }
    }

    return sourcePath;
  }

  getBetterDb(symbol) {
    if (!BetterDatabase) return null;
    const cleanSym = sanitizeSymbol(symbol);
    if (this.betterDbMap.has(cleanSym)) {
      return this.betterDbMap.get(cleanSym);
    }

    const filePath = this.getDbFilePath(cleanSym);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      const db = new BetterDatabase(filePath, { readonly: true, fileMustExist: true });
      try {
        db.pragma('query_only = ON');
        db.pragma('cache_size = -32000');
        db.pragma('temp_store = MEMORY');
      } catch {}

      const stmts = {
        selectRange: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM candles
          WHERE symbol = ? AND timeframe = ? AND timeSec >= ? AND timeSec <= ?
          ORDER BY timeSec ASC
        `),
        selectAll: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM candles
          WHERE symbol = ? AND timeframe = ?
          ORDER BY timeSec ASC
        `),
        selectCountback: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM (
            SELECT timeSec, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ? AND timeSec <= ?
            ORDER BY timeSec DESC
            LIMIT ?
          )
          ORDER BY timeSec ASC
        `),
        selectLatestN: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM (
            SELECT timeSec, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ?
            ORDER BY timeSec DESC
            LIMIT ?
          )
          ORDER BY timeSec ASC
        `),
        latestSec: db.prepare(`
          SELECT MAX(timeSec) as latestSec
          FROM candles
          WHERE symbol = ? AND timeframe = ?
        `),
        count: db.prepare(`
          SELECT COUNT(*) as total
          FROM candles
          WHERE symbol = ? AND timeframe = ?
        `),
        totalCount: db.prepare(`
          SELECT COUNT(*) as total FROM candles
        `),
        latestAny: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM candles
          WHERE symbol = ?
          ORDER BY timeSec DESC
          LIMIT 1
        `),
        selectReplayPast: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM (
            SELECT timeSec, open, high, low, close, volume
            FROM candles
            WHERE symbol = ? AND timeframe = ? AND timeSec <= ?
            ORDER BY timeSec DESC
            LIMIT ?
          )
          ORDER BY timeSec ASC
        `),
        selectReplayFuture: db.prepare(`
          SELECT timeSec, open, high, low, close, volume
          FROM candles
          WHERE symbol = ? AND timeframe = ? AND timeSec > ?
          ORDER BY timeSec ASC
          LIMIT ?
        `)
      };

      const entry = { db, stmts, filePath };
      this.betterDbMap.set(cleanSym, entry);
      return entry;
    } catch (err) {
      this.lastBetterError = err.message + '\n' + err.stack;
      console.error('[BETTER-SQLITE ERROR]', err);
      return null;
    }
  }

  async getSqlJsDb(symbol) {
    const cleanSym = sanitizeSymbol(symbol);
    if (this.sqlJsDbMap.has(cleanSym)) {
      return this.sqlJsDbMap.get(cleanSym);
    }

    const filePath = this.getDbFilePath(cleanSym);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    try {
      await this.ensureSqlJs();
      const fileBuffer = fs.readFileSync(filePath);
      const db = new this.SQL.Database(fileBuffer);

      const entry = { db, filePath };
      this.sqlJsDbMap.set(cleanSym, entry);
      return entry;
    } catch (err) {
      this.lastSqlJsError = err.message + '\n' + err.stack;
      console.error('[SQL.JS ERROR]', err);
      return null;
    }
  }

  async queryBars(symbol, timeframe, fromSec, toSec, countback) {
    const cleanSym = sanitizeSymbol(symbol);
    const tfNorm = normalizeTimeframe(timeframe);

    if (this.driver === 'better-sqlite3' && BetterDatabase) {
      try {
        const entry = this.getBetterDb(cleanSym);
        if (entry) {
          if (fromSec && toSec) {
            return entry.stmts.selectRange.all(cleanSym, tfNorm, fromSec, toSec);
          } else if (toSec && countback) {
            return entry.stmts.selectCountback.all(cleanSym, tfNorm, toSec, countback);
          } else if (countback) {
            return entry.stmts.selectLatestN.all(cleanSym, tfNorm, countback);
          } else {
            return entry.stmts.selectAll.all(cleanSym, tfNorm);
          }
        }
      } catch (err) {
        this.lastBetterError = err.message + '\n' + err.stack;
        this.driver = 'sql.js';
      }
    }

    // sql.js execution
    try {
      const entry = await this.getSqlJsDb(cleanSym);
      if (!entry) return [];

      let query = '';
      let params = [];

      if (fromSec && toSec) {
        query = 'SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? AND timeSec >= ? AND timeSec <= ? ORDER BY timeSec ASC';
        params = [cleanSym, tfNorm, fromSec, toSec];
      } else if (toSec && countback) {
        query = 'SELECT timeSec, open, high, low, close, volume FROM (SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? AND timeSec <= ? ORDER BY timeSec DESC LIMIT ?) ORDER BY timeSec ASC';
        params = [cleanSym, tfNorm, toSec, countback];
      } else if (countback) {
        query = 'SELECT timeSec, open, high, low, close, volume FROM (SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY timeSec DESC LIMIT ?) ORDER BY timeSec ASC';
        params = [cleanSym, tfNorm, countback];
      } else {
        query = 'SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? ORDER BY timeSec ASC';
        params = [cleanSym, tfNorm];
      }

      const stmt = entry.db.prepare(query);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
          timeSec: Number(row.timeSec),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume || 1)
        });
      }
      stmt.free();
      return rows;
    } catch (err) {
      this.lastSqlJsError = err.message + '\n' + err.stack;
      return [];
    }
  }

  async queryFutureBars(symbol, timeframe, afterSec, limit = 500) {
    const cleanSym = sanitizeSymbol(symbol);
    const tfNorm = normalizeTimeframe(timeframe);

    if (this.driver === 'better-sqlite3' && BetterDatabase) {
      try {
        const entry = this.getBetterDb(cleanSym);
        if (entry && entry.stmts.selectReplayFuture) {
          return entry.stmts.selectReplayFuture.all(cleanSym, tfNorm, afterSec, limit);
        }
      } catch (err) {
        this.driver = 'sql.js';
      }
    }

    // sql.js execution
    try {
      const entry = await this.getSqlJsDb(cleanSym);
      if (!entry) return [];

      const query = 'SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? AND timeframe = ? AND timeSec > ? ORDER BY timeSec ASC LIMIT ?';
      const stmt = entry.db.prepare(query);
      stmt.bind([cleanSym, tfNorm, afterSec, limit]);
      const rows = [];
      while (stmt.step()) {
        const row = stmt.getAsObject();
        rows.push({
          timeSec: Number(row.timeSec),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.volume || 1)
        });
      }
      stmt.free();
      return rows;
    } catch {
      return [];
    }
  }

  aggregateDailyBars(dailyBars, targetTf) {
    if (!dailyBars || dailyBars.length === 0) return [];
    const tfUpper = normalizeTimeframe(targetTf);
    const sorted = dailyBars.slice().sort((a, b) => a.timeSec - b.timeSec);
    const groups = new Map();

    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      const d = new Date(b.timeSec * 1000);
      let groupKey = '';
      if (tfUpper === '1W') {
        const utcDay = d.getUTCDay();
        const diffToMon = (utcDay + 6) % 7;
        const monSec = b.timeSec - (diffToMon * 86400);
        groupKey = `W_${Math.floor(monSec / 86400) * 86400}`;
      } else {
        groupKey = `M_${d.getUTCFullYear()}_${d.getUTCMonth() + 1}`;
      }
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(b);
    }

    const result = [];
    for (const [, grp] of groups.entries()) {
      if (grp.length === 0) continue;
      const first = grp[0];
      const last = grp[grp.length - 1];
      let h = -Infinity;
      let l = Infinity;
      let v = 0;
      for (const bar of grp) {
        if (bar.high > h) h = bar.high;
        if (bar.low < l) l = bar.low;
        v += (bar.volume || 1);
      }
      result.push({
        timeSec: first.timeSec,
        open: first.open,
        high: h,
        low: l,
        close: last.close,
        volume: v
      });
    }
    return result;
  }

  aggregateMinuteBars(base1mBars, bucketSec) {
    if (!base1mBars || base1mBars.length === 0) return [];
    const sorted = base1mBars.slice().sort((a, b) => a.timeSec - b.timeSec);
    const groups = new Map();

    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i];
      const bucketKey = Math.floor(b.timeSec / bucketSec) * bucketSec;
      if (!groups.has(bucketKey)) groups.set(bucketKey, []);
      groups.get(bucketKey).push(b);
    }

    const result = [];
    for (const [bSec, grp] of groups.entries()) {
      if (grp.length === 0) continue;
      const first = grp[0];
      const last = grp[grp.length - 1];
      let h = -Infinity;
      let l = Infinity;
      let v = 0;
      for (const bar of grp) {
        if (bar.high > h) h = bar.high;
        if (bar.low < l) l = bar.low;
        v += (bar.volume || 1);
      }
      result.push({
        timeSec: bSec,
        open: first.open,
        high: h,
        low: l,
        close: last.close,
        volume: v
      });
    }
    return result;
  }

  async getHistory(symbol, resolution, fromSec, toSec, countback = 300, isFirst = false) {
    const symUpper = sanitizeSymbol(symbol);
    const tfNorm = normalizeTimeframe(resolution);

    const fromNum = Number(fromSec) || 0;
    const toNum = Number(toSec) || 0;
    const countNum = Math.max(1, Number(countback) || 300);
    const effectiveCount = isFirst ? Math.max(countNum, 1000) : countNum;

    // Query SQLite database
    let bars = [];
    if (isFirst || (!fromNum && !toNum)) {
      bars = await this.queryBars(symUpper, tfNorm, null, toNum > 0 ? toNum : null, effectiveCount);
    } else if (fromNum > 0 && toNum > 0) {
      bars = await this.queryBars(symUpper, tfNorm, fromNum, toNum, null);
      if ((!bars || bars.length === 0) && toNum > 0) {
        bars = await this.queryBars(symUpper, tfNorm, null, toNum, countNum);
      }
    } else if (toNum > 0) {
      bars = await this.queryBars(symUpper, tfNorm, null, toNum, countNum);
    } else {
      bars = await this.queryBars(symUpper, tfNorm, null, null, countNum);
    }

    // Multi-Timeframe SQL Synthesis if higher timeframe not directly populated
    const isWeeklyOrMonthly = ['1W', '1M'].includes(tfNorm);
    if ((!bars || bars.length === 0) && isWeeklyOrMonthly) {
      const dailyBars = await this.queryBars(symUpper, '1D', fromNum > 0 ? fromNum : null, toNum > 0 ? toNum : null, countNum * 30);
      if (dailyBars && dailyBars.length > 0) {
        const aggregated = this.aggregateDailyBars(dailyBars, tfNorm);
        if (aggregated.length > 0) {
          bars = aggregated.slice(-countNum);
        }
      }
    }

    const tfSec = getTimeframeSeconds(tfNorm);
    if ((!bars || bars.length === 0) && !isWeeklyOrMonthly && tfNorm !== '1' && tfSec >= 60) {
      const base1mBars = await this.queryBars(symUpper, '1', fromNum > 0 ? (fromNum - tfSec) : null, toNum > 0 ? toNum : null, countNum * Math.floor(tfSec / 60));
      if (base1mBars && base1mBars.length > 0) {
        const agg = this.aggregateMinuteBars(base1mBars, tfSec);
        if (agg.length > 0) {
          bars = agg.slice(-countNum);
        }
      }
    }

    // Scrollback fallback
    if ((!bars || bars.length === 0) && toNum > 0) {
      bars = await this.queryBars(symUpper, tfNorm, null, toNum, countNum);
    }
    if ((!bars || bars.length === 0) && (isFirst || (!fromNum && !toNum))) {
      bars = await this.queryBars(symUpper, tfNorm, null, null, countNum);
    }

    if (!bars || bars.length === 0) {
      return { s: 'no_data', t: [], o: [], h: [], l: [], c: [], v: [] };
    }

    const count = bars.length;
    const t = new Array(count);
    const o = new Array(count);
    const h = new Array(count);
    const l = new Array(count);
    const c = new Array(count);
    const v = new Array(count);

    for (let i = 0; i < count; i++) {
      const b = bars[i];
      t[i] = b.timeSec;
      o[i] = b.open;
      h[i] = b.high;
      l[i] = b.low;
      c[i] = b.close;
      v[i] = b.volume || 1;
    }

    return {
      s: 'ok',
      t, o, h, l, c, v
    };
  }

  async getReplayHistory(symbol, resolution, currentReplayTime, cutTimestamp, fromSec, toSec, firstDataRequest = false, countback = 500) {
    const symUpper = sanitizeSymbol(symbol);
    const tfNorm = normalizeTimeframe(resolution);

    let cut = Number(cutTimestamp) || 0;
    let curr = Number(currentReplayTime) || 0;
    if (cut > 10000000000) cut = Math.floor(cut / 1000);
    if (curr > 10000000000) curr = Math.floor(curr / 1000);
    const effectiveCut = curr > 0 ? curr : cut;

    const fromNum = Number(fromSec) || 0;
    const toNum = Number(toSec) || 0;
    const countNum = Math.max(50, Number(countback) || 500);

    // 1. Query past bars up to effectiveCut
    let pastBars = [];
    if (firstDataRequest || !fromNum) {
      pastBars = await this.queryBars(symUpper, tfNorm, null, effectiveCut > 0 ? effectiveCut : null, countNum);
    } else {
      const maxTo = effectiveCut > 0 ? Math.min(toNum, effectiveCut) : toNum;
      if (fromNum <= maxTo) {
        pastBars = await this.queryBars(symUpper, tfNorm, fromNum, maxTo, null);
      }
    }

    // Multi-Timeframe synthesis for past bars if needed
    const isWeeklyOrMonthly = ['1W', '1M'].includes(tfNorm);
    if ((!pastBars || pastBars.length === 0) && isWeeklyOrMonthly) {
      const dailyBars = await this.queryBars(symUpper, '1D', null, effectiveCut > 0 ? effectiveCut : null, countNum * 30);
      if (dailyBars && dailyBars.length > 0) {
        const agg = this.aggregateDailyBars(dailyBars, tfNorm);
        if (agg.length > 0) pastBars = agg.slice(-countNum);
      }
    }

    const tfSec = getTimeframeSeconds(tfNorm);
    if ((!pastBars || pastBars.length === 0) && !isWeeklyOrMonthly && tfNorm !== '1' && tfSec >= 60) {
      const base1mBars = await this.queryBars(symUpper, '1', null, effectiveCut > 0 ? effectiveCut : null, countNum * Math.floor(tfSec / 60));
      if (base1mBars && base1mBars.length > 0) {
        const agg = this.aggregateMinuteBars(base1mBars, tfSec);
        if (agg.length > 0) pastBars = agg.slice(-countNum);
      }
    }

    // Fallback if pastBars still empty
    if ((!pastBars || pastBars.length === 0) && effectiveCut > 0) {
      pastBars = await this.queryBars(symUpper, tfNorm, null, effectiveCut, countNum);
    }

    // 2. Query future runway bars (> effectiveCut)
    let futureBars = [];
    if (effectiveCut > 0) {
      futureBars = await this.queryFutureBars(symUpper, tfNorm, effectiveCut, 500);

      if ((!futureBars || futureBars.length === 0) && isWeeklyOrMonthly) {
        const dailyFuture = await this.queryFutureBars(symUpper, '1D', effectiveCut, 500 * 30);
        if (dailyFuture && dailyFuture.length > 0) {
          futureBars = this.aggregateDailyBars(dailyFuture, tfNorm).slice(0, 500);
        }
      }

      if ((!futureBars || futureBars.length === 0) && !isWeeklyOrMonthly && tfNorm !== '1' && tfSec >= 60) {
        const base1mFuture = await this.queryFutureBars(symUpper, '1', effectiveCut, 500 * Math.floor(tfSec / 60));
        if (base1mFuture && base1mFuture.length > 0) {
          futureBars = this.aggregateMinuteBars(base1mFuture, tfSec).slice(0, 500);
        }
      }
    }

    const t = [];
    const o = [];
    const h = [];
    const l = [];
    const c = [];
    const v = [];

    for (const b of (pastBars || [])) {
      t.push(b.timeSec);
      o.push(b.open);
      h.push(b.high);
      l.push(b.low);
      c.push(b.close);
      v.push(b.volume || 1);
    }

    const ft = [];
    const fo = [];
    const fh = [];
    const fl = [];
    const fc = [];
    const fv = [];

    for (const b of (futureBars || [])) {
      ft.push(b.timeSec);
      fo.push(b.open);
      fh.push(b.high);
      fl.push(b.low);
      fc.push(b.close);
      fv.push(b.volume || 1);
    }

    return {
      s: t.length > 0 ? 'ok' : 'no_data',
      t, o, h, l, c, v,
      ft, fo, fh, fl, fc, fv,
      handshakeId: `hs_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      hash: 'replay_confirmed'
    };
  }

  getConfig() {
    return {
      supported_resolutions: FIXED_TIMEFRAMES,
      supports_group_request: false,
      supports_marks: false,
      supports_search: true,
      supports_timescale_marks: false,
      supports_time: true,
      has_intraday: true,
      has_seconds: true,
      has_ticks: false,
      ticks_multipliers: [],
      seconds_multipliers: ['1', '5', '15', '30'],
      intraday_multipliers: ['1', '3', '5', '15', '30', '60'],
      has_daily: true,
      daily_multipliers: ['1'],
      has_weekly_and_monthly: true,
      weekly_multipliers: ['1'],
      monthly_multipliers: ['1'],
      default_symbol: 'GCZ6'
    };
  }

  getSymbolInfo(symbol) {
    const cleanSym = sanitizeSymbol(symbol);
    const meta = KNOWN_SYMBOLS[cleanSym] || {
      symbol: cleanSym,
      name: cleanSym,
      description: `${cleanSym} Futures`,
      pricescale: 100,
      tickSize: 0.01,
      minmov: 1,
      exchange: 'CME',
      type: 'futures'
    };

    return {
      name: meta.symbol,
      ticker: meta.symbol,
      full_name: `CME:${meta.symbol}`,
      description: meta.description,
      type: meta.type,
      session: '24x7',
      exchange: meta.exchange,
      listed_exchange: meta.exchange,
      timezone: 'Etc/UTC',
      minmov: meta.minmov,
      pricescale: meta.pricescale,
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
      supported_resolutions: FIXED_TIMEFRAMES,
      data_status: 'streaming'
    };
  }

  async getQuotes(symbols) {
    const rawSyms = Array.isArray(symbols) ? symbols : String(symbols || 'GCZ6').split(',');
    const quotes = [];

    for (const raw of rawSyms) {
      const sym = sanitizeSymbol(raw);
      let latest = null;

      if (this.driver === 'better-sqlite3' && BetterDatabase) {
        try {
          const entry = this.getBetterDb(sym);
          if (entry) {
            latest = entry.stmts.latestAny.get(sym);
          }
        } catch {}
      }

      if (!latest) {
        try {
          const entry = await this.getSqlJsDb(sym);
          if (entry) {
            const stmt = entry.db.prepare('SELECT timeSec, open, high, low, close, volume FROM candles WHERE symbol = ? ORDER BY timeSec DESC LIMIT 1');
            stmt.bind([sym]);
            if (stmt.step()) {
              latest = stmt.getAsObject();
            }
            stmt.free();
          }
        } catch {}
      }

      const lp = latest ? Number(latest.close) : 2650.0;
      quotes.push({
        s: 'ok',
        n: sym,
        v: {
          ch: 0,
          chp: 0,
          lp,
          bid: lp,
          ask: lp,
          spread: 0.1,
          open_price: latest ? Number(latest.open) : lp,
          high_price: latest ? Number(latest.high) : lp,
          low_price: latest ? Number(latest.low) : lp,
          prev_close_price: lp,
          volume: latest ? Number(latest.volume || 1) : 100
        }
      });
    }

    return { s: 'ok', d: quotes };
  }

  searchSymbols(query = '', limit = 30) {
    const q = String(query || '').trim().toUpperCase();
    const all = Object.values(KNOWN_SYMBOLS);
    const filtered = all.filter(s => !q || s.symbol.includes(q) || s.description.toUpperCase().includes(q)).slice(0, limit);
    return filtered.map(i => ({
      symbol: i.symbol,
      full_name: `CME:${i.symbol}`,
      description: i.description,
      exchange: i.exchange,
      type: i.type
    }));
  }

  getHandshake() {
    const dbs = [];
    if (fs.existsSync(DB_DIR)) {
      const files = fs.readdirSync(DB_DIR).filter(f => f.endsWith('.db'));
      for (const f of files) {
        const sym = f.replace('.db', '');
        dbs.push({
          symbol: sym,
          fileName: f,
          status: 'READY'
        });
      }
    }
    return {
      ok: true,
      status: 'HANDSHAKE_ESTABLISHED',
      driver: this.driver,
      databaseDirectory: DB_DIR,
      symbolDatabases: dbs,
      resolutions: {
        supported: FIXED_TIMEFRAMES,
        count: FIXED_TIMEFRAMES.length,
        ticksDisabled: true
      },
      lastBetterError: this.lastBetterError,
      lastSqlJsError: this.lastSqlJsError
    };
  }
}

const databaseLinker = new DatabaseLinker();

export {
  DatabaseLinker,
  databaseLinker,
  sanitizeSymbol,
  normalizeTimeframe,
  getTimeframeSeconds,
  FIXED_TIMEFRAMES,
  KNOWN_SYMBOLS
};
