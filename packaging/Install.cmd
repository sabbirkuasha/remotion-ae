@echo off
rem remotion-ae setup: copies remotion-ae to %LOCALAPPDATA%\remotion-ae and adds the Remotion Importer panel to
rem every installed After Effects. Double-click it in the extracted download. Run it again to update.
setlocal
title remotion-ae setup
cd /d "%~dp0"
rem in the repository this file is in packaging\, in the download it is next to src\
if not exist "src\install-panel.ts" cd ..

echo remotion-ae: Remotion animations to After Effects layers
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "const [a, b] = process.versions.node.split('.').map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)"
if errorlevel 1 goto oldnode

node src\install-panel.ts --app-dir "%LOCALAPPDATA%\remotion-ae"
if errorlevel 1 goto failed

echo.
echo Done. Next:
echo   1. In After Effects: Edit ^> Preferences ^> Scripting ^& Expressions,
echo      turn on "Allow Scripts to Write Files and Access Network".
echo   2. Restart After Effects and open Window ^> Remotion Importer.jsx.
echo.
echo You can delete this downloaded folder now.
echo.
pause
exit /b 0

:nonode
echo Node.js is not installed. remotion-ae needs Node.js 22.18 or newer.
echo Opening nodejs.org: install the LTS version, then double-click Install.cmd again.
start "" https://nodejs.org/
echo.
pause
exit /b 1

:oldnode
for /f %%v in ('node --version') do set NODE_VERSION=%%v
echo Node.js %NODE_VERSION% is too old. remotion-ae needs Node.js 22.18 or newer.
echo Opening nodejs.org: install the LTS version, then double-click Install.cmd again.
start "" https://nodejs.org/
echo.
pause
exit /b 1

:failed
echo.
echo Setup did not finish; see the messages above.
echo.
pause
exit /b 1
