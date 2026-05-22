# ADR-0023 — GUI Profile-Create/Delete + Native Password-Input via tinyfiledialogs

**Status:** Akzeptiert
**Datum:** 2026-05-22
**Bedingt durch:** v1.x.+2 — Followup auf ADR-0022 §6 ("Profile-create/
delete bleiben CLI-only") und §7 ("Secret-Wert lebt waehrend Eingabe im
Renderer-RAM — Mitigation via Warn-Banner + clear-on-submit war
v1.x-Material; permanent-Loesung ist v2-Material").

## Kontext

PR #96 brachte GUI-Mutation fuer Profile-Switch und Secret-Set, liess
aber zwei Items als Followup offen:

1. **Profile create/delete blieben CLI-only.** Irreversible Actions
   brauchen Confirmation-UX die wir noch nicht hatten. User musste
   ueber `claude-os auth profile create/delete <name>` in die CLI
   wechseln.
2. **Secret-Wert lebte waehrend Eingabe im Renderer-RAM.** Tauri-
   WebView ist im prod-Build ohne DevTools, aber dev/debug-Builds
   exponieren das. Mitigation via `<input type="password">` +
   clear-on-submit war ein UX-Hack; eine echte Loesung ohne
   Renderer-touch wurde explizit als v2-Material annonciert.

Beide Items sind in einem PR adressiert (mit ADR-0023). Profile-CRUD
ist additiv zu `settings.activateProfile` aus ADR-0022; Native Password
nutzt einen ganz neuen Tauri-command + tinyfiledialogs-crate.

## Entscheidung

**Zwei neue RPCs (`settings.createProfile` + `settings.deleteProfile`)
+ zwei Modal-Components fuer Profile-Mgmt; plus ein neuer Tauri-command
`set_secret_native` der `tinyfiledialogs::password_box` via
`spawn_blocking` aufruft und das Secret direkt in `secrets.set`
forwarded — der Wert beruehrt nie den Renderer-JS-Heap.**

### 4 Sub-Entscheidungen

1. **Profile-CRUD via `settings.*` Namespace** (statt separater
   `auth.profile.*`). Konsistent mit der `settings.activateProfile`-
   Entscheidung aus ADR-0022 §5: Profil-State liegt im
   `settings.read`-Output, Mutation gehoert in denselben Namespace.

2. **Delete-Profile refused wenn `name === activeProfile`**. Wir
   koennten beim Delete den active-Marker auto-clearen — das wuerde
   aber den User ueberraschen ("ich hatte work aktiv und jetzt steh
   ich auf default?"). Sauberer: Delete-Modal bietet ueberhaupt
   keinen Loesch-Button fuer das aktive Profil; UI-Hinweis "Aktives
   Profil kann nicht geloescht werden — wechsle zuerst." Backend
   surfacet die selbe Regel als safety-net.

3. **GitHub-Style "type-to-confirm"** im Delete-Modal: User muss den
   exakten Profilnamen ins confirm-Input typen. Loesch-Button bleibt
   disabled bis match. Case-sensitive. Defense gegen mis-click bei
   einer irreversible Aktion (loescht configDir inkl.
   `.credentials.json`).

4. **Native Password-Input via `tinyfiledialogs`-crate** statt eines
   hardened Tauri-WebView-Sub-Windows. Begruendung:
   - tinyfiledialogs nutzt **OS-native APIs** (Win32 MessageBox-style,
     macOS NSAlert, Linux zenity/kdialog/matedialog/qarma) → kein
     WebView, kein JS-heap, keine DevTools-attach-Moeglichkeit.
   - Cross-platform aus einer Crate (~50KB) statt drei platform-
     spezifischen Implementations.
   - `password_box(title, message) -> Option<String>` API ist
     primitives-only — kein dependency-graph-Ueberraschungen.
   - Hardened-Sub-Window haette zwar matched-styling mit der Tauri-
     App-UI, aber dafuer weiterhin einen JS-heap und damit Attack-
     Surface fuer DevTools-bridges. Native dialog hat den
     Sicherheitsvorteil signifikant > der Styling-Konsistenz-Verlust.

5. **`set_secret_native(key)` Tauri-command, NICHT
   `set_secret_native(key, password)`** — der Wert wird NIE durch
   den invoke-payload reingegeben. Stattdessen oeffnet das Rust-side
   Command den native dialog, holt den Wert im `spawn_blocking`-Task
   und forwarded ihn direkt in die existierende `secrets.set` RPC
   via `SidecarRpc.call("secrets.set", {key, value})`. Der Renderer
   bekommt nur `{key, backend, updated}` zurueck — der eingegebene
   Wert taucht NIE im Return-Path auf.

6. **Linux-Fallback bei fehlendem Native-Dialog**: `set_secret_native`
   probet einmalig (via `once_cell::sync::Lazy`) auf Linux per
   `which zenity/kdialog/matedialog/qarma`. Wenn keiner gefunden,
   returnt der Command typed error `'dialog-unavailable'`. Frontend
   detected diesen specific-error und schaltet die Modal-UI auto auf
   Inline-Mode + zeigt einen Hinweis-Banner. Auf Windows und macOS
   ist der Dialog OS-built-in; kein Probe noetig.

7. **Mode-Toggle in SecretAddModal mit localStorage-Persistenz**:
   "Native OS-Dialog (empfohlen)" vs "Inline-Input (Fallback)".
   Default Native. User-choice persistet in
   `localStorage['secret-input-mode']`. Inline-Mode bleibt als
   bestaender Flow aus PR #96 verfuegbar fuer headless-CI, Tests
   und OS ohne dialog-binary.

## Konsequenzen

### Positiv

- **Profile-Management komplett im GUI moeglich.** Daily-Use-Flow
  (login → profile create → switch → another login → delete old) ist
  end-to-end ohne CLI-Wechsel.
- **Echtes secret-handling-no-renderer-touch.** Der einzige Code-Pfad
  in dem der Wert lebt ist `rust::spawn_blocking::tinyfiledialogs ->
  rust::Future -> SidecarRpc::call(value via serde_json)`. Renderer
  bekommt nur den Result-Status zurueck. DevTools-attacks gegen den
  Renderer-Heap koennen den Wert NICHT mehr abfischen.
- **Type-to-confirm verhindert versehentliche Loeschungen.** Mirror
  der GitHub-Repo-Delete-UX, die User wahrscheinlich schon kennen.
- **Auto-Fallback auf Linux** macht die Native-Mode-Default
  sicher selbst auf headless-Linux ohne dialog-binary.

### Negativ / Akzeptierte Trade-offs

- **Native-Dialog UI fuehlt sich disjointed an gegenueber der Tauri-
  App.** Auf jedem OS sieht der Dialog anders aus (Win32 styling vs
  macOS sheet vs Linux GTK). Acceptable Trade-off vs Security-Gewinn;
  User-Education via Toggle-Label "(empfohlen)".
- **tinyfiledialogs ist C-binding** und damit eine native dep mit
  unsigned binaries pro Plattform. Tauri-Codesigning (v1.3 ADR-pending)
  muss das hier mit einschliessen.
- **Profile-create/delete CLI bleibt parallel.** Koennte Drift werden
  wenn jemand die CLI-Logik aendert ohne RPC-Logik. Beide Pfade
  wrappen aber `ProfileManager.create/delete()` — single source of
  truth ist die domain-Klasse.
- **Mode-Toggle macht UI etwas voller.** Zwei Radios + zwei warn-
  banner (kontextuell) sind mehr UI-state als die v1.x.+1-Variante.
  Lohn ist die User-Wahl + transparenz ueber den Sicherheits-Modus.

### Konstraints fuer Folge-Phasen

- **Tauri-Codesigning v1.3+** muss tinyfiledialogs binaries mit-signen
  (binary-walk via tauri-action).
- **`set_secret_get_native` als Folge-PR**: das gleiche Pattern liesse
  sich fuer ein "Reveal Secret Value via native dialog" anwenden.
  v2-material.
- **Profile-name-rename** waere ein natuerliches drittes CRUD-op,
  fehlt aber bewusst — `ProfileManager` hat noch keine `rename()`-
  Methode. Folge-PR braucht erst die domain-Erweiterung.
- **Dialog-Abuse-Protection**: Wenn ein malicious Renderer den Tauri-
  command rapidly invoked (z.B. denial-of-service via dialog-spam),
  haben wir aktuell keine Rate-limit. Single-user-desktop-app, low
  risk; sollte aber gemerkt sein wenn jemand Mehrnutzer-Szenarien
  oeffnet.

## Alternativen verworfen

**Hardened Tauri-Sub-Window mit eigenem WebView fuer password-input:**
Wuerde zwar matched-styling bringen, hat aber weiterhin einen JS-heap
und damit Attack-Surface. Mehr Code (eigener Window-Lifecycle,
IPC-channel, devtools-disable-config) fuer weniger Sicherheit.

**Tauri-plugin-dialog (offizielles Tauri-Plugin):** hat nur
`ask()`/`confirm()`-message-boxes, NICHT `password()`. Out.

**`rfd`-crate (Rust File Dialog):** populaer fuer File/Folder/Message,
hat aber kein password-input. Auf macOS / Windows haetten wir
plattform-spezifische native APIs aufrufen muessen.

**Auto-clearing localStorage password:** Wert im Renderer halten,
aber sofort nach submit aus localStorage entfernen. Adressiert nicht
die DevTools-attack-Surface waehrend der Eingabe.

**Profile-create/delete in `auth.profile.*` Namespace:** Saubere
Separation, aber dann mehrere RPCs fuer related Profile-Daten
(settings.read fuer list, auth.profile fuer mutation). Pragmatischer:
alles in `settings.*`.

## Referenzen

- [ADR-0022](0022-gui-auth-and-secrets-mutation.md) — Vorgaenger-
  Entscheidung (GUI-Login + Profile-Switch + Secrets-Set)
- [ADR-0004](0004-secrets-via-napi-rs-keyring.md) — Secrets-domain
  und das Value-Logging-Verbot (§51)
- `src/domains/auth/profile-manager.ts ProfileManager` — `create/
  delete/use/active/list` source of truth
- `src/sidecar/methods/settings.ts` — `createProfile/deleteProfile`
  RPCs
- `gui/src-tauri/Cargo.toml` — `tinyfiledialogs = "3"`, `once_cell = "1"`
- `gui/src-tauri/src/lib.rs` — `set_secret_native` Tauri-command +
  `LINUX_DIALOG_AVAILABLE` lazy-static
- `gui/src/components/secret-add-modal.tsx` — Mode-toggle
- `gui/src/components/profile-create-modal.tsx`
- `gui/src/components/profile-delete-modal.tsx`
- [tinyfiledialogs project](https://sourceforge.net/projects/tinyfiledialogs/)
