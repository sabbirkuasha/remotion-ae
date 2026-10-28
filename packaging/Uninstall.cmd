@echo off
rem remotion-ae: removes the Remotion Importer panel from every After Effects and the copy in %LOCALAPPDATA%\remotion-ae.
rem Double-click it in the extracted download (any version).
setlocal
title remotion-ae uninstall
cd /d "%~dp0"
if not exist "src\install-panel.ts" cd ..

where node >nul 2>nul
if errorlevel 1 goto nonode

node src\install-panel.ts --uninstall --app-dir "%LOCALAPPDATA%\remotion-ae"
echo.
echo Restart After Effects to remove the panel from the Window menu.
echo.
pause
exit /b

:nonode
echo Node.js was not found. Remove these by hand instead:
echo   %LOCALAPPDATA%\remotion-ae
echo   ...\Adobe After Effects ^<version^>\Support Files\Scripts\ScriptUI Panels\Remotion Importer.jsx
echo.
pause
exit /b 1
