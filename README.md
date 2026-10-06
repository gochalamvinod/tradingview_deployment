# TradingView Terminal — Pure SQL Engine

High-performance TradingView Advanced Charting Terminal powered by a **Pure SQLite Time-Series Database Linker**.

- **100% Offline & Pure SQL:** Queries over 1.5M+ institutional historical bars stored across dedicated SQLite WAL databases in `/database/`.
- **Zero External Dependencies:** No Tradovate bridges, no downloader daemons, no background scrapers, no API keys or credentials required.
- **Dual-Driver Engine:** Uses high-speed native `better-sqlite3` locally, and falls back automatically to WebAssembly `sql.js` on serverless environments.
- **Vercel & Cloud Ready:** Pre-configured with `vercel.json` and serverless API handlers in `/api/index.js` for 1-click deployment on Vercel.

---

## Supported Contracts & Timeframes

- **Gold:** `GCZ6` (Dec 2026), `GC1!` (Continuous)
- **Silver:** `SIZ6` (Dec 2026), `SI1!` (Continuous)
- **Nasdaq:** `NQZ6` (Dec 2026), `NQ1!` (Continuous)
- **S&P 500:** `ESZ6` (Dec 2026), `ES1!` (Continuous)

### 13 Fixed Resolutions
`1S`, `5S`, `15S`, `30S`, `1`, `3`, `5`, `15`, `30`, `60`, `1D`, `1W`, `1M`

---

## Quick Start (Local)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Terminal
```bash
npm start
```
*Or double-click `start.bat` on Windows.*

Open [http://localhost:9000](http://localhost:9000) in your browser.

---

## Deploy to Vercel

1. Push this repository to GitHub:
   ```bash
   git push origin main
   ```
2. Import the repository in [Vercel](https://vercel.com).
3. Vercel will automatically detect `vercel.json` and deploy both the static frontend and the `/api` serverless database linker.
