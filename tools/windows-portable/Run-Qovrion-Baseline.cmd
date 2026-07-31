@echo off
setlocal
cd /d "%~dp0"

echo Starting Qovrion baseline...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Qovrion-Baseline.ps1"
set "QOVRION_EXIT=%ERRORLEVEL%"

echo.
if not "%QOVRION_EXIT%"=="0" (
  echo Qovrion baseline completed with errors. Keep the generated output for diagnosis.
) else (
  echo Qovrion baseline completed successfully.
)
echo.
pause
exit /b %QOVRION_EXIT%
