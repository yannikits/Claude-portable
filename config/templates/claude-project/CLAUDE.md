# [PROJEKTNAME]

## Kontext
<!-- Was ist das Projekt? Warum existiert es? (2-3 Sätze) -->

## Stack
- Language:
- Framework:
- Database:
- Tools:

## Architektur
<!-- Wichtige Patterns, Bounded Contexts, Grenzen -->
- Pattern:
- Struktur: src/, tests/, config/, docs/

## Verhaltensregeln
- Keine Änderungen außerhalb src/ ohne Absprache
- Tests vor Commit ausführen
- Keine Secrets in Source-Dateien

## Memory-Namespaces
- `default` — allgemeine Patterns
- `[projektname]` — projektspezifische Patterns

## Build & Test

```bash
# Start

# Test

# Lint
```

## Agents
- Primary: coder, reviewer, tester
- Optional: security-auditor, performance-engineer
