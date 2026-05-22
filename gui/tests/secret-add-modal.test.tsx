import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async () => () => {},
}));

vi.mock('../src/lib/sidecar-status', () => ({
  useSidecarOk: () => true,
  useSidecarStatus: () => ({ ok: true, failure: null }),
}));

beforeEach(() => {
  invokeMock.mockReset();
  // Reset localStorage so each test starts with default-native mode.
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('secret-input-mode');
  }
});

describe('SecretAddModal', () => {
  it('renders mode-toggle with native default + key-input + submit-button', async () => {
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);

    const nativeRadio = screen.getByTestId('secret-mode-native') as HTMLInputElement;
    const inlineRadio = screen.getByTestId('secret-mode-inline') as HTMLInputElement;
    expect(nativeRadio.checked).toBe(true);
    expect(inlineRadio.checked).toBe(false);

    expect(screen.getByTestId('secret-warn-banner').textContent).toMatch(/native OS-Dialog/);
    expect(screen.getByTestId('secret-key-input')).toBeInTheDocument();
    expect(screen.getByTestId('secret-submit')).toBeInTheDocument();
    // Value-input only exists in inline mode
    expect(screen.queryByTestId('secret-value-input')).not.toBeInTheDocument();
  });

  it('native-mode: submit invokes set_secret_native tauri-command with key only', async () => {
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd === 'set_secret_native') {
        const p = args as { key: string };
        expect(p.key).toBe('NATIVE_KEY');
        return { key: 'NATIVE_KEY', backend: 'encrypted-file', updated: false };
      }
      throw new Error(`unmocked: ${cmd}`);
    });

    const onSaved = vi.fn();
    const onClose = vi.fn();
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={onClose} onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId('secret-key-input'), { target: { value: 'NATIVE_KEY' } });
    fireEvent.click(screen.getByTestId('secret-submit'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('set_secret_native', { key: 'NATIVE_KEY' });
      expect(onSaved).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('native-mode: dialog-unavailable error auto-switches to inline + shows fallback banner', async () => {
    invokeMock.mockImplementation(async () => {
      throw new Error('dialog-unavailable');
    });

    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);

    fireEvent.change(screen.getByTestId('secret-key-input'), { target: { value: 'TEST' } });
    fireEvent.click(screen.getByTestId('secret-submit'));

    // Wait for fallback to fire
    await waitFor(() => {
      expect(screen.getByTestId('secret-fallback-banner')).toBeInTheDocument();
      // Inline-mode should now be active
      const inlineRadio = screen.getByTestId('secret-mode-inline') as HTMLInputElement;
      expect(inlineRadio.checked).toBe(true);
      // Value-input should now be visible
      expect(screen.getByTestId('secret-value-input')).toBeInTheDocument();
    });
  });

  it('native-mode: cancelled error keeps modal open without any banner', async () => {
    invokeMock.mockImplementation(async () => {
      throw new Error('cancelled');
    });

    const onClose = vi.fn();
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={onClose} onSaved={() => {}} />);

    fireEvent.change(screen.getByTestId('secret-key-input'), { target: { value: 'TEST' } });
    fireEvent.click(screen.getByTestId('secret-submit'));

    await new Promise((r) => setTimeout(r, 50));
    expect(onClose).not.toHaveBeenCalled();
    // No error banner because cancel is silent
    expect(screen.queryByText(/Sicherheits-Hinweis.*Tauri-IPC/)).toBeNull();
  });

  it('inline-mode: submit calls secrets.set with key+value', async () => {
    invokeMock.mockImplementation(async (cmd, args) => {
      if (cmd !== 'rpc_call') return null;
      const { method, params } = args as { method: string; params: unknown };
      if (method === 'secrets.set') {
        const p = params as { key: string; value: string };
        expect(p.key).toBe('TEST_KEY');
        expect(p.value).toBe('super-secret-value');
        return { key: p.key, backend: 'encrypted-file', updated: false };
      }
      throw new Error(`unmocked: ${method}`);
    });

    const onSaved = vi.fn();
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={() => {}} onSaved={onSaved} />);

    // Switch to inline mode
    fireEvent.click(screen.getByTestId('secret-mode-inline'));

    fireEvent.change(screen.getByTestId('secret-key-input'), { target: { value: 'TEST_KEY' } });
    fireEvent.change(screen.getByTestId('secret-value-input'), {
      target: { value: 'super-secret-value' },
    });
    fireEvent.click(screen.getByTestId('secret-submit'));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        'rpc_call',
        expect.objectContaining({ method: 'secrets.set' }),
      );
      expect(onSaved).toHaveBeenCalledTimes(1);
    });
  });

  it('inline-mode: secrets-backend-locked error shows specific hint', async () => {
    invokeMock.mockImplementation(async () => {
      throw new Error('secrets-backend-locked');
    });

    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByTestId('secret-mode-inline'));
    fireEvent.change(screen.getByTestId('secret-key-input'), { target: { value: 'X' } });
    fireEvent.change(screen.getByTestId('secret-value-input'), { target: { value: 'Y' } });
    fireEvent.click(screen.getByTestId('secret-submit'));

    expect(await screen.findByText(/CLAUDE_OS_SECRETS_KEY/)).toBeInTheDocument();
  });

  it('does not submit when key is empty (both modes)', async () => {
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);

    const submitNative = screen.getByTestId('secret-submit') as HTMLButtonElement;
    expect(submitNative.disabled).toBe(true);
    fireEvent.click(submitNative);

    fireEvent.click(screen.getByTestId('secret-mode-inline'));
    fireEvent.change(screen.getByTestId('secret-value-input'), { target: { value: 'foo' } });
    const submitInline = screen.getByTestId('secret-submit') as HTMLButtonElement;
    expect(submitInline.disabled).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('mode-toggle persists in localStorage', async () => {
    const { SecretAddModal } = await import('../src/components/secret-add-modal');
    const { unmount } = render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);

    fireEvent.click(screen.getByTestId('secret-mode-inline'));
    expect(localStorage.getItem('secret-input-mode')).toBe('inline');

    unmount();
    render(<SecretAddModal onClose={() => {}} onSaved={() => {}} />);
    const inlineRadio = screen.getByTestId('secret-mode-inline') as HTMLInputElement;
    expect(inlineRadio.checked).toBe(true);
  });
});
