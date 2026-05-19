# Linux Updates — AppImage Self-Update via zsync

claude-os v1.3+ shipped für Linux ein zusätzliches `.zsync`-File neben dem
`.AppImage` auf jeder GitHub-Release. Damit kann `appimageupdatetool` differentielle
Updates ziehen — nur die geänderten Blöcke werden runtergeladen statt der vollen
Datei (typisch 5-15 MB statt ~80 MB).

## Einmaliges Setup

### Variante A — Distribution-Paket (Debian/Ubuntu)

```bash
sudo apt-get install -y appimageupdate
```

### Variante B — Direkt von GitHub (empfohlen, immer aktuell)

```bash
mkdir -p ~/.local/bin
wget -O ~/.local/bin/appimageupdatetool \
  https://github.com/AppImageCommunity/AppImageUpdate/releases/download/continuous/appimageupdatetool-x86_64.AppImage
chmod +x ~/.local/bin/appimageupdatetool
# ~/.local/bin sollte in $PATH sein
```

## Update einspielen

```bash
appimageupdatetool ~/Apps/Claude-OS-*.AppImage
```

Das Tool liest das eingebettete `.zsync`-Metadatum, lädt nur die Differenz
zur neuen Version aus dem GitHub-Release und schreibt das Update in-place.
Backup der alten Version landet als `Claude-OS-*.AppImage.zs-old` daneben.

## Verifikation

```bash
~/Apps/Claude-OS-*.AppImage --version
```

## Fallback (manuelles Update)

Wenn du `appimageupdatetool` nicht installieren willst, kannst du jederzeit
das neue `.AppImage` direkt aus dem GitHub-Release herunterladen und das
alte überschreiben — dann allerdings ohne Delta-Optimierung (volle ~80 MB).

```bash
wget -O ~/Apps/Claude-OS.AppImage \
  https://github.com/yannikits/Claude-portable/releases/latest/download/Claude-OS-x86_64.AppImage
chmod +x ~/Apps/Claude-OS.AppImage
```

## Limits

- v1.3 ist die erste Version mit zsync — der erste delta-Update-Roundtrip
  wird funktionieren ab v1.3 → v1.4 (vorher kein zsync vorhanden).
- AppImage muss vom selben Release-Stream kommen (`yannikits/Claude-portable`).
  Fork-Builds haben eigene zsync-Metadaten und sind nicht kreuzkompatibel.
- Signierte AppImages (zukünftig) erfordern die selbe GPG-Key-ID auf beiden
  Seiten — Update-Refusal bei Key-Mismatch ist Sicherheitsfeature.
