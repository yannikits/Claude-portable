# ADR-005: Update-Mechanismus Tauri-Bundle

**Status:** Accepted (Konzept) — Detail-Implementierung gated auf Phase 8 / pre-v1.0
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Tauri-App auf Windows-Primary + macOS-Secondary muss aktualisierbar sein. Optionen:
- Tauri-Updater (eingebaut, signiert)
- Eigener Updater (mehr Kontrolle, mehr Code)
- Manuelles Neu-Installieren (überträgt Last auf User)

## Entscheidung

1. **Tauri-Updater als Primary.** Eingebaute Lösung, signiert via Tauri's Updater-Konfiguration.
2. **GitHub-Releases als Update-Source.** `yannikits/Claude-portable` Public-Repo → GitHub-Release-Endpoint serviert das Update-Manifest.
3. **Auto-Check, manuelles Apply.** App checkt auf Update beim Start, zeigt Notification. User klickt "jetzt aktualisieren" — nie silent install.
4. **Channels:** `stable` (default) und `prerelease` (opt-in via Settings). Yannik testet `prerelease`.
5. **Update-Signatur-Key:** generiert vor v1.0, gespeichert in Yanniks Keyring + Offline-Backup.
6. **Sidecar-Update synchron mit App-Update:** Tauri-Bundle enthält Sidecar als externalBin, ein Update-Bundle = beide Komponenten.

**Code-Signing:** offen — entscheiden vor v1.0 ob:
- Windows-Signing-Cert (~€200/Jahr, kein SmartScreen-Warning)
- macOS-Apple-Developer-ID (~$99/Jahr, kein Gatekeeper-Block)
- Beide oder keins (kein Signing = User muss SmartScreen/Gatekeeper bypassen)

Empfehlung für später: erst Windows-Cert (Yannik-Primary), macOS später bei Bedarf.

## Konsequenzen

- Phase 8-DoD ergänzt um "Update von v0.x.0 auf v0.x.1 funktioniert end-to-end"
- Update-Manifest-Format Tauri-Standard (keine eigene Spec)
- Bei Sidecar-Bug ist Atomic-Update wichtig — kein gemischter Zustand (alte App + neuer Sidecar)

## Alternativen erwogen

- **Eigener Updater:** verworfen — Tauri-Built-in deckt 95 % der Bedürfnisse
- **Squirrel/MSI-Auto-Update:** verworfen — Tauri hat das schon abstrahiert
- **Kein Auto-Update:** verworfen — User-Last zu hoch, Update-Adoption zu langsam
