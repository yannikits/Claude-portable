import { describe, expect, it } from 'vitest';
import { checkTanssConfig } from '../../../src/core/doctor/checks.js';

const tokenProbe = (value: string | null) => async () => value;

describe('checkTanssConfig', () => {
  it('ok when neither URL nor apiToken are set', async () => {
    const res = await checkTanssConfig({}, tokenProbe(null));
    expect(res.severity).toBe('ok');
    expect(res.message).toContain('not configured');
  });

  it('ok when both URL and apiToken are set', async () => {
    const res = await checkTanssConfig(
      { CLAUDE_OS_TANSS_SERVER_URL: 'https://tanss.example.com' },
      tokenProbe('apiKey-XYZ'),
    );
    expect(res.severity).toBe('ok');
    expect(res.message).toContain('https://tanss.example.com');
  });

  it('warn when URL set but apiToken missing — hints at `secrets set`', async () => {
    const res = await checkTanssConfig(
      { CLAUDE_OS_TANSS_SERVER_URL: 'https://tanss.example.com' },
      tokenProbe(null),
    );
    expect(res.severity).toBe('warn');
    expect(res.hint ?? '').toContain('claude-os secrets set tanss/apiToken');
  });

  it('warn when apiToken set but URL missing — hints at the env var', async () => {
    const res = await checkTanssConfig({}, tokenProbe('apiKey-XYZ'));
    expect(res.severity).toBe('warn');
    expect(res.hint ?? '').toContain('CLAUDE_OS_TANSS_SERVER_URL');
  });

  it('warn when URL is whitespace-only (treats as unset)', async () => {
    const res = await checkTanssConfig({ CLAUDE_OS_TANSS_SERVER_URL: '   ' }, tokenProbe('t'));
    expect(res.severity).toBe('warn');
    expect(res.message).toContain('apiToken in secrets-backend');
  });

  it('warn when secrets-probe throws — does not bubble', async () => {
    const res = await checkTanssConfig(
      { CLAUDE_OS_TANSS_SERVER_URL: 'https://tanss.example.com' },
      async () => {
        throw new Error('keyring offline');
      },
    );
    expect(res.severity).toBe('warn');
    expect(res.message).toContain('secrets-store probe failed');
  });

  it('never returns severity=fail (TANSS is optional)', async () => {
    const all = await Promise.all([
      checkTanssConfig({}, tokenProbe(null)),
      checkTanssConfig({ CLAUDE_OS_TANSS_SERVER_URL: 'x' }, tokenProbe(null)),
      checkTanssConfig({}, tokenProbe('x')),
      checkTanssConfig({ CLAUDE_OS_TANSS_SERVER_URL: 'x' }, tokenProbe('x')),
    ]);
    for (const r of all) expect(r.severity).not.toBe('fail');
  });
});
