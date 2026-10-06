@echo off
chcp 65001 >nul
title TradingView Terminal - Pure SQL
cd /d "%~dp0"

echo ===============================================================================
echo TRADINGVIEW TERMINAL - PURE SQL ENGINE
echo ===============================================================================
echo.
echo Launching Terminal Server on http://localhost:9000...
start http://localhost:9000
node server.js
