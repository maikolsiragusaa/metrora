@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Invoke-Metrora-Windows-Physical-Acceptance.ps1" -RepositoryRoot "%~dp0"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo Il test si e' fermato in sicurezza. Leggi il messaggio sopra.
pause
exit /b %EXITCODE%
