# ADR-0028 — Tauri-Updater für Windows + macOS Self-Update

**Status:** Akzeptiert (Konzept) — Implementation gated auf pre-v1.0
**Datum:** 2026-05-24
**Bedingt durch:** Ergänzung zu ADR-0018 (AppImage-zsync für Linux)

## Kontext

ADR-0018 löst Self-Update für Linux via standalone-`zsync`. Windows und macOS sind noch offen:

- Windows: aktuell MSI-Bundle via Tauri-CI, aber kein Auto-Update-Trigger
- macOS: DMG aus Tauri-CI, kein Update-Mechanismus

Solo-Dev-Realität: Yannik will nicht auf jedem Update einen "lade neuste Version"-Manual-Step durchlaufen müssen.

## Entscheidung

**Tauri-Updater (`tauri-plugin-updater`) mit GitHub-Release als Manifest-Source — für Windows und macOS.** Linux bleibt bei ADR-0018-zsync (besser für AppImage-Lifecycle).

### Setup

1. **Update-Manifest** unter `releases/latest.json` im Public-Repo:
   ```json
   {
     "version": "1.x.y",
     "notes": "Changelog snippet",
     "pub_date": "2026-..",
     "platforms": {
       "windows-x86_64": {"signature": "...", "url": "https://github.com/.../claude-os_x.y.z_x64-setup.msi"},
       "darwin-x86_64": {"signature": "...", "url": "..."},
       "darwin-aarch64": {"signature": "...", "url": "..."}
     }
   }
   ```

2. **Signing-Key** generiert via `tauri signer generate`, Private-Key im Keyring (ADR-0004) gespeichert, Offline-Backup auf USB-Stick.

3. **Channels:** `stable` (default) und `prerelease` (opt-in). Yannik testet `prerelease`.

4. **Auto-Check, manuelles Apply.** Beim App-Start wird das Manifest geprüft, GUI zeigt Notification. User klickt „jetzt aktualisieren" — niemals silent install.

5. **Sidecar-Update synchron mit App-Update.** Tauri-Bundle enthält Sidecar als externalBin (ADR-0006), ein Update-Bundle = beide Komponenten.

### Linux-Trennung

Linux nutzt weiterhin ADR-0018-zsync, weil:
- AppImage-Lifecycle anders ist (in-place statt Reinstall)
- `tauri-plugin-updater` für AppImage instabil dokumentiert ist
- Doppel-Mechanismus erlaubt OS-spezifische Optimierung

### Code-Signing

Offen vor v1.0:
- Windows-Signing-Cert (~€200/Jahr): kein SmartScreen-Warning
- macOS-Apple-Developer-ID (~$99/Jahr): kein Gatekeeper-Block, dazu Notarization-Pipeline

Empfehlung für später (eigenes ADR vor v1.0): erst Windows-Cert (Yannik-Primary), macOS bei Bedarf.

## Konsequenzen

**Positiv**

- Win/Mac werden auto-update-fähig
- Bestehende ADR-0018-Linux-Pipeline bleibt unverändert
- Single-Manifest-Format für Win + Mac (Tauri-Standard)

**Negativ**

- Code-Signing-Frage bleibt offen → User sieht SmartScreen/Gatekeeper-Warnung bei jedem Update bis Signing kommt
- GitHub-Rate-Limit für Manifest-Reads (5000/h authenticated) — bei Solo-User kein Thema, aber bei Verbreitung beachten
- Update-Manifest in Public-Repo bedeutet, jeder sieht Release-History

## Alternativen verworfen

- **Eigener Update-Server:** verworfen — Ops-Overhead, kein Mehrwert gegenüber GitHub-Release
- **Kein Auto-Update für Win/Mac:** verworfen — User-Last zu hoch, Update-Adoption zu langsam
- **Squirrel.Windows / Sparkle.framework direkt:** verworfen — Tauri-Plugin abstrahiert beide schon
- **Linux per Tauri-Updater statt zsync:** verworfen — siehe ADR-0018-Begründung

## Quellen

- ADR-0006 (Tauri-Sidecar als externalBin)
- ADR-0018 (Linux AppImage zsync)
- ADR-0004 (Keyring für Signing-Key)
- [tauri-plugin-updater Docs](https://v2.tauri.app/plugin/updater/)
