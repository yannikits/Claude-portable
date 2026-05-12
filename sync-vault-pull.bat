@echo off
SET "PORTABLE_ROOT=%~dp0"
SET "PORTABLE_ROOT=%PORTABLE_ROOT:~0,-1%"
SET "VAULT=%PORTABLE_ROOT%\vault"

IF NOT EXIST "%VAULT%\.git" (
    echo FEHLER: Vault ist kein Git-Repo.
    exit /b 1
)

echo Aktualisiere Vault von GitHub...
git -C "%VAULT%" pull --rebase origin main
IF ERRORLEVEL 1 ( echo WARNUNG: Pull fehlgeschlagen. & exit /b 1 )
echo Vault aktuell.
