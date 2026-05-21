/**
 * Safe tar.extract wrapper — verhindert symlink/hardlink-Schreibversuche
 * und Pfad-Traversal beim Auspacken von Plugin-Tarballs aus dem
 * Marketplace / GitHub.
 *
 * Threat-Modell (C3 Code-Review-Session 2026-05-21):
 *   Ein malicious tarball aus `marketplace:` oder `github:owner/repo`
 *   kann Symlinks (`bad -> /`) und Hardlinks shippen. Default-`tar.extract`
 *   folgt Symlinks bei Folge-Entries (CVE-2024-28863-Familie) und kann
 *   ausserhalb von `destination` schreiben.
 *
 * Mitigation:
 *   - Per-Entry `filter` rejected `SymbolicLink`/`Link`/`..`-Pfade BEVOR
 *     sie auf Disk landen — verworfene Entries werden gesammelt und
 *     nach `extract` als Fehler geworfen.
 *   - `preserveOwner: false` — kein uid/gid-Restore.
 *   - `unlink: true` — overwrite via unlink+create statt write-through
 *     (extra Schutz gegen pre-existing-symlink-target).
 *
 * @module @domains/catalog/safe-tar-extract
 */
import { extract as tarExtract } from 'tar';

export class UnsafeTarballError extends Error {
  constructor(
    message: string,
    public readonly violations: readonly string[],
  ) {
    super(message);
    this.name = 'UnsafeTarballError';
  }
}

export interface SafeExtractOpts {
  /** Absoluter Pfad zum Tarball. */
  readonly file: string;
  /** Extraktions-Verzeichnis. */
  readonly cwd: string;
  /** Strip-N-Components (siehe tar `strip`). Default 0. */
  readonly strip?: number;
}

/**
 * Wraps `tar.extract` mit Security-Filter. Wirft `UnsafeTarballError`
 * wenn der Tarball verbotene Entries enthielt; ggf. wurden vorherige
 * "saubere" Entries zwar geschrieben, aber NIE durch einen Symlink
 * gefolgt.
 */
export async function safeExtractTar(opts: SafeExtractOpts): Promise<void> {
  const violations: string[] = [];
  await tarExtract({
    file: opts.file,
    cwd: opts.cwd,
    strip: opts.strip ?? 0,
    preserveOwner: false,
    unlink: true,
    filter: (path, stat) => {
      // Tar-v7 `stat.type` enthaelt z. B. 'File', 'Directory',
      // 'SymbolicLink', 'Link' (hardlink), 'CharacterDevice',
      // 'BlockDevice', 'FIFO', 'ContiguousFile', 'GNULongPath',
      // 'GNULongLink', 'GNUSparse'. Erlaubt: nur File + Directory +
      // GNULongPath (Path-Header).
      const type = (stat as { type?: string }).type ?? 'File';
      if (type === 'SymbolicLink' || type === 'Link') {
        violations.push(`${type}: ${path}`);
        return false;
      }
      // Strip-Components passiert NACH filter; pruefe ../-Segmente vor
      // strip.
      const segments = path.split(/[/\\]/);
      if (segments.some((s) => s === '..')) {
        violations.push(`parent-dir-segment: ${path}`);
        return false;
      }
      // Absolute paths — tar v7 lehnt sie standardmaessig ab, aber doppelt
      // genaeht haelt besser. `/etc/passwd` oder `C:\Windows\...` würde
      // hier gefangen werden.
      if (path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path)) {
        violations.push(`absolute-path: ${path}`);
        return false;
      }
      // Devices/FIFOs sind weder sinnvoll noch sicher in Plugin-Tarballs.
      if (
        type === 'CharacterDevice' ||
        type === 'BlockDevice' ||
        type === 'FIFO' ||
        type === 'ContiguousFile'
      ) {
        violations.push(`forbidden-type ${type}: ${path}`);
        return false;
      }
      return true;
    },
  });
  if (violations.length > 0) {
    const preview = violations.slice(0, 5).join(', ');
    const suffix = violations.length > 5 ? ` (…+${violations.length - 5} more)` : '';
    throw new UnsafeTarballError(
      `tarball "${opts.file}" contained ${violations.length} forbidden entries: ${preview}${suffix}`,
      violations,
    );
  }
}
