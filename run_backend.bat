@echo off
title Finevers Market Terminal Backend
cd /d "%~dp0backend"
echo ========================================================
echo   Starting Finevers Real-Time Market Data Engine...
echo   Port: 8000 | WebSocket: ws://localhost:8000/ws/market
echo ========================================================
python app.py
pause
