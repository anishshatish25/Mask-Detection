@echo off
echo.
echo ========================================
echo   Starting MaskDetect Backend Server
echo ========================================
echo.
cd /d "%~dp0backend"
echo Starting Flask backend on http://localhost:5000
echo.
echo Press Ctrl+C to stop the server
echo.
python app.py
pause
