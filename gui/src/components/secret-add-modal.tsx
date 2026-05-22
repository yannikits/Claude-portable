/**
 * Modal fuer Secret-Add/Update via GUI (v1.x.+1, erweitert in v1.x.+2).
 *
 * Zwei Modi (Toggle persistet in localStorage):
 *   1. **Native OS-Dialog** (default) — tinyfiledialogs via Tauri-command
 *      `set_secret_native`. Wert lebt NUR im Rust-stack, niemals in
 *      Browser-DevTools / React-state. **Empfohlene Variante.**
 *   2. **Inline-Input** (fallback) — `<input type="password">` mit
 *      autoComplete="new-password" + clear-on-submit. Aus PR #96
 *      uebernommen. Fuer headless-CI, tests, oder OS ohne dialog-binary.
 *
 * Linux-fallback: wenn `set_secret_native` `dialog-unavailable` returnt
 * (kein zenity/kdialog/matedialog/qarma), wird der Modus auto auf
 * Inline gewechselt + ein Banner-Hinweis erscheint.
 *
 * @module gui/components/secret-add-modal
 */
import { useCallback, useEffect, useState } from 'react';
import { setSecret, setSecretNative } from '../lib/rpc';
import { useSidecarOk } from '../lib/sidecar-status';

export interface SecretAddModalProps {
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

const STORAGE_KEY = 'secret-input-mode';

function readMode(): 'native' | 'inline' {
  if (typeof localStorage === 'undefined') return 'native';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'inline' ? 'inline' : 'native';
}

function writeMode(mode: 'native' | 'inline'): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, mode);
}

export function SecretAddModal({ onClose, onSaved }: SecretAddModalProps) {
  const sidecarOk = useSidecarOk();
  const [mode, setMode] = useState<'native' | 'inline'>(readMode);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeFallbackReason, setNativeFallbackReason] = useState<string | null>(null);

  useEffect(() => {
    writeMode(mode);
  }, [mode]);

  const trimmedKey = key.trim();
  const canSubmit = sidecarOk && trimmedKey.length > 0 && !submitting;

  const onSubmitInline = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setError(null);
      try {
        await setSecret(trimmedKey, value);
        // SECURITY: clear value-state immediately after success.
        setValue('');
        setKey('');
        onSaved();
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'secrets-backend-locked') {
          setError(
            'Secrets-Backend ist gesperrt. Setze $CLAUDE_OS_SECRETS_KEY bevor du die App startest, oder wechsle via $CLAUDE_OS_SECRETS_BACKEND=keyring auf den OS-Keychain-Backend.',
          );
        } else {
          setError(msg);
        }
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, trimmedKey, value, onClose, onSaved],
  );

  const onSubmitNative = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await setSecretNative(trimmedKey);
      setKey('');
      onSaved();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'cancelled') {
        // User cancelled the native dialog — keep modal open, no error.
        return;
      }
      if (msg === 'dialog-unavailable') {
        // Auto-switch to inline mode + show informational banner.
        setMode('inline');
        setNativeFallbackReason(
          'Kein native dialog auf diesem System verfuegbar (Linux ohne zenity/kdialog). Inline-Fallback aktiv.',
        );
        return;
      }
      if (msg === 'secrets-backend-locked') {
        setError(
          'Secrets-Backend ist gesperrt. Setze $CLAUDE_OS_SECRETS_KEY bevor du die App startest, oder wechsle via $CLAUDE_OS_SECRETS_BACKEND=keyring auf den OS-Keychain-Backend.',
        );
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, trimmedKey, onClose, onSaved]);

  const handleClose = useCallback(() => {
    setValue('');
    setKey('');
    onClose();
  }, [onClose]);

  const warnText =
    mode === 'native'
      ? 'Der Wert wird im native OS-Dialog eingegeben und niemals im Browser-Renderer abgelegt. DevTools koennen ihn nicht abfischen.'
      : 'Der Wert wird ueber Tauri-IPC an den Sidecar uebertragen und ist waehrend der Eingabe in Browser-DevTools sichtbar. Verwende keine Keys die du nicht via Browser-Adressleiste akzeptieren wuerdest.';

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop intentional click-target
    // biome-ignore lint/a11y/useKeyWithClickEvents: ESC handled on inner panel
    <div className="modal-backdrop" onClick={handleClose}>
      <div
        className="modal-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') handleClose();
        }}
        role="dialog"
        aria-label="Add Secret"
      >
        <header className="modal-header">
          <h2>Secret hinzufuegen / aktualisieren</h2>
          <button type="button" className="modal-close" onClick={handleClose} title="Schliessen">
            ×
          </button>
        </header>

        <div className="secret-mode-toggle" role="radiogroup" aria-label="Input-Modus">
          <label>
            <input
              type="radio"
              name="secret-mode"
              value="native"
              checked={mode === 'native'}
              onChange={() => {
                setMode('native');
                setNativeFallbackReason(null);
              }}
              disabled={submitting}
              data-testid="secret-mode-native"
            />
            Native OS-Dialog <span className="muted">(empfohlen)</span>
          </label>
          <label>
            <input
              type="radio"
              name="secret-mode"
              value="inline"
              checked={mode === 'inline'}
              onChange={() => setMode('inline')}
              disabled={submitting}
              data-testid="secret-mode-inline"
            />
            Inline-Input <span className="muted">(Fallback)</span>
          </label>
        </div>

        {nativeFallbackReason !== null && (
          <p className="modal-warn-banner" data-testid="secret-fallback-banner">
            {nativeFallbackReason}
          </p>
        )}

        <p className="modal-warn-banner" data-testid="secret-warn-banner">
          <strong>Sicherheits-Hinweis:</strong> {warnText}
        </p>

        {error !== null && <p className="banner banner-error">{error}</p>}

        {mode === 'native' ? (
          <>
            <label className="modal-form-row">
              <span>Key</span>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="z.B. ANTHROPIC_API_KEY"
                autoComplete="off"
                disabled={submitting}
                data-testid="secret-key-input"
              />
            </label>
            <footer className="modal-footer">
              <button type="button" onClick={handleClose} disabled={submitting}>
                Abbrechen
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void onSubmitNative()}
                disabled={!canSubmit}
                data-testid="secret-submit"
                title={
                  sidecarOk
                    ? 'Oeffnet native OS-Dialog fuer Wert-Eingabe'
                    : 'Sidecar nicht erreichbar — Read-Only-Modus'
                }
              >
                {submitting ? 'Warte auf Dialog …' : 'Wert eingeben …'}
              </button>
            </footer>
          </>
        ) : (
          <form onSubmit={onSubmitInline}>
            <label className="modal-form-row">
              <span>Key</span>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="z.B. ANTHROPIC_API_KEY"
                autoComplete="off"
                disabled={submitting}
                data-testid="secret-key-input"
              />
            </label>
            <label className="modal-form-row">
              <span>Value</span>
              <input
                type="password"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="(geheim — wird verschluesselt gespeichert)"
                autoComplete="new-password"
                spellCheck={false}
                disabled={submitting}
                data-testid="secret-value-input"
              />
            </label>
            <footer className="modal-footer">
              <button type="button" onClick={handleClose} disabled={submitting}>
                Abbrechen
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={!canSubmit}
                data-testid="secret-submit"
                title={
                  sidecarOk ? 'Secret speichern' : 'Sidecar nicht erreichbar — Read-Only-Modus'
                }
              >
                {submitting ? 'Speichere …' : 'Speichern'}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
