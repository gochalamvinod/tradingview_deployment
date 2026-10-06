/**
 * Vercel Serverless Function (api/index.js)
 * 
 * Routes incoming UDF & Chart requests directly to databaseLinker.
 */

import { databaseLinker } from '../databaseLinker.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const parsed = new URL(req.url || '/', 'http://localhost');
  let pathname = parsed.pathname || '/';
  const query = Object.fromEntries(parsed.searchParams.entries());

  // Support Vercel rewrite route param if present
  if (query.route) {
    pathname = '/' + query.route;
  }

  const sendJson = (statusCode, data) => {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };

  try {
    if (pathname === '/time' || pathname === '/api/time') {
      const sec = (Date.now() / 1000).toFixed(3);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end(sec);
    }

    if (pathname === '/config' || pathname === '/api/config') {
      return sendJson(200, databaseLinker.getConfig());
    }

    if (pathname === '/symbols' || pathname === '/api/symbols') {
      const sym = query.symbol || 'GCZ6';
      return sendJson(200, databaseLinker.getSymbolInfo(sym));
    }

    if (pathname === '/history' || pathname === '/api/history') {
      const symbol = query.symbol || 'GCZ6';
      const resolution = query.resolution || '1';
      const from = Number(query.from) || 0;
      const to = Number(query.to) || 0;
      const countback = Number(query.countback) || 500;
      const isFirst = query.firstDataRequest === 'true' || query.firstDataRequest === true || (!from && !to);

      const history = await databaseLinker.getHistory(symbol, resolution, from, to, countback, isFirst);
      return sendJson(200, history);
    }

    if (pathname === '/quotes' || pathname === '/api/quotes') {
      const quotes = await databaseLinker.getQuotes(query.symbols || query.symbol || 'GCZ6');
      return sendJson(200, quotes);
    }

    if (pathname === '/search' || pathname === '/api/search') {
      const results = databaseLinker.searchSymbols(query.query || '', Number(query.limit) || 30);
      return sendJson(200, results);
    }

    if (pathname === '/handshake' || pathname === '/api/handshake') {
      return sendJson(200, databaseLinker.getHandshake());
    }

    if (pathname === '/watchlist' || pathname === '/api/watchlist') {
      return sendJson(200, { defaultWatchlist: 'POPULAR', watchlists: { POPULAR: ['GCZ6', 'SIZ6', 'NQZ6', 'ESZ6'] } });
    }

    if (pathname === '/debug' || pathname === '/api/debug') {
      const debugData = {
        platform: process.platform,
        cwd: process.cwd(),
        isVercel: !!process.env.VERCEL,
        handshake: databaseLinker.getHandshake()
      };
      try {
        const testRes = await databaseLinker.getHistory('GCZ6', '1', 0, 0, 10, true);
        debugData.testHistory = {
          status: testRes.s,
          barCount: testRes.t ? testRes.t.length : 0,
          latestClose: testRes.c ? testRes.c[testRes.c.length - 1] : null
        };
      } catch (e) {
        debugData.testHistoryError = { message: e.message, stack: e.stack };
      }
      return sendJson(200, debugData);
    }

    return sendJson(200, { ok: true, message: 'Database Linker Online (Pure SQL)' });
  } catch (err) {
    return sendJson(500, { error: err.message });
  }
}
