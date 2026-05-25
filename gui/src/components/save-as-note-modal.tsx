/**
 * Save-as-Note modal — accepts a body (pre-filled e.g. from a chat
 * response) and writes it via `notes.save` RPC.
 *
 * The body string ENTERS the renderer, so this is fine for non-secret
 * content. For secret-bearing payloads use the native-dialog pattern
 * (ADR-0023) instead.
 *
 * Phase 2f (Memory MVP GUI).
 */
import { useCallback, useEffect, useState } from 'react';
import { type NoteClassification, saveNote } from '../lib/rpc';

interface Props {
  initialBody: string;
  /** Pre-fill workspace (defaults to "active workspace" via sidecar). */
  initialWorkspace?: string;
  onClose: () => void;
  onSaved?: (path: string) => void;
}

const CLASSIFICATIONS: readonly NoteClassification[] = [
  'personal',
  'operational',
  'customer-confidential',
  'secret',
  'ephemeral',
];

const TYPES = ['session', 'skill-memory', 'person', 'project'] as const;

function defaultFilename(): string {
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  return `${iso}.md`;
}

export function SaveAsNoteModal({ initialBody, initialWorkspace, onClose, onSaved }: Props) {
  const [filename, setFilename] = useState<string>(defaultFilename());
  const [body, setBody] = useState<string>(initialBody);
  const [classification, setClassification] = useState<NoteClassification>('personal');
  const [type, setType] = useState<string>('');
  const [tags, setTags] = useState<string>('');
  const [tenant, setTenant] = useState<string>('');
  const [overwrite, setOverwrite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lock background scroll while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setError(null);
      try {
        const tagList = tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        const res = await saveNote({
          filename,
          body,
          ...(initialWorkspace !== undefined ? { workspace: initialWorkspace } : {}),
          overwrite,
          frontmatter: {
            classification,
            schema_version: 1,
            ...(type.length > 0 ? { type: type as (typeof TYPES)[number] } : {}),
            ...(tagList.length > 0 ? { tags: tagList } : {}),
            ...(tenant.length > 0 ? { tenant } : {}),
          },
        });
        onSaved?.(res.path);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    },
    [
      filename,
      body,
      classification,
      type,
      tags,
      tenant,
      overwrite,
      initialWorkspace,
      onClose,
      onSaved,
    ],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dialog-backdrop pattern; modal itself has role=dialog
    <div
      className="modal-backdrop"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only — dialog itself receives focus */}
      <div
        className="modal save-note-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Save as note"
      >
        <h2>Save as Note</h2>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label>
            Filename:
            <input
              type="text"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              required
              disabled={saving}
            />
          </label>

          <label>
            Body:
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              required
              disabled={saving}
            />
          </label>

          <div className="form-row">
            <label>
              Classification:
              <select
                value={classification}
                onChange={(e) => setClassification(e.target.value as NoteClassification)}
                disabled={saving}
              >
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Type (optional):
              <select value={type} onChange={(e) => setType(e.target.value)} disabled={saving}>
                <option value="">—</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Tags (comma-separated, optional):
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="kubernetes, docker, prod"
              disabled={saving}
            />
          </label>

          <label>
            Tenant (only for msp-customers/* workspaces):
            <input
              type="text"
              value={tenant}
              onChange={(e) => setTenant(e.target.value)}
              placeholder="customer-id"
              disabled={saving}
            />
          </label>

          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              disabled={saving}
            />{' '}
            Overwrite if exists
          </label>

          {error !== null && <div className="form-error">Save failed: {error}</div>}

          <div className="form-actions">
            <button type="button" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
