@echo off
REM -----------------------------------------------------------------
REM  Layer Lama -- Portfolio Admin launcher
REM  Double-click to start. First run installs dependencies.
REM  Browser opens automatically once the server is ready.
REM  Stop the server with Ctrl+C in this window.
REM -----------------------------------------------------------------

title Layer Lama - Portfolio Admin
cd /d "%~dp0\tools\portfolio-admin"

if not exist "node_modules" (
    echo.
    echo  First run -- installing dependencies. This takes about a minute...
    echo.
    call npm.cmd install
    if errorlevel 1 (
        echo.
        echo  npm install failed. Press any key to close.
        pause >nul
        exit /b 1
    )
)

if not exist ".env" (
    echo.
    echo  WARNING: .env file not found.
    echo  Notion mirroring will be disabled. Image upload + git push still work.
    echo  To enable Notion: copy .env.example to .env and add NOTION_TOKEN.
    echo.
)

call npm.cmd start

echo.
echo  Server stopped. Press any key to close this window.
pause >nul
