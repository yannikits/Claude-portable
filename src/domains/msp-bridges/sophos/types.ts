/**
 * Sophos XG/XGS Firewall Read-Bridge types.
 *
 * Status payload focuses on the two questions every MSP-Operator asks
 * about a customer-firewall:
 *   - is it on a current firmware?
 *   - are the subscriptions still valid?
 *
 * HA-state, performance counters, firewall-rule listing are out-of-scope
 * for v1.9.1 (Phase 7-D MVP). Write-paths are forbidden by ADR-0027.
 *
 * Privacy note: subscription names (e.g. "Web Protection") are
 * non-PII; firewall hostnames already live in customer.yaml.
 *
 * @module @domains/msp-bridges/sophos/types
 */
import type { Logger } from 'pino';

export interface SubscriptionInfo {
  /** "Network Protection", "Web Protection", "Email Protection", … */
  readonly name: string;
  /** "Subscribed" | "Trial" | "Expired" | "Deactivated" — Sophos string. */
  readonly status: string;
  /** ISO-8601 UTC midnight, or null when Sophos doesn't expose one. */
  readonly expiresAt: string | null;
  /** Days remaining from now to expiresAt. null when expiresAt is null. */
  readonly daysRemaining: number | null;
}

export type LicenseSummary = 'active' | 'expiring-soon' | 'expired' | 'mixed' | 'unknown';

export interface SophosStatus {
  /** Full firmware string from `<Firmware><Version>` e.g. "SFOS 20.0.1 MR-1". */
  readonly firmwareVersion: string;
  /** Firmware-type from `<Firmware><Type>` ("Default" / "MR" / …). */
  readonly firmwareType: string | null;
  /** Aggregate across all subscriptions — see mapper for heuristic. */
  readonly licenseSummary: LicenseSummary;
  /** Minimum daysRemaining across non-expired subscriptions; null when no data. */
  readonly daysToEarliestExpiry: number | null;
  readonly subscriptions: readonly SubscriptionInfo[];
}

/** Minimal raw shape we consume from the parsed XML response. */
export interface SophosFirmwareRaw {
  readonly Version?: string;
  readonly Type?: string;
}

export interface SophosSubscriptionRaw {
  readonly Name?: string;
  readonly Status?: string;
  readonly ExpiryDate?: string;
}

/** `LicenseInformation > Subscriptions > Subscription` is either object or array. */
export interface SophosLicenseInfoRaw {
  readonly Subscriptions?: {
    readonly Subscription?: SophosSubscriptionRaw | readonly SophosSubscriptionRaw[];
  };
}

export interface SophosLoginRaw {
  readonly status?: string;
}

/** Top-level `<Response>` we read after xml-parse. */
export interface SophosResponseRaw {
  readonly Login?: SophosLoginRaw;
  readonly Firmware?: SophosFirmwareRaw;
  readonly LicenseInformation?: SophosLicenseInfoRaw;
  readonly Status?: { readonly '@_code'?: string; readonly '#text'?: string } | string;
}

export interface SophosBridgeConfig {
  /** Per-host credential resolver — called fresh on every probe (ADR-0038). */
  readonly getCredentialsForHost: (
    host: string,
  ) => Promise<{ username: string; password: string } | null>;
  /** Default port when customer.yaml does not specify one. Default 4444. */
  readonly defaultPort?: number;
  /** Injectable fetch — defaults to globalThis.fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Request timeout. Default 15_000 (XML responses can be larger). */
  readonly timeoutMs?: number;
  /** Opt-IN for self-signed certs (Sophos XG/XGS default). */
  readonly insecureTls?: boolean;
  /** Optional pino logger. Credentials never reach it. */
  readonly logger?: Logger;
}
