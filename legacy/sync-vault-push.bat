@echo off
SET "PORTABLE_ROOT=%~dp0"
SET "PORTABLE_ROOT=%PORTABLE_ROOT:~0,-1%"
SET "VAULT=%PORTABLE_ROOT%\vault"

IF NOT EXIST "%VAULT%\.git" (
    echo FEHLER: Vault ist kein Git-Repo. Bitte setup.bat ausfuehren.
    exit /b 1
)

echo Synchronisiere Vault nach GitHub...
git -C "%VAULT%" add -A
git -C "%VAULT%" commit -m "sync %DATE% %TIME%" --allow-empty
git -C "%VAULT%" push origin main
IF ERRORLEVEL 1 (
    echo WARNUNG: Push fehlgeschlagen. Internet oder Remote pruefen.
    exit /b 1
)
echo Vault gepusht.
