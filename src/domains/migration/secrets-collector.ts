/**
 * .env-File-Scanner für die Migration.
 *
 * Liest gefundene .env-Files und extrahiert KEYS (NIEMALS VALUES).
 * Die Values bleiben im File und werden interaktiv vom User
 * über `claude-os secrets set <key>` in den Keychain überführt —
 * das vermeidet Plain-Text-Secrets im Memory der Migrate-Engine
 * UND im transcript-jsonl der Claude-Code-Session.
 *
 * Unbekannte / fehlerhafte Zeilen werden geloggt aber nicht
 * verworfen (siehe `unknownLines` im Output).
 *
 * @module @domains/migration/secrets-collector
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnvScanResult {
  readonly keys: readonly string[];
  /** Lines die nicht parsable waren (Format-Wartung gegen v0.x-Drift). */
  readonly unknownLines: readonly { readonly source: string; readonly line: string }[];
}

const KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Scannt eine Liste von .env-File-Pfaden (relativ zu `root`) und
 * gibt die deduplizierten Keys + die unparseable-Lines zurück.
 *
 * Strategie:
 *  - Leere Zeilen + Kommentare (`#`) ignoriert
 *  - `KEY=value`-Format akzeptiert (Whitespace um `=` toleriert)
 *  - `export KEY=value` ebenfalls akzeptiert (shell-style)
 *  - Alles andere landet in `unknownLines`
 *  - Values werden weder im Output noch im Returnwert exponiert
 */
export function scanEnvFiles(root: string, relPaths: readonly string[]): EnvScanResult {
  const keysSet = new Set<string>();
  const unknownLines: { source: string; line: string }[] = [];

  for (const relPath of relPaths) {
    const abs = join(root, relPath);
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      unknownLines.push({ source: relPath, line: '(could not read file)' });
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      const stripped = line.replace(/^export\s+/, '');
      const eqIdx = stripped.indexOf('=');
      if (eqIdx <= 0) {
        unknownLines.push({ source: relPath, line: rawLine });
        continue;
      }
      const key = stripped.slice(0, eqIdx).trim();
      if (!KEY_PATTERN.test(key)) {
        unknownLines.push({ source: relPath, line: rawLine });
        continue;
      }
      keysSet.add(key);
    }
  }
  return {
    keys: [...keysSet].sort(),
    unknownLines,
  };
}
