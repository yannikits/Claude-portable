@echo off
setlocal EnableDelayedExpansion
SET "PORTABLE_ROOT=%~dp0"
SET "PORTABLE_ROOT=%PORTABLE_ROOT:~0,-1%"

SET "USB_ROOT=%~1"
IF "!USB_ROOT!"=="" SET /P USB_ROOT=USB-Zielpfad (z.B. E:\claude-portable):
IF "!USB_ROOT!"=="" ( echo Kein Pfad. & exit /b 1 )

echo Quelle: %PORTABLE_ROOT%
echo Ziel:   !USB_ROOT!
echo.

echo [1/3] Vault pushen...
call "%PORTABLE_ROOT%\sync-vault-push.bat"

echo [2/3] Dateien kopieren...
robocopy "%PORTABLE_ROOT%" "!USB_ROOT!" /MIR /XD ".git" /XF ".key" /NFL /NDL /NJH /NJS

echo [3/3] .key kopieren (verschluesselt)...
copy /Y "%PORTABLE_ROOT%\.key" "!USB_ROOT!\.key"

echo.
echo USB-Sync abgeschlossen.
endlocal
