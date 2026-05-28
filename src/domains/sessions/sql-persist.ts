/**
 * sql.js-backed persistence adapter for `SessionRepository`
 * (Phase Web-7-persist, ADR-0036 §"In-memory vs persist").
 *
 * Lives in its own `sessions.sqlite` file (NOT shared with
 * users.sqlite) so a corrupt sessions DB only forces re-login —
 * never affects the user-accounts themselves. Same dataDir, so
 * one volume / Proxmox snapshot still covers both.
 *
 * Schema (v1):
 *
 *   meta(key TEXT PK, value TEXT)
 *   sessions(
 *     id TEXT PRIMARY KEY,
 *     user_id TEXT NOT NULL,
 *     created_at INTEGER NOT NULL,
 *     last_used_at INTEGER NOT NULL,
 *     expires_at INTEGER NOT NULL,
 *     user_agent TEXT,
 *     ip TEXT
 *   )
 *   INDEX idx_sessions_user ON sessions(user_id)
 *   INDEX idx_sessions_expires ON sessions(expires_at)
 *
 * Persistence-Strategy: atomic write tempfile+rename on every
 * mutation. The on-disk file stays under ~1KB per session — write
 * cost is dominated by the surrounding `users.sqlite` save anyway.
 *
 * Schema-drift policy: NO auto-rebuild. A version mismatch refuses
 * to open and surfaces an explicit error so the operator can
 * intervene (back up, migrate manually, or wipe sessions to force
 * re-login). Sessions are lower-value than user-accounts; losing
 * them via auto-rebuild would still be silently surprising.
 *
 * @module @domains/sessions/sql-persist
 */
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { ensureSessionsDir, resolveSessionsDbPath } from './paths.js';
import {
  SESSIONS_SCHEMA_VERSION,
  type Session,
  SessionError,
  type SessionPersistAdapter,
} from './types.js';

const FILE_MODE = 0o600;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;

const STAMP_VERSION_SQL = `INSERT OR REPLACE INTO meta(key, value) VALUES('sessions_schema_version', '${SESSIONS_SCHEMA_VERSION}');`;
const READ_SCHEMA_VERSION_SQL = `SELECT value FROM meta WHERE key='sessions_schema_version';`;

let cachedSqlJs: SqlJsStatic | null = null;
async function getSqlJs(): Promise<SqlJsStatic> {
  if (cachedSqlJs !== null) return cachedSqlJs;
  cachedSqlJs = await initSqlJs();
  return cachedSqlJs;
}

export interface OpenSqlSessionPersistOpts {
  readonly dataDir: string;
}

export class SqlSessionPersistAdapter implements SessionPersistAdapter {
  private closed = false;

  private constructor(
    private readonly db: Database,
    private readonly dbPath: string,
  ) {}

  static async open(opts: OpenSqlSessionPersistOpts): Promise<SqlSessionPersistAdapter> {
    ensureSessionsDir(opts.dataDir);
    const dbPath = resolveSessionsDbPath(opts.dataDir);
    const SQL = await getSqlJs();

    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    db.exec(SCHEMA_SQL);
    const onDisk = readSchemaVersion(db);
    if (onDisk !== null && onDisk !== SESSIONS_SCHEMA_VERSION) {
      db.close();
      throw new SessionError(
        `Sessions schema-version mismatch: on-disk=${onDisk}, expected=${SESSIONS_SCHEMA_VERSION}. ` +
          'Remove or migrate sessions.sqlite manually to force re-login.',
      );
    }
    db.exec(STAMP_VERSION_SQL);

    const adapter = new SqlSessionPersistAdapter(db, dbPath);
    adapter.save0();
    return adapter;
  }

  loadAll(): readonly Session[] {
    this.assertOpen();
    const stmt = this.db.prepare('SELECT * FROM sessions');
    const out: Session[] = [];
    try {
      while (stmt.step()) {
        out.push(rowToSession(stmt.getAsObject()));
      }
    } finally {
      stmt.free();
    }
    return out;
  }

  save(session: Session): void {
    this.assertOpen();
    this.db.run(
      `INSERT OR REPLACE INTO sessions(id, user_id, created_at, last_used_at, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.userId,
        session.createdAt,
        session.lastUsedAt,
        session.expiresAt,
        session.userAgent,
        session.ip,
      ],
    );
    this.save0();
  }

  delete(id: string): void {
    this.assertOpen();
    this.db.run('DELETE FROM sessions WHERE id=?', [id]);
    this.save0();
  }

  deleteAllForUser(userId: string): void {
    this.assertOpen();
    this.db.run('DELETE FROM sessions WHERE user_id=?', [userId]);
    this.save0();
  }

  purgeExpired(nowMs: number): number {
    this.assertOpen();
    const beforeStmt = this.db.prepare('SELECT COUNT(*) FROM sessions WHERE expires_at <= ?');
    beforeStmt.bind([nowMs]);
    beforeStmt.step();
    const before = Number(beforeStmt.get()[0] ?? 0);
    beforeStmt.free();
    if (before === 0) return 0;
    this.db.run('DELETE FROM sessions WHERE expires_at <= ?', [nowMs]);
    this.save0();
    return before;
  }

  close(): void {
    if (this.closed) return;
    this.db.close();
    this.closed = true;
  }

  /** Atomic save via tempfile+rename. Private (called after every mutation). */
  private save0(): void {
    const bytes = this.db.export();
    const tmp = `${this.dbPath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, this.dbPath);
    try {
      chmodSync(this.dbPath, FILE_MODE);
    } catch {
      // Windows: silently ignored — ACL inherits from parent dir.
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new SessionError('SqlSessionPersistAdapter is closed');
  }
}

function readSchemaVersion(db: Database): number | null {
  const stmt = db.prepare(READ_SCHEMA_VERSION_SQL);
  try {
    if (!stmt.step()) return null;
    const raw = stmt.get()[0];
    if (typeof raw !== 'string') return null;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) ? n : null;
  } finally {
    stmt.free();
  }
}

type SqlRow = Record<string, unknown>;

function rowToSession(row: SqlRow): Session {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    createdAt: Number(row.created_at),
    lastUsedAt: Number(row.last_used_at),
    expiresAt: Number(row.expires_at),
    userAgent:
      row.user_agent === null || row.user_agent === undefined ? null : String(row.user_agent),
    ip: row.ip === null || row.ip === undefined ? null : String(row.ip),
  };
}
