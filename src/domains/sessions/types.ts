/**
 * Sessions-Domain types (Phase Web-7-2, ADR-0036 draft §Sessions).
 *
 * In-memory LRU-backed session store. Cookie value is an opaque
 * 256-bit CSPRNG identifier (base64url); the server-side mapping
 * session-id → userId lives only in process memory by default.
 *
 * Persistent mode (Web-7-2-tail / Web-7-3) reuses the same
 * `users.sqlite` so cookies survive container restarts when
 * `$CLAUDE_OS_SESSION_PERSIST=1`.
 *
 * @module @domains/sessions/types
 */

export interface Session {
  readonly id: string;
  readonly userId: string;
  /** Issued-at, ms since epoch. */
  readonly createdAt: number;
  /** Slides forward on every authenticated request (TTL refresh). */
  readonly lastUsedAt: number;
  /** Absolute expiry, ms since epoch. */
  readonly expiresAt: number;
  /** Optional fingerprint for forensic correlation in audit log. */
  readonly userAgent: string | null;
  /** Optional client-IP at issuance. NOT used for binding — only logging. */
  readonly ip: string | null;
}

/** 30 days. */
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** In-memory store size cap before LRU eviction kicks in. */
export const DEFAULT_LRU_CAPACITY = 1000;

/**
 * Sessions schema-version for the OPTIONAL persistent store
 * (Web-7-persist). Bumped only on backwards-incompatible shape
 * changes; readers tolerate higher versions by ignoring unknown
 * columns rather than rejecting the row.
 *
 *   v1 (2026-05-28) — initial schema: sessions(id, user_id,
 *                     created_at, last_used_at, expires_at,
 *                     user_agent, ip)
 */
export const SESSIONS_SCHEMA_VERSION = 1;

/**
 * Adapter that the in-memory SessionRepository delegates to when
 * persistence is requested. Concrete impl in `sql-persist.ts`.
 * Tests can plug a Map-backed adapter in to verify the wire-up
 * without touching sql.js.
 */
export interface SessionPersistAdapter {
  loadAll(): readonly Session[];
  save(session: Session): void;
  delete(id: string): void;
  /** Remove every session for a user-id; used by repo.revokeAllForUser. */
  deleteAllForUser(userId: string): void;
  /** Bulk-purge expired entries (now-relative). Returns removed count. */
  purgeExpired(nowMs: number): number;
  /** Close any backing handles (sql.js DB etc.). */
  close(): void;
}

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

export class SessionNotFoundError extends SessionError {
  constructor(id: string) {
    super(`Session not found (or expired): "${id.slice(0, 8)}..."`);
    this.name = 'SessionNotFoundError';
  }
}
