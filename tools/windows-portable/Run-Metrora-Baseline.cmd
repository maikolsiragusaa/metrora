@echo off
setlocal
cd /d "%~dp0"

echo Starting Metrora baseline...
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-Metrora-Baseline.ps1"
set "METRORA_EXIT=%ERRORLEVEL%"

echo.
if not "%METRORA_EXIT%"=="0" (
  echo Metrora baseline completed with errors. Keep the generated output for diagnosis.
) else (
  echo Metrora baseline completed successfully.
)
echo.
pause
exit /b %METRORA_EXIT%
