# claude-os GUI (Phase 6)

Tauri-2-Desktop-Shell für claude-os.

## Voraussetzungen

- Node ≥ 20 (gleicher Stack wie das CLI-Projekt)
- Rust-Toolchain via [rustup](https://rustup.rs/)
- Plattform-spezifisch:
  - Windows: Visual Studio 2022 Build Tools mit C++-Workload
  - macOS: Xcode CLI Tools (`xcode-select --install`)
  - Linux: `libwebkit2gtk-4.1-dev`, `libssl-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`, `xdotool`

## Verifikation (Phase 6a)

```powershell
cd gui\src-tauri
cargo check
```

`cargo check` validiert dass die Rust-Shell-Sources kompilieren ohne die volle Binary zu linken. Erster Lauf nach rustup-Install lädt Tauri + Transitive-Crates (~300 MB Cargo-Cache, ~3-5 min).

## Sub-Phasen-Status

| Sub-Phase | Inhalt | Status |
|-----------|--------|--------|
| 6a | Tauri-Rust-Shell-Scaffold | shipped |
| 6b | Sidecar-Binary-Build-Script (`$TARGET_TRIPLE`) | pending |
| 6c | JSON-RPC-Bridge (Rust + Node) | pending |
| 6d | Sidecar-Lifecycle + Health-Check | pending |
| 6e | Vite + React + TS Frontend | pending |
| 6f | 7 Views | pending |
| 6g | Drag-Drop + inbox/outbox Watcher | pending |
| 6h | Bundling (MSI/DMG/AppImage) | pending |

## Deferrals in 6a

- Icons (`icons/*.png`, `*.ico`) shippt Phase 6h zusammen mit dem Bundling-Pass. `cargo check` braucht keine Icons; `cargo build --release` auf Windows braucht eine `.ico` für die `winres`-Embedding — wird in 6h nachgezogen.
- Frontend-Dist (`gui/src/index.html`) shippt Phase 6e. `tauri dev` braucht den Vite-Server (läuft nicht in 6a). `tauri build` braucht `frontendDist`; ist erst ab 6h relevant.
