# ADR-001: Provider-Abstraction-Pattern

**Status:** Accepted
**Datum:** 2026-05-24
**Entscheider:** Yannik

## Kontext

Das Projekt nutzt Anthropic-API als einzigen Provider. Die ursprüngliche Spec sah Multi-Provider-Support (OpenRouter, lokale Modelle) als Phase-1-Ziel mit "identische Outputs"-Equivalence-Test. Das ist:
- YAGNI: Multi-Provider löst kein aktuelles Problem
- Methodisch falsch: identische LLM-Outputs sind nicht erreichbar
- Risiko der frühen Falsch-Abstraktion (Anthropic-spezifische Konzepte wie Tool-Use-Schemas könnten erzwungen-generisch gemacht werden)

## Entscheidung

1. **Interface designt, eine Implementierung gebaut.** `ProviderTransport`-Interface in `src/domains/claude-bridge/transport.ts` (TypeScript-Interface, ~20-30 Zeilen). Einzige Implementierung: `AnthropicTransport`.
2. **Modell-ID config-driven.** Aus `.env` (`CLAUDE_OS_MODEL`), niemals im Code hardgenagelt. Erlaubt Runtime-Override über CLI-Flag.
3. **Contract-Tests statt Output-Equivalence.** Tests prüfen Schema-Konformität, Tool-Call-Semantik, Retry-Verhalten, nicht textuelle Gleichheit.
4. **Trigger für weitere Provider:** Anthropic-Kosten > €50/Monat ODER Rate-Limit zum Bottleneck ODER Customer-Compliance-Anforderung. Vorher nicht.

## Konsequenzen

- Phase 1 ist schnell abschließbar (≤ 2 Wochen)
- Spätere OpenRouter-Erweiterung kostet 2-3 Stunden (Adapter implementieren, gegen Contract-Tests grün)
- Kein toter Code für hypothetische Provider
- Klares Signal: dieses Projekt ist Anthropic-first, nicht provider-agnostisch

## Alternativen erwogen

- **Multi-Provider sofort:** verworfen — 4-6× Aufwand für kein Benefit
- **Anthropic-only ohne Interface:** verworfen — spätere Migration teuer
