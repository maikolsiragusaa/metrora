@echo off
setlocal
cd /d "%~dp0"
for %%I in ("%~dp0.") do set "REPOSITORY_ROOT=%%~fI"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Invoke-Metrora-Windows-UX-Acceptance.ps1" -RepositoryRoot "%REPOSITORY_ROOT%"
set "EXITCODE=%ERRORLEVEL%"
echo.
if not "%EXITCODE%"=="0" echo Il collaudo UX si e' fermato in sicurezza. Leggi il messaggio sopra.
pause
exit /b %EXITCODE%
