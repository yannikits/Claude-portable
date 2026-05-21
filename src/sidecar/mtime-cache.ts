/**
 * M14 (2026-05-21 code-review): mtime-keyed read-through cache fuer
 * sidecar RPC-Handler die haeufig konfigurations-files re-readen.
 *
 * Verhalten:
 *  - `statSync(path)` liefert `{mtimeMs, size}`. Wenn beide gegen die
 *    cached entry matchen, return cached value.
 *  - Wenn file fehlt: cache als tombstone mit `mtimeMs=-1`. Naechster
 *    Call mit ebenfalls-fehlendem-file → cached. Sobald file existiert,
 *    geht mtimeMs auf den realen Stat-Wert.
 *  - Reader wird nur bei cache-miss aufgerufen.
 *
 * Lebenszeit: per-Sidecar-Instance. Bei Tauri-process-Restart wird der
 * Cache verworfen — desired (Restart ist die User-action fuer "ich habe
 * konfigurations-Files extern editiert und will fresh state").
 *
 * Limitations:
 *  - mtime hat Sekunden-Granularitaet auf FAT32. Auf Windows/NTFS und
 *    Linux/ext4 ist Millisekunden-genau. Zwei writes innerhalb derselben
 *    Sekunde mit identischem File-Size koennten verfehlt werden — die
 *    Praxis-Konsequenz ist negligible (config-files werden manuell oder
 *    via CLI editiert, nicht im Sub-Sekunden-Takt).
 *  - Cache-Hits ueberspringen den eigentlichen reader — wenn dieser
 *    Side-effects hatte (z. B. Migration triggering), entfaellt das auf
 *    Hits. Reader hier sind alle pure-reads (readCatalog, readSchedules,
 *    loadVaultConfig); kein Side-effect-Risiko.
 *
 * @module @sidecar/mtime-cache
 */
import { statSync } from 'node:fs';

interface CacheEntry<T> {
  /** statSync().mtimeMs, oder -1 wenn file nicht existiert. */
  readonly mtimeMs: number;
  /** statSync().size, irrelevant wenn mtimeMs=-1. */
  readonly size: number;
  readonly value: T;
}

export type MtimeCache<T> = Map<string, CacheEntry<T>>;

export function createMtimeCache<T>(): MtimeCache<T> {
  return new Map();
}

/**
 * Reads `filePath` via `loader()` mit mtime-keyed cache. Bei cache-hit
 * wird der loader NICHT aufgerufen.
 *
 * @param filePath Pfad zum stat'baren File (Cache-Key + Staleness-
 *                 Indikator).
 * @param loader Zero-arg-Funktion die den fresh-Wert holt. Wird nur bei
 *               cache-miss / mtime-mismatch aufgerufen.
 * @param cache Eine via `createMtimeCache<T>()` initialisierte Map.
 */
export function mtimeCached<T>(filePath: string, loader: () => T, cache: MtimeCache<T>): T {
  let mtimeMs: number;
  let size: number;
  try {
    const stat = statSync(filePath);
    mtimeMs = stat.mtimeMs;
    size = stat.size;
  } catch {
    // File missing — tombstone-cache.
    const tomb = cache.get(filePath);
    if (tomb !== undefined && tomb.mtimeMs === -1) return tomb.value;
    const value = loader();
    cache.set(filePath, { mtimeMs: -1, size: 0, value });
    return value;
  }
  const cached = cache.get(filePath);
  if (cached !== undefined && cached.mtimeMs === mtimeMs && cached.size === size) {
    return cached.value;
  }
  const value = loader();
  cache.set(filePath, { mtimeMs, size, value });
  return value;
}
