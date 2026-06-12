@echo off
echo.
echo ========================================
echo   Starting MaskDetect Frontend Server
echo ========================================
echo.
cd /d "%~dp0frontend"
echo Starting HTTP server on http://127.0.0.1:8000
echo.
echo Open your browser and navigate to:
echo   http://127.0.0.1:8000/index.html
echo.
echo Press Ctrl+C to stop the server
echo.
python -m http.server 8000 --bind 127.0.0.1
pause
