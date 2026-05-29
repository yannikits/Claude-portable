/**
 * Pure mapper — `VeeamSessionRaw[]` + optional jobNames-filter → `VeeamStatus`.
 *
 * Algorithm:
 *   1. Filter sessions to those whose `jobName` is in the filter (when set)
 *   2. Group by `jobName`, keep the NEWEST session per job (by endTime ↓
 *      then creationTime ↓ — Veeam returns endTime null for running sessions)
 *   3. Count states across those latest-per-job sessions
 *   4. missingJobs = (filter ∖ observed) when filter set; else []
 *
 * State-Mapping is forgiving: Veeam reports states variously as `result`
 * (Success/Warning/Failed/None) and `state` (Working/Starting/Stopping/
 * Idle/Postprocessing/Resuming/Stopped). We bucket them:
 *   - 'ok'       — result.Success
 *   - 'warning'  — result.Warning
 *   - 'failed'   — result.Failed
 *   - 'running'  — state ∈ Working/Starting/Stopping/Postprocessing/Resuming
 *   - 'unknown'  — everything else (still counted in knownJobs)
 *
 * @module @domains/msp-bridges/veeam/mapper
 */
import type { VeeamRun, VeeamSessionRaw, VeeamStatus } from './types.js';

const STATES_RUNNING = new Set(['working', 'starting', 'stopping', 'postprocessing', 'resuming']);

export type VeeamBucket = 'ok' | 'warning' | 'failed' | 'running' | 'unknown';

function readResult(s: VeeamSessionRaw): string | null {
  const r = s.result;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object' && typeof r.result === 'string') return r.result;
  return null;
}

export function bucketOf(s: VeeamSessionRaw): VeeamBucket {
  const result = (readResult(s) ?? '').toLowerCase();
  if (result === 'success') return 'ok';
  if (result === 'warning') return 'warning';
  if (result === 'failed') return 'failed';
  const state = (s.state ?? '').toLowerCase();
  if (STATES_RUNNING.has(state)) return 'running';
  return 'unknown';
}

function tsMs(s: VeeamSessionRaw): number {
  const t = s.endTime ?? s.creationTime;
  if (!t) return 0;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? 0 : ms;
}

function endIsoOrNull(s: VeeamSessionRaw): string | null {
  if (!s.endTime) return null;
  const ms = Date.parse(s.endTime);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export interface MapOpts {
  /** When set, sessions whose jobName is NOT in this list are dropped. */
  readonly filterJobNames?: readonly string[];
  /** Hard cap on the `latestRuns` list returned. Default 20. */
  readonly maxRuns?: number;
}

export function mapVeeamSessions(
  rawSessions: readonly VeeamSessionRaw[],
  opts: MapOpts = {},
): VeeamStatus {
  const filterSet = opts.filterJobNames ? new Set(opts.filterJobNames) : null;
  const maxRuns = opts.maxRuns ?? 20;

  // Step 1+2: group, newest-per-job.
  const newestByJob = new Map<string, VeeamSessionRaw>();
  for (const s of rawSessions) {
    const jobName = s.jobName ?? s.name;
    if (typeof jobName !== 'string' || jobName.length === 0) continue;
    if (filterSet !== null && !filterSet.has(jobName)) continue;
    const prev = newestByJob.get(jobName);
    if (prev === undefined || tsMs(s) > tsMs(prev)) {
      newestByJob.set(jobName, { ...s, jobName });
    }
  }

  // Step 3: count + extreme timestamps.
  let okCount = 0;
  let warningCount = 0;
  let failedCount = 0;
  let runningCount = 0;
  let newestSuccessMs: number | null = null;
  let oldestUnsuccessfulMs: number | null = null;

  const runs: VeeamRun[] = [];
  for (const [jobName, s] of newestByJob) {
    const bucket = bucketOf(s);
    const ms = tsMs(s) || null;
    if (bucket === 'ok') {
      okCount += 1;
      if (ms !== null && (newestSuccessMs === null || ms > newestSuccessMs)) newestSuccessMs = ms;
    } else if (bucket === 'warning') {
      warningCount += 1;
      if (ms !== null && (oldestUnsuccessfulMs === null || ms < oldestUnsuccessfulMs)) {
        oldestUnsuccessfulMs = ms;
      }
    } else if (bucket === 'failed') {
      failedCount += 1;
      if (ms !== null && (oldestUnsuccessfulMs === null || ms < oldestUnsuccessfulMs)) {
        oldestUnsuccessfulMs = ms;
      }
    } else if (bucket === 'running') {
      runningCount += 1;
    }
    runs.push({ jobName, state: bucket, endTimeUtc: endIsoOrNull(s) });
  }

  runs.sort(
    (a, b) => (Date.parse(b.endTimeUtc ?? '') || 0) - (Date.parse(a.endTimeUtc ?? '') || 0),
  );

  // Step 4: missing-jobs detection.
  const missingJobs =
    filterSet === null ? [] : opts.filterJobNames!.filter((j) => !newestByJob.has(j));

  return {
    knownJobs: newestByJob.size,
    missingJobs,
    okCount,
    warningCount,
    failedCount,
    runningCount,
    newestSuccessAt: newestSuccessMs === null ? null : new Date(newestSuccessMs).toISOString(),
    oldestUnsuccessfulAt:
      oldestUnsuccessfulMs === null ? null : new Date(oldestUnsuccessfulMs).toISOString(),
    latestRuns: runs.slice(0, maxRuns),
  };
}
