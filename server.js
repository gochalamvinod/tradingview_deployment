/**
 * TradingView Terminal - High-Performance Pure SQL Server (server.js)
 * 
 * Serves frontend static application and pure SQLite time-series data.
 * Zero external API dependencies. Zero credentials needed.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
import { databaseLinker } from './databaseLinker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || process.env.WEBSITE_PORT || '9000', 10);
const DIST_DIR = path.join(__dirname, 'dist');
const WATCHLIST_CONFIG_PATH = path.join(__dirname, 'watchlist_config.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

function serveStaticFile(req, res, filePath) {
  if (!fs.existsSync(filePath)) {
    // Single-page application fallback
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveStaticFile(req, res, indexPath);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('File not found');
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return serveStaticFile(req, res, path.join(filePath, 'index.html'));
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  const acceptEncoding = (req.headers['accept-encoding'] || '').toLowerCase();

  const headers = {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400'
  };

  if (acceptEncoding.includes('gzip') && stat.size > 1024) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    const raw = fs.createReadStream(filePath);
    const gzip = zlib.createGzip({ level: 6 });
    return raw.pipe(gzip).pipe(res);
  }

  headers['Content-Length'] = stat.size;
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  // Global CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsed = new URL(req.url || '/', 'http://localhost');
  const pathname = parsed.pathname || '/';
  const query = Object.fromEntries(parsed.searchParams.entries());

  try {
    // 1. High-precision Time Endpoint
    if (pathname === '/time' || pathname === '/api/time') {
      const sec = (Date.now() / 1000).toFixed(3);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      return res.end(sec);
    }

    // 2. TradingView Config
    if (pathname === '/config' || pathname === '/api/config') {
      return sendJson(res, 200, databaseLinker.getConfig());
    }

    // 3. Symbol Metadata
    if (pathname === '/symbols' || pathname === '/api/symbols') {
      const sym = query.symbol || 'GCZ6';
      return sendJson(res, 200, databaseLinker.getSymbolInfo(sym));
    }

    // 4. Pure SQL History Endpoint
    if (pathname === '/history' || pathname === '/api/history') {
      const symbol = query.symbol || 'GCZ6';
      const resolution = query.resolution || '1';
      const from = Number(query.from) || 0;
      const to = Number(query.to) || 0;
      const countback = Number(query.countback) || 500;
      const isFirst = query.firstDataRequest === 'true' || query.firstDataRequest === true || (!from && !to);

      const history = await databaseLinker.getHistory(symbol, resolution, from, to, countback, isFirst);
      return sendJson(res, 200, history);
    }

    // 4.5 Pure SQL Market Replay / Backtest Endpoints
    if (pathname === '/replay-activate' || pathname === '/api/replay-activate') {
      const sessionId = `replay_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      return sendJson(res, 200, { ok: true, sessionId, status: 'REPLAY_ACTIVE' });
    }

    if (pathname === '/replay-history' || pathname === '/api/replay-history') {
      const symbol = query.symbol || 'GCZ6';
      const resolution = query.resolution || '1';
      const currentReplayTime = Number(query.currentReplayTime) || 0;
      const cutTimestamp = Number(query.cutTimestamp) || 0;
      const from = Number(query.from) || 0;
      const to = Number(query.to) || 0;
      const firstDataRequest = query.firstDataRequest === 'true' || query.firstDataRequest === true || (!from && !to);
      const countback = Number(query.countback) || 500;

      const history = await databaseLinker.getReplayHistory(symbol, resolution, currentReplayTime, cutTimestamp, from, to, firstDataRequest, countback);
      return sendJson(res, 200, history);
    }

    if (pathname === '/replay-confirm' || pathname === '/api/replay-confirm') {
      return sendJson(res, 200, { success: true, confirmed: true });
    }

    if (pathname === '/replay-deactivate' || pathname === '/api/replay-deactivate') {
      return sendJson(res, 200, { ok: true, status: 'REPLAY_INACTIVE' });
    }

    // 5. Quotes Endpoint
    if (pathname === '/quotes' || pathname === '/api/quotes') {
      const quotes = await databaseLinker.getQuotes(query.symbols || query.symbol || 'GCZ6');
      return sendJson(res, 200, quotes);
    }

    // 6. Search Endpoint
    if (pathname === '/search' || pathname === '/api/search') {
      const results = databaseLinker.searchSymbols(query.query || '', Number(query.limit) || 30);
      return sendJson(res, 200, results);
    }

    // 7. Handshake / Status Endpoint
    if (pathname === '/handshake' || pathname === '/api/handshake' || pathname === '/status' || pathname === '/api/status') {
      return sendJson(res, 200, databaseLinker.getHandshake());
    }

    // 8. Watchlist API
    if (pathname === '/api/watchlist') {
      if (fs.existsSync(WATCHLIST_CONFIG_PATH)) {
        try {
          const cfg = JSON.parse(fs.readFileSync(WATCHLIST_CONFIG_PATH, 'utf-8'));
          return sendJson(res, 200, cfg);
        } catch {}
      }
      return sendJson(res, 200, { defaultWatchlist: 'POPULAR', watchlists: { POPULAR: ['GCZ6', 'SIZ6', 'NQZ6', 'ESZ6'] } });
    }

    if (pathname === '/api/watchlist/add' || pathname === '/api/watchlist/remove') {
      return sendJson(res, 200, { ok: true });
    }

    // 8.5 Real-Time SSE Quote Stream
    if (pathname === '/api/quote-stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write(': ok\n\n');
      const timer = setInterval(async () => {
        try {
          const quotes = await databaseLinker.getQuotes(['GCZ6', 'SIZ6', 'NQZ6', 'ESZ6']);
          if (quotes && quotes.d) {
            for (const q of quotes.d) {
              res.write(`data: ${JSON.stringify({ symbol: q.n, lp: q.v.lp, bid: q.v.bid, ask: q.v.ask, spread: q.v.spread })}\n\n`);
            }
          }
        } catch {}
      }, 3000);
      req.on('close', () => clearInterval(timer));
      return;
    }

    // 9. Static Assets (Frontend)
    let sanitizedPath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (sanitizedPath === '/' || sanitizedPath === '\\') sanitizedPath = '/index.html';
    const filePath = path.join(DIST_DIR, sanitizedPath);

    return serveStaticFile(req, res, filePath);
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    return sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================================');
  console.log(`  TRADINGVIEW TERMINAL ONLINE: http://localhost:${PORT}`);
  console.log('================================================================================');
  console.log('  Pure SQL Time-Series Engine & Database Linker');
  console.log('  Zero External APIs. Instant Offline Execution.');
  console.log('================================================================================');
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});

export default server;
