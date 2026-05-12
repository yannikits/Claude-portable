# Claude Portable

Claude Code portabel — lauffähig von OneDrive oder USB-Stick, keine Installation nötig.

## Ersteinrichtung (einmalig, auf Master-PC)

```bat
setup.bat
```

Richtet portable Node.js, npm-Pakete, Claude-Binary und API-Key-Verschlüsselung ein.

## Starten

```bat
start.bat
```

Fragt Passwort ab, startet Claude. Beim Beenden wird alles aufgeräumt.

## Vault synchronisieren

```bat
sync-vault-pull.bat   :: Neueste Notizen holen (vor Session)
sync-vault-push.bat   :: Änderungen speichern (nach Session)
```

## Auf USB-Stick kopieren

```bat
sync-to-usb.bat E:\claude-portable
```

## Von USB zurück synchronisieren

```bat
sync-from-usb.bat E:\claude-portable
```

## GitHub-Remote nachträglich setzen

```bat
cd vault
git remote add origin https://github.com/DEIN_USERNAME/obsidian-vault-privat
git push -u origin main
```

## Vault-Inhalt beim ersten Push (falls bereits Notizen vorhanden)

```bat
robocopy "C:\Users\%USERNAME%\OneDrive - Privatperson\Obsidian\Claude-Knowledge" vault /E
cd vault
git add -A
git commit -m "init: vault aus bestehendem Obsidian"
git push -u origin main
```
