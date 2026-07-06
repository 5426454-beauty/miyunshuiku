@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ================================================
echo    Miyun Reservoir - One-Click Startup
echo ================================================
echo.

REM --- [1/3] Frontend ---
echo [1/3] Starting Frontend (Vite, port 5173)...
start "Frontend :5173" cmd /k "cd /d %CD% && npm run dev"

REM --- [2/3] Backend ---
echo [2/3] Starting Backend API (Express, port 3001)...
start "Backend :3001" cmd /k "cd /d %CD% && npm run dev:server"

REM --- [3/3] Map Agent ---
echo [3/3] Starting Map Agent (Python, port 8000)...
if exist "map-agent\main.py" (
    start "MapAgent :8000" cmd /k "cd /d %CD%\map-agent && python main.py"
) else (
    echo   [!] map-agent folder not found, skipped
)

echo.
echo ================================================
echo   All services launched!
echo.
echo   Frontend:   http://localhost:5173
echo   Backend:    http://localhost:3001
echo   Map Agent:  http://localhost:8000
echo.
echo   Close this window freely - services keep running
echo ================================================
echo.

pause