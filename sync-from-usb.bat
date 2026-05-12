@echo off
setlocal EnableDelayedExpansion
SET "PORTABLE_ROOT=%~dp0"
SET "PORTABLE_ROOT=%PORTABLE_ROOT:~0,-1%"

SET "USB_ROOT=%~1"
IF "!USB_ROOT!"=="" SET /P USB_ROOT=USB-Quellpfad (z.B. E:\claude-portable):
IF "!USB_ROOT!"=="" ( echo Kein Pfad. & exit /b 1 )

echo USB:      !USB_ROOT!
echo OneDrive: %PORTABLE_ROOT%
echo.

echo [1/3] USB-Vault-Aenderungen pushen...
git -C "!USB_ROOT!\vault" add -A
git -C "!USB_ROOT!\vault" commit -m "USB session %DATE%" --allow-empty
git -C "!USB_ROOT!\vault" push origin main
IF ERRORLEVEL 1 ( echo WARNUNG: USB-Vault-Push fehlgeschlagen. )

echo [2/3] OneDrive-Vault aktualisieren...
git -C "%PORTABLE_ROOT%\vault" pull --rebase origin main

echo [3/3] Config-Aenderungen vom USB uebernehmen (neuere Dateien gewinnen)...
robocopy "!USB_ROOT!" "%PORTABLE_ROOT%" /E /XO /XD ".git" "vault" /XF ".key" /NFL /NDL /NJH /NJS

echo.
echo Sync von USB abgeschlossen.
endlocal
