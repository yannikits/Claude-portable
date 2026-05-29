/**
 * Veeam Read-Bridge types.
 *
 * Shapes are kept intentionally small — the Veeam VBR REST API returns
 * 30+ fields per session, but the probe only needs aggregate counts,
 * a job-rename detection list, and a handful of timestamps.
 *
 * PII boundary (per SECURITY.md §4 + ADR-0038):
 *   - `latestRuns[].jobName` MAY contain customer-identifying tokens
 *     (e.g. "daily-mueller-fileserver"). It is carried in the probe-
 *     return-value for in-session display only. It MUST NOT be written
 *     to the audit log (the wrapper writes only customerSlug, never
 *     bridge-specific details that could be PII).
 *
 * @module @domains/msp-bridges/veeam/types
 */
import type { Logger } from 'pino';

/** Compact, dashboard-ready Veeam-Status payload for one customer's VBR. */
export interface VeeamStatus {
  /** Number of (filtered) jobs observed in the response. */
  readonly knownJobs: number;
  /**
   * jobNames that the customer.yaml configured but which we did NOT see
   * in the VBR response. Most likely cause: someone renamed the job in
   * the Veeam UI. EMPTY ARRAY when no jobNames filter is set
   * (we can't detect renames there).
   */
  readonly missingJobs: readonly string[];
  /** Latest session per job had state Success. */
  readonly okCount: number;
  /** Latest session per job had state Warning. */
  readonly warningCount: number;
  /** Latest session per job had state Failed. */
  readonly failedCount: number;
  /** Latest session per job is currently Running / Working. */
  readonly runningCount: number;
  /** Newest end-time across all SUCCESSFUL sessions. */
  readonly newestSuccessAt: string | null;
  /**
   * Oldest end-time across the latest-failed / latest-warning sessions
   * — i.e. "the customer with this status is alarming since how long".
   * `null` when nothing is failed/warning.
   */
  readonly oldestUnsuccessfulAt: string | null;
  /** Latest session per job (clipped to first 20 for UI). */
  readonly latestRuns: readonly VeeamRun[];
}

export interface VeeamRun {
  readonly jobName: string;
  readonly state: string;
  readonly endTimeUtc: string | null;
}

/**
 * Subset of Veeam's session-response we consume. The real response has
 * 30+ fields; we read just the ones the mapper needs. Fields are all
 * optional because Veeam version drift can rename/move them and we
 * want the mapper to be defensive (ADR-0038 forward-compat philosophy).
 */
export interface VeeamSessionRaw {
  readonly id?: string;
  readonly name?: string;
  readonly jobId?: string;
  readonly jobName?: string;
  readonly sessionType?: string;
  readonly state?: string;
  readonly result?: string | { readonly result?: string };
  readonly creationTime?: string;
  readonly endTime?: string;
}

/** Credentials for one Veeam server (resolved from secrets-backend). */
export interface VeeamCredentials {
  readonly username: string;
  readonly password: string;
}

/**
 * Per-host credential resolver — the bridge calls this once per probe
 * for the customer's serverHostname. Returning null lets the bridge
 * emit `auth-failed` with a clear "no creds for <host>" message
 * instead of throwing.
 */
export type VeeamCredentialsResolver = (host: string) => Promise<VeeamCredentials | null>;

/** DI-shape for `VeeamBridge`. */
export interface VeeamBridgeConfig {
  readonly getCredentialsForHost: VeeamCredentialsResolver;
  /** Veeam VBR REST API version. Default: `1.1-rev1`. */
  readonly apiVersion?: string;
  /** Default port when customer.yaml does not specify one. Default 9419. */
  readonly defaultPort?: number;
  /** Injectable for tests. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** AbortController-driven request timeout. Default: 15_000 (Veeam is slower than TANSS). */
  readonly timeoutMs?: number;
  /**
   * Opt-IN for self-signed Veeam certs. False by default — Node sends
   * `rejectUnauthorized:true` via the default fetch. When true, the
   * bridge swaps in a `https.Agent({rejectUnauthorized:false})`.
   */
  readonly insecureTls?: boolean;
  /** Optional pino logger. Credentials are NEVER passed to it. */
  readonly logger?: Logger;
}
