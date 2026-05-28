/**
 * Sessions-Domain barrel (Phase Web-7-2).
 *
 * @module @domains/sessions
 */

export { looksLikeSessionId, newSessionId } from './id.js';
export { LruStore, type LruStoreOpts } from './lru-store.js';
export { ensureSessionsDir, resolveSessionsDbPath } from './paths.js';
export { type IssueSessionInput, type SessionRepoOpts, SessionRepository } from './repo.js';
export {
  type OpenSqlSessionPersistOpts,
  SqlSessionPersistAdapter,
} from './sql-persist.js';
export {
  DEFAULT_LRU_CAPACITY,
  DEFAULT_SESSION_TTL_MS,
  SESSIONS_SCHEMA_VERSION,
  type Session,
  SessionError,
  SessionNotFoundError,
  type SessionPersistAdapter,
} from './types.js';
