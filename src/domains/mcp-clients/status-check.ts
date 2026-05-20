/**
 * Static-Status-Check pro entdecktem MCP-Server.
 *
 * Klar abgegrenzt: dies ist KEIN Live-Spawn / Ping. Wir prüfen nur:
 *  - Command auflösbar im aktuellen PATH?
 *  - Erstes Pfad-Argument (typischerweise das Script) existiert?
 *  - Required-env-Vars im aktuellen Prozess-Env vorhanden?
 *
 * Live-Probe (spawn + ping) ist v1.6-Material wenn der Sidecar-Lifecycle
 * dafür ausgebaut wird (siehe `docs/integration-plan-cowork-os.md`).
 *
 * @module @domains/mcp-clients/status-check
 */

import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { platform } from 'node:os';
import { delimiter, isAbsolute } from 'node:path';
import type { McpServerEntry, McpServerStatus, ServerStatusKind } from './types.js';

const IS_WINDOWS = platform() === 'win32';
const WIN_EXTENSIONS = ['.exe', '.cmd', '.bat', '.com'];

export interface StatusCheckOpts {
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Sucht `cmd` im `PATH` und gibt den absoluten Pfad zurück, oder null.
 * Auf Windows werden zusätzlich `.exe`/`.cmd`/`.bat`/`.com` probiert.
 */
function findInPath(cmd: string, env: NodeJS.ProcessEnv): string | null {
  if (isAbsolute(cmd)) {
    return existsSync(cmd) ? cmd : null;
  }
  const path = env.PATH ?? env.Path ?? '';
  if (path.length === 0) return null;
  const dirs = path.split(delimiter);
  const candidates =
    IS_WINDOWS && !WIN_EXTENSIONS.some((e) => cmd.toLowerCase().endsWith(e))
      ? WIN_EXTENSIONS.map((e) => `${cmd}${e}`)
      : [cmd];
  for (const dir of dirs) {
    for (const c of candidates) {
      const full = `${dir}${delimiter === ';' ? '\\' : '/'}${c}`
        .replace(/\\+/g, '\\')
        .replace(/\/+/g, '/');
      try {
        if (existsSync(full) && statSync(full).isFile()) {
          // Auf POSIX zusätzlich: executable bit?
          if (!IS_WINDOWS) {
            try {
              accessSync(full, constants.X_OK);
            } catch {
              continue;
            }
          }
          return full;
        }
      } catch {}
    }
  }
  return null;
}

function firstPathArg(args: readonly string[]): string | null {
  // Heuristik: erstes Argument das wirklich nach Pfad aussieht.
  // Ausschluss-Liste:
  //  - Flag-Args (`-x`, `--xxx`, `/c`, `/d`, `/q` — Windows-CMD-Style)
  //  - Kurze Tokens < 3 Zeichen (typisch Flags)
  // Einschluss: absolute Pfade (isAbsolute=true) ODER Args mit
  // Path-Separator MITTEN drin (`a/b`, `a\b`).
  for (const a of args) {
    if (a.startsWith('-')) continue;
    if (a.length < 3) continue;
    if (/^\/[a-z]$/i.test(a)) continue; // /c, /d, /q (cmd-flags)
    if (isAbsolute(a)) return a;
    // Path-Separator MIDDLE-CONTAINING (nicht nur Prefix): `a/b`, `a\b`
    if (/[^\\/].*[\\/].+/.test(a)) return a;
    // Dateiendung am Ende UND mind. ein Buchstabe davor:
    if (/[A-Za-z0-9]\.[a-z0-9]+$/i.test(a)) return a;
  }
  return null;
}

export function checkServerStatus(
  entry: McpServerEntry,
  opts: StatusCheckOpts = {},
): McpServerStatus {
  if (entry.enabled === false) {
    return {
      entry,
      kind: 'disabled',
      message: 'in der Config als disabled markiert',
    };
  }
  const env = opts.env ?? process.env;
  const cmdResolved = findInPath(entry.command, env);
  if (cmdResolved === null) {
    return {
      entry,
      kind: 'command-missing',
      message: `Command "${entry.command}" nicht im PATH gefunden`,
    };
  }
  const pathArg = firstPathArg(entry.args);
  if (pathArg !== null) {
    // Nur prüfen wenn absoluter Pfad — relative Pfade sind ambig
    // (relative zu wem?). User-Doku weist darauf hin.
    if (isAbsolute(pathArg) && !existsSync(pathArg)) {
      return {
        entry,
        kind: 'arg-path-missing',
        message: `Argument-Pfad "${pathArg}" existiert nicht`,
        resolvedCommandPath: cmdResolved,
      };
    }
  }
  if (entry.env) {
    for (const [k, v] of Object.entries(entry.env)) {
      if (v.length === 0 && env[k] === undefined) {
        return {
          entry,
          kind: 'env-missing',
          message: `env-Var "${k}" wird vom Server erwartet, ist aber im aktuellen Prozess nicht gesetzt`,
          resolvedCommandPath: cmdResolved,
        };
      }
    }
  }
  return {
    entry,
    kind: 'ok',
    message: 'Command auflösbar, alle geprüften Pfade existieren',
    resolvedCommandPath: cmdResolved,
  };
}

export function summariseStatuses(
  statuses: readonly McpServerStatus[],
): Record<ServerStatusKind, number> {
  const out: Record<ServerStatusKind, number> = {
    ok: 0,
    disabled: 0,
    'command-missing': 0,
    'arg-path-missing': 0,
    'env-missing': 0,
    unknown: 0,
  };
  for (const s of statuses) out[s.kind]++;
  return out;
}
