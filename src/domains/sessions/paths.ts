/**
 * Resolves the on-disk path of the sessions `.sqlite` file
 * (Phase Web-7-persist).
 *
 * Sessions live in a SEPARATE sqlite file from users to keep the two
 * sub-systems independent — users.sqlite has its own schema-version
 * pragma + autoRebuild semantics; sessions.sqlite has milder
 * recovery rules (a corrupt sessions DB just causes "everyone needs
 * to re-login", not "all accounts are gone"). Co-located in the same
 * dataDir so a single Proxmox-snapshot covers both.
 *
 * @module @domains/sessions/paths
 */
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SESSIONS_DB_FILENAME = 'sessions.sqlite';

export function resolveSessionsDbPath(dataDir: string): string {
  return join(dataDir, SESSIONS_DB_FILENAME);
}

export function ensureSessionsDir(dataDir: string): string {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
