# ADR-007: Repo-Strategie (Hybrid Public-Core + Private MSP/House)

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Drei Komponenten mit unterschiedlichen Sichtbarkeits-Anforderungen:
1. Claude-OS-Core (LLM-Bridge, Vault, Skills, MCP, Tauri-GUI) — generic, OSS-tauglich
2. MSP-Bridges (TANSS, NinjaOne, Veeam, M365, Securepoint) — Wettbewerbs-Wissen + Customer-Daten-Risiko
3. House-Watch (Immobilien-Crawler) — privat, ohne MSP-Bezug

Optionen:
- Alles in einem public Repo (Customer-Risiko)
- Alles in einem private Repo (verzichtet auf OSS-Sichtbarkeit)
- Hybrid mit Trennung

## Entscheidung

**Drei Repos:**

```
yannikits/Claude-portable    public,  MIT          → Core: TS, Tauri, MCP, Memory, Skills
yannikits/claude-os-msp      private, proprietär   → TANSS/Ninja/Veeam/M365/Securepoint
yannikits/house-watch        private, proprietär   → Immobilien-Crawler
```

**Dependency-Richtung:**
```
claude-os-msp  ──depends-on──>  Claude-portable
house-watch    ──depends-on──>  Claude-portable
```

Niemals umgekehrt. Der Public-Core kennt MSP-Bridges nur als optionale, dynamisch geladene Plugins (via Skill-Loader oder MCP-Tool-Registry).

**Plugin-Mechanismus** (Phase 6): MSP-Bridges registrieren sich über die MCP-Tool-Registry beim Claude-OS-Core. Der Core ruft sie wie jedes andere MCP-Tool auf — keine Build-time-Abhängigkeit.

**Verteilung an Yannik:**
- Claude-OS-Core via Tauri-Bundle (öffentlich)
- MSP-Bridges via privates npm-Tarball oder Git-Submodule in Yanniks lokalem Setup

## Konsequenzen

- Mehrere Repos zu pflegen — Renovate hilft mit dep-Updates
- Klarere Lizenz-Trennung
- MSP-Code bleibt aus Public-Git-History fern (keine versehentlichen Commits)
- House-Watch ist komplett separat — keine MSP-Customer-Verschmutzung
- Setup-Anleitung wird komplexer: User installiert Core, optional MSP-Plugins

## Alternativen erwogen

- **Mono-Repo public mit MSP-Verzeichnis ignored:** verworfen — versehentliche Commits zu riskant
- **Alles private:** verworfen — Public-Sichtbarkeit ist ein Wert
- **Submodule statt separate Repos:** überlegt — Submodule sind aber UX-feindlich für Mitarbeiter/Contributors. Separate Repos sind sauberer.

## Übergangs-Plan

1. Aktuelles `Claude-portable` (public) bleibt der Core
2. `claude-os-msp` als neues privates Repo angelegt, sobald Phase 6 startet
3. `house-watch` als neues privates Repo, sobald Phase 9 ansteht
4. Im Public-Core: `examples/`-Ordner mit minimalem "Plugin-Pattern"-Demo (keine echten Bridges)
