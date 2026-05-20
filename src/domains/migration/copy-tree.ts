/**
 * Cross-platform recursive directory copy mit Exclude-Patterns.
 *
 * `robocopy` ist Windows-only; wir nutzen `fs.cp` (Node 20+ native)
 * mit eigenem filter-Callback der die Exclude-Patterns prüft. Das
 * funktioniert auf Windows, macOS und Linux einheitlich.
 *
 * Verlustfreiheit: das Ziel-Layout ist 1:1 die Quelle, bis auf die
 * exkludierten Sub-Trees. Symlinks werden NICHT folge-kopiert (würde
 * Cycle-Risiken einführen) — sie werden als Links erhalten.
 *
 * Idempotenz: ein zweiter Lauf auf das gleiche Ziel überschreibt
 * unveränderte Dateien (mtime + Größe identisch) nicht — `force: true`
 * nur wenn Inhalt unterschiedlich ist. Konsequenz: zweimal mig­rieren
 * ist semantisch identisch.
 *
 * @module @domains/migration/copy-tree
 */
import { cp, stat } from 'node:fs/promises';
import { relative, sep } from 'node:path';

/** Glob-ähnlicher Matcher — unterstützt `*` und absoluten Trailing-Slash. */
function matchesAny(relPath: string, patterns: readonly string[]): boolean {
  const normalised = relPath.split(sep).join('/');
  for (const raw of patterns) {
    const pat = raw.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalised === pat) return true;
    if (normalised.startsWith(`${pat}/`)) return true;
    if (pat.includes('*')) {
      const regex = new RegExp(
        `^${pat
          .split('*')
          .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      );
      if (regex.test(normalised)) return true;
    }
  }
  return false;
}

export interface CopyTreeOpts {
  readonly source: string;
  readonly destination: string;
  readonly exclude: readonly string[];
}

export interface CopyTreeStats {
  readonly filesCopied: number;
  readonly bytesCopied: number;
  readonly filesSkipped: number;
  readonly excludedPaths: readonly string[];
}

/**
 * Kopiert `source/` rekursiv nach `destination/` und gibt eine
 * Statistik zurück (filesCopied / bytesCopied / filesSkipped /
 * excludedPaths). Bestehende Dateien am Ziel werden überschrieben.
 */
export async function copyTree(opts: CopyTreeOpts): Promise<CopyTreeStats> {
  const { source, destination, exclude } = opts;
  let filesCopied = 0;
  let bytesCopied = 0;
  let filesSkipped = 0;
  const excludedPaths: string[] = [];

  await cp(source, destination, {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true,
    filter: (sourcePath) => {
      const rel = relative(source, sourcePath);
      if (rel === '' || rel === '.') return true;
      if (matchesAny(rel, exclude)) {
        excludedPaths.push(rel);
        return false;
      }
      return true;
    },
  });

  // Statistik nach-erfassen — fs.cp gibt selber keinen Counter zurück.
  for await (const entry of walkAsync(destination)) {
    try {
      const s = await stat(entry);
      if (s.isFile()) {
        filesCopied++;
        bytesCopied += s.size;
      }
    } catch {
      filesSkipped++;
    }
  }

  return { filesCopied, bytesCopied, filesSkipped, excludedPaths };
}

async function* walkAsync(root: string): AsyncGenerator<string> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const full = path.join(current, d.name);
      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.isFile()) {
        yield full;
      }
    }
  }
}
