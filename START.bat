@echo off
setlocal
title MaskGuard AI — Startup

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║         MaskGuard AI — Starting Up...           ║
echo  ╚══════════════════════════════════════════════════╝
echo.

:: ── Kill any existing processes on ports 5000 and 8000 ──
echo [1/4] Clearing old processes on ports 5000 and 8000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000 " 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── Check Python ──────────────────────────────────────────
echo [2/4] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python not found. Install Python 3.9+ from python.org
    pause
    exit /b 1
)
python --version

:: ── Install requirements ──────────────────────────────────
echo [3/4] Installing backend requirements (this may take a minute)...
pip install flask flask-cors opencv-python Pillow numpy --quiet --disable-pip-version-check 2>nul

:: ── Start Flask Backend on port 5000 ──────────────────────
echo [4/4] Starting Flask backend on http://localhost:5000 ...
start "MaskGuard Backend" cmd /k "cd /d "%~dp0backend" && python app.py"

:: ── Start Frontend HTTP server on port 8000 ───────────────
echo.
echo  Starting frontend server on http://localhost:8000 ...
start "MaskGuard Frontend" cmd /k "cd /d "%~dp0" && python -m http.server 8000"

:: ── Wait for servers to start ─────────────────────────────
echo  Waiting for servers to start...
timeout /t 3 /nobreak >nul

:: ── Open browser ──────────────────────────────────────────
echo  Opening browser...
start chrome "http://localhost:8000/index.html" 2>nul || start "" "http://localhost:8000/index.html"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║  MaskGuard AI is running!                       ║
echo  ║                                                  ║
echo  ║  Frontend : http://localhost:8000/index.html    ║
echo  ║  Backend  : http://localhost:5000               ║
echo  ║  Health   : http://localhost:5000/health        ║
echo  ║                                                  ║
echo  ║  Close this window or press Ctrl+C to stop.     ║
echo  ╚══════════════════════════════════════════════════╝
echo.
pause
