import { describe, expect, it } from 'vitest';
import { bucketOf, mapVeeamSessions } from '../../../../src/domains/msp-bridges/veeam/mapper.js';
import type { VeeamSessionRaw } from '../../../../src/domains/msp-bridges/veeam/types.js';

describe('bucketOf', () => {
  it('result=Success → ok', () => {
    expect(bucketOf({ result: 'Success' })).toBe('ok');
  });
  it('result=Warning → warning', () => {
    expect(bucketOf({ result: 'Warning' })).toBe('warning');
  });
  it('result=Failed → failed', () => {
    expect(bucketOf({ result: 'Failed' })).toBe('failed');
  });
  it('state=Working with no result → running', () => {
    expect(bucketOf({ state: 'Working' })).toBe('running');
  });
  it('state=Starting → running', () => {
    expect(bucketOf({ state: 'Starting' })).toBe('running');
  });
  it('result as nested object {result:"Success"}', () => {
    expect(bucketOf({ result: { result: 'Success' } })).toBe('ok');
  });
  it('nothing usable → unknown', () => {
    expect(bucketOf({})).toBe('unknown');
  });
  it('result=None state=Idle → unknown (idle Veeam job without a recent result)', () => {
    expect(bucketOf({ result: 'None', state: 'Idle' })).toBe('unknown');
  });
});

describe('mapVeeamSessions', () => {
  it('empty input → all zeros', () => {
    const out = mapVeeamSessions([]);
    expect(out).toEqual({
      knownJobs: 0,
      missingJobs: [],
      okCount: 0,
      warningCount: 0,
      failedCount: 0,
      runningCount: 0,
      newestSuccessAt: null,
      oldestUnsuccessfulAt: null,
      latestRuns: [],
    });
  });

  it('counts per-job latest only — multiple sessions for one job', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'daily-fs', result: 'Failed', endTime: '2026-05-26T02:00:00Z' },
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-27T02:00:00Z' }, // newest
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-25T02:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions);
    expect(out.knownJobs).toBe(1);
    expect(out.okCount).toBe(1);
    expect(out.failedCount).toBe(0);
    expect(out.newestSuccessAt).toBe('2026-05-27T02:00:00.000Z');
  });

  it('mixes ok/warning/failed/running across jobs', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'a', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
      { jobName: 'b', result: 'Warning', endTime: '2026-05-27T02:00:00Z' },
      { jobName: 'c', result: 'Failed', endTime: '2026-05-26T02:00:00Z' },
      { jobName: 'd', state: 'Working' },
    ];
    const out = mapVeeamSessions(sessions);
    expect(out.knownJobs).toBe(4);
    expect(out.okCount).toBe(1);
    expect(out.warningCount).toBe(1);
    expect(out.failedCount).toBe(1);
    expect(out.runningCount).toBe(1);
    expect(out.newestSuccessAt).toBe('2026-05-28T02:00:00.000Z');
    expect(out.oldestUnsuccessfulAt).toBe('2026-05-26T02:00:00.000Z');
  });

  it('detects missing jobs (rename in Veeam UI) when filterJobNames is set', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions, {
      filterJobNames: ['daily-fs', 'weekly-dc', 'hourly-ex'],
    });
    expect(out.knownJobs).toBe(1);
    expect([...out.missingJobs].sort()).toEqual(['hourly-ex', 'weekly-dc']);
  });

  it('missingJobs is empty when no filter is set (cannot detect renames)', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions);
    expect(out.missingJobs).toEqual([]);
  });

  it('filter drops non-matching sessions', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
      { jobName: 'other-customer-job', result: 'Failed', endTime: '2026-05-28T02:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions, { filterJobNames: ['daily-fs'] });
    expect(out.knownJobs).toBe(1);
    expect(out.failedCount).toBe(0);
    expect(out.okCount).toBe(1);
  });

  it('falls back to `name` when `jobName` is absent (Veeam version variant)', () => {
    const sessions: VeeamSessionRaw[] = [
      { name: 'daily-fs', result: 'Success', endTime: '2026-05-28T02:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions);
    expect(out.knownJobs).toBe(1);
  });

  it('clips latestRuns to maxRuns', () => {
    const sessions: VeeamSessionRaw[] = Array.from({ length: 50 }, (_, i) => ({
      jobName: `job-${i}`,
      result: 'Success',
      endTime: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T02:00:00Z`,
    }));
    const out = mapVeeamSessions(sessions, { maxRuns: 5 });
    expect(out.knownJobs).toBe(50);
    expect(out.latestRuns).toHaveLength(5);
  });

  it('sorts latestRuns by newest endTime first', () => {
    const sessions: VeeamSessionRaw[] = [
      { jobName: 'old', result: 'Success', endTime: '2026-05-01T00:00:00Z' },
      { jobName: 'new', result: 'Success', endTime: '2026-05-28T00:00:00Z' },
      { jobName: 'mid', result: 'Success', endTime: '2026-05-15T00:00:00Z' },
    ];
    const out = mapVeeamSessions(sessions);
    expect(out.latestRuns.map((r) => r.jobName)).toEqual(['new', 'mid', 'old']);
  });

  it('ignores sessions with no jobName / no name', () => {
    const sessions: VeeamSessionRaw[] = [{ result: 'Success', endTime: '2026-05-28T00:00:00Z' }];
    expect(mapVeeamSessions(sessions).knownJobs).toBe(0);
  });
});
