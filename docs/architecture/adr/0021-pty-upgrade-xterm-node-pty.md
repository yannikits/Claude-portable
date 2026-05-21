# ADR-0021 — Full-TTY Chat-View via node-pty + xterm.js mit Package-Sideload

**Status:** Akzeptiert
**Datum:** 2026-05-21
**Bedingt durch:** v1.x — Folge auf ADR-0017 (Chat-View-MVP) und der dort
explizit deferred "Full PTY"-Workitem.

## Kontext

Die v1.2 Chat-View ([ADR-0017](0017-chat-view-mvp-line-buffered.md), PR
#29) ist bewusst line-buffered: `child_process.spawn` mit gepipeden stdio
und einem 500-Line-Ring-Buffer-Log im Renderer. Das funktioniert für
`claude --help`, `--version` und einfache prompt/response-Sessions, fällt
aber sofort um, sobald `claude.exe`:

- einen interaktiven Login-Prompt zeichnet (`claude /login`)
- ein Passwort über `readline.createInterface()` einliest (TTY-Detection
  erkennt die Pipe und schaltet auf non-interactive)
- ANSI-Cursor-Control oder Farbsteuerung benutzt (Renderer rendert
  Escape-Sequences nicht — Log-Lines bleiben rohe Text-Zeilen)
- den Terminal-Resize abfragt (Pipe hat keine cols/rows)

Die v1.2-ADR hat den Tradeoff dokumentiert: PTY-Support braucht
`node-pty` (Native-NAPI-Modul) und xterm.js. Das war für v1.2 zu groß,
hauptsächlich wegen der "node-pty native-build-pain" beim Bundling — die
pkg-basierte Sidecar-Pipeline (`@yao-pkg/pkg` → single-file-EXE) handhabt
Native-Module nicht.

Dieser ADR dokumentiert die Architektur-Entscheidungen für den
v1.x-Upgrade auf vollwertiges TTY-Verhalten.

## Entscheidung

**`node-pty@1.1.0` für PTY-Backend, `@xterm/xterm@6` mit `addon-fit` +
`addon-web-links` für Frontend-Terminal. node-pty wird als komplettes
Package neben den pkg-bundleten Sidecar sideloaded; native `.node`-Files
landen via Tauri's `bundle.resources` im finalen App-Installer.**

### 6 Sub-Entscheidungen

1. **Library:** offizielles Microsoft `node-pty@1.1.0`. Drop-in
   `@homebridge/node-pty-prebuilt-multiarch` ist seit node-pty 1.0 nicht
   mehr nötig — Prebuilds shippen direkt im npm-Package für
   `win32-{x64,arm64}` und `darwin-{x64,arm64}`. Linux hat **kein**
   Prebuild → CI source-builded (Ubuntu hat `build-essential` und Python
   default).

2. **PTY-Mode auf Windows: `useConptyDll: true` (ConPTY via gebündelte
   DLL).** Spike-Validation zeigte einen kritischen pkg-Inkompatibilität:
   node-ptys interner `_getConsoleProcessList()` macht
   `child_process.fork('lib/conpty_console_list_agent.js', [pid])`. In
   einem pkg-Bundle re-spawned `fork()` aber die gesamte Sidecar-EXE
   (weil `process.execPath` darauf zeigt) — das Helper-Script läuft
   nicht. Resultat: `AttachConsole failed`-Crash beim PTY-Kill. Mit
   `useConptyDll:true` benutzt node-pty die mit-gebündelte `conpty.dll`
   + `OpenConsole.exe` und überspringt den Fork-Helper. Win < 10/1809 ist
   out-of-support (kein ConPTY).

3. **Native-Module-Sideload-Strategie: ship das ganze
   `node-pty/`-Package on-disk, nicht nur die `.node`-Files.**
   Begründung: pkg's static-analysis kann
   `createRequire(import.meta.url).require()` nicht tracen — wenn wir
   `require('node-pty')` aufrufen, ist node-pty NICHT im Snapshot
   bundled. Selbst wenn wir es bundleten, würden die relative
   `__dirname`-Pfade in `loadNativeModule()` ins virtuelle Snapshot-FS
   zeigen wo die `.node`-Files unmöglich liegen können (Native-Module
   funktionieren nicht im pkg-Snapshot). Sideload des kompletten
   Packages löst beides in einem: node-ptys eigener
   `loadNativeModule()` findet seine `.node`-Files über die normalen
   relativen Pfade. **Kein Monkey-Patch nötig.**

4. **Sideload-Location: `<sidecar-dir>/node-pty/`** (also neben dem
   Sidecar-Binary). `pty-binding-loader.ts` resolved zur Runtime via
   `dirname(process.execPath) + '/node-pty'`. Env-Override
   `CLAUDE_OS_NODE_PTY_DIR` für custom-deployments. Dev-Fallback:
   `require('node-pty')` aus dem normalen `node_modules/`-Tree, damit
   Unit-Tests ohne Sideload laufen.

5. **Bundle-Size-Optimierung: nur host-arch Prebuilds shippen,
   `.pdb`-Files (Win-Debug-Symbols ~30MB) strippen.** `build-sidecar.ps1`
   und `.sh` mappen das `triple` (z.B. `x86_64-pc-windows-msvc`) auf
   den node-arch-Identifier (`win32-x64`) und kopieren nur das
   passende `prebuilds/<arch>/`-Subdir. macOS universal-Build ruft das
   Script zweimal mit `SIDECAR_TRIPLE`-Override (existing pattern aus
   PR #29) — beide Subdirs (`darwin-x64` + `darwin-arm64`) landen im
   selben `binaries/node-pty/`, Runtime-Resolver wählt via
   `process.arch`.

6. **RPC-Coexistence: neue `pty.*`-Methoden parallel zu den alten
   `chat.*`. Alte Methoden bleiben in v1.x.0 funktional als Legacy-Pfad,
   loggen aber eine Deprecation-Warning bei jedem Aufruf. Entfernung
   frühestens v1.x.+1 (eine Release später).** Die GUI-ChatPage ist
   komplett auf `pty.*` umgestellt — Coexist betrifft nur potentielle
   externe Konsumenten (MCP-Server, Scripts).

### RPC-Surface (neu)

| Method | Params | Result |
|---|---|---|
| `pty.spawn` | `{args: string[], cols?, rows?}` | `{sessionId: string}` |
| `pty.write` | `{sessionId, input: string}` | `{ok: true}` |
| `pty.resize` | `{sessionId, cols, rows}` | `{ok: true}` |
| `pty.kill` | `{sessionId}` | `{ok: true}` |

### Notifications (neu)

- `pty.data` — `{sessionId, data: string}` (raw bytes, ANSI inkl.)
- `pty.exit` — `{sessionId, exitCode: number|null, signal: string|null}`

## Konsequenzen

### Positiv

- **Echtes TTY-Verhalten** — interaktive Prompts (`claude /login`,
  passwords, readline-based menus) funktionieren erstmalig in der GUI.
- **Full ANSI-Support** — Farben, Cursor-Control, Box-Drawing-Chars
  rendern korrekt via xterm.js.
- **Resize-Wahrnehmung** — User vergrößert das Window, `term.cols`/`rows`
  ändern sich, `pty.resize` propagiert das an den child — `tput cols`
  liest korrekt.
- **Keine Monkey-Patches** — der Sideload-Approach hält uns auf der
  öffentlichen node-pty-API. Updates auf node-pty 1.x+ sind drop-in.
- **Bundle-Size moderat** — ~2.6 MB Windows / ~150 KB macOS extra
  (gegenüber dem MVP). Strikt host-arch-Prebuilds halten das in Schach.
- **Forward-Pfad zur xterm-Web-Integration** — xterm.js läuft auch im
  Browser. Wenn wir später eine Web-Variante shippen, ist das
  Frontend-Pattern wiederverwendbar.

### Negativ / Akzeptierte Trade-offs

- **Bundle-Size +2.6 MB** auf Windows. Vorher waren wir bei ~36 MB MSI,
  jetzt ~38.6 MB. Akzeptabel für die UX-Verbesserung.
- **Win10 < 1809 ist out-of-support.** Doctor-Check warnt; Bundle
  installiert sich trotzdem, aber PTY funktioniert nicht ohne ConPTY.
  Pragmatischer Cut — Win10 1809 ist Oktober 2018, sieben Jahre alt.
- **Linux-Builds dauern länger im CI** — node-gyp source-build statt
  Prebuild-Download. ~30s extra pro Job. Akzeptabel.
- **`pty.data` ist single-stream** — keine Trennung von stdout/stderr
  wie bei `chat.output {stream: 'stdout'|'stderr'}`. Das ist
  PTY-Semantik: ein echtes Terminal hat keinen Channel-Split, alles
  fließt durch denselben TTY. Tools die das Splitten brauchen müssen
  weiter `chat.*` benutzen.
- **chat.* deprecation-Pfad braucht eine Release Lifetime** — wir
  können `chat-sessions.ts` nicht sofort löschen ohne externe
  Konsumenten zu brechen. Folge-PR nach v1.x.+1.

### Konstraints für Folge-Phasen

- **node-pty-Major-Bumps** (1.x → 2.x) brauchen Re-Spike — die
  `useConptyDll`-Option könnte umbenannt werden, die prebuild-Layout
  könnte sich ändern. Beide Build-Scripts haben harte Annahmen über
  `prebuilds/<arch>/`-Struktur und müssen mit-gebumpt werden.
- **Linux ARM64-Distros** ohne Prebuild müssen node-gyp + Python im
  Build-Env haben. Bei `ubuntu-22.04-arm` (GitHub-Actions-Linux-ARM-
  Runner) ist das gegeben. Self-hosted Builder müssten das setup'en.
- **Windows-Signing (Phase 8b, ADR-pending)** — ge-shippte `.node`-Files
  sind nicht-signiert. SmartScreen wird das nicht zusätzlich
  bemängeln (die Signing-Reputation hängt am EXE), aber für Enterprise-
  Deployments mit strikten Code-Signing-Policies kann das ein Issue
  werden. Optional: `signtool` über jede `.node` jagen.
- **Bundle.size** könnte über Time wachsen wenn node-pty mehr Files
  shipped. Aktuell ~2.6 MB Windows — Monitoring via CI artifact-list.

## Alternativen verworfen

**Monkey-Patch `node-pty/lib/utils.js loadNativeModule()`:** Erster
Spike-Approach. Idee: env-Var `CLAUDE_OS_PTY_BINDINGS_DIR` zeigt auf
`binaries/native/<arch>/`, der Patch redirected nur die `.node`-Lookups.
Problem: pkg's static-analysis bundleled `node-pty/lib/utils.js` nicht
ins Snapshot, weil `createRequire(import.meta.url).require('node-pty/...')`
keine literal-string-Static-Analyse darstellt. Sidecar konnte
node-pty/lib/utils.js gar nicht erst laden, geschweige denn patchen.
Sideload des kompletten Packages umgeht das Problem komplett.

**Komplette node-pty-Rewrite mit FFI:** Theoretisch könnten wir
ConPTY direkt via Rust-FFI ansprechen und node-pty komplett umgehen.
Zu viel Aufwand für v1.x. Forward-Pfad falls node-pty unmaintained wird,
aber heute überproportional.

**winpty-Fallback für legacy Windows:** ~500KB extra Bundle-Size für
winpty-agent.exe + winpty.dll, plus erheblich komplexere Code-Pfade
in node-pty (zwei spawn-paths). Win10 < 1809 ist sieben Jahre alt —
nicht der Mühe wert.

**Build-from-source statt prebuilds:** Würde MSVC + Python auf jeder
User-Maschine erfordern (für `npm install` Runtime-Setup). Nicht
realistisch für nicht-Dev-User. Sideload löst das.

**Tauri-Plugin statt Node-Sidecar für PTY:** Es gibt `tauri-plugin-pty`,
aber das löst nur die PTY-Spawn-Seite, nicht das Sidecar-Lifecycle.
Würde dual-PTY-Codepaths erzeugen. Sticken mit dem etablierten
sidecar-RPC-Pattern.

## Referenzen

- [ADR-0001](0001-tauri-als-gui-framework.md) — Tauri als GUI-Framework
- [ADR-0006](0006-sidecar-supervision.md) — Sidecar-Lifecycle
- [ADR-0017](0017-chat-view-mvp-line-buffered.md) — v1.2 Chat-View-MVP
  (Vorgänger-Entscheidung)
- `src/sidecar/pty-chat-sessions.ts`
- `src/sidecar/pty-binding-loader.ts`
- `src/sidecar/methods/pty.ts`
- `scripts/build-sidecar.{ps1,sh}`
- `gui/src-tauri/tauri.conf.json` (`bundle.resources`)
- `gui/src/pages/index.tsx` (`ChatPage`)
- [node-pty](https://github.com/microsoft/node-pty) v1.1.0
- [xterm.js](https://github.com/xtermjs/xterm.js) v6.0.0
- [ConPTY-API](https://docs.microsoft.com/en-us/windows/console/pseudoconsoles)
