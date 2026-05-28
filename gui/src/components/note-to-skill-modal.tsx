/**
 * NoteToSkillModal (MSP-E GUI) — turns a vault note into a draft
 * skill in two clicks. Backed by the MSP-E backend RPCs
 * (`notes.proposeAsSkill` + `notes.createSkillDraftFromNote`).
 *
 * Flow:
 *   1. Mount → call proposeAsSkill (read-only, no write side-effect).
 *      Pre-populates name + classification + content preview.
 *   2. User edits name / useWhen / toggles preserveCustomerData.
 *   3. On any edit → debounce → re-propose to refresh the preview.
 *   4. Submit → createSkillDraftFromNote, then onCreated callback.
 *
 * The sensitive-banner pattern from SkillDiffView is reused for
 * customer-confidential notes — explicit visual cue before user
 * decides to lift PII into the (long-lived) skill bucket.
 *
 * @module gui/components/note-to-skill-modal
 */
import { useCallback, useEffect, useState } from 'react';
import {
  createSkillDraftFromNote,
  type NoteProposalResult,
  type NoteToSkillError,
  proposeNoteAsSkill,
} from '../lib/rpc';

export interface NoteToSkillModalProps {
  readonly notePath: string;
  readonly onClose: () => void;
  readonly onCreated: (created: { name: string; path: string; workspace: string }) => void;
}

interface ProposalState {
  readonly loading: boolean;
  readonly error: string | null;
  readonly proposal: Extract<NoteProposalResult, { ok: true }>['proposed'] | null;
}

const INITIAL: ProposalState = { loading: true, error: null, proposal: null };

function describeError(code: NoteToSkillError['code']): string {
  switch (code) {
    case 'note-not-found':
      return 'Note nicht gefunden (Pfad geändert?).';
    case 'draft-exists':
      return 'Ein Draft mit diesem Namen existiert bereits.';
    case 'invalid-name':
      return 'Name muss `[a-z0-9][a-z0-9_-]*` matchen.';
  }
}

export function NoteToSkillModal({ notePath, onClose, onCreated }: NoteToSkillModalProps) {
  const [proposal, setProposal] = useState<ProposalState>(INITIAL);
  const [name, setName] = useState('');
  const [useWhen, setUseWhen] = useState('');
  const [preserveCustomerData, setPreserveCustomerData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Initial fetch (auto-name from server).
  useEffect(() => {
    let cancelled = false;
    setProposal({ loading: true, error: null, proposal: null });
    proposeNoteAsSkill(notePath)
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setProposal({ loading: false, error: null, proposal: r.proposed });
          setName(r.proposed.name);
        } else {
          setProposal({ loading: false, error: describeError(r.code), proposal: null });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setProposal({
          loading: false,
          error: err instanceof Error ? err.message : String(err),
          proposal: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  // Debounced re-propose on edit so the preview stays honest.
  // `hasProposal` is hoisted so the effect only depends on a boolean rather
  // than the whole proposal object — otherwise every refresh would re-trigger.
  const hasProposal = proposal.proposal !== null;
  useEffect(() => {
    if (!hasProposal) return;
    const timer = setTimeout(() => {
      let cancelled = false;
      proposeNoteAsSkill(notePath, {
        ...(name.trim().length > 0 ? { name: name.trim() } : {}),
        ...(useWhen.trim().length > 0 ? { useWhen: useWhen.trim() } : {}),
        preserveCustomerData,
      })
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setProposal((prev) =>
              prev.proposal === null ? prev : { ...prev, proposal: r.proposed },
            );
          }
        })
        .catch(() => {
          /* ignore refresh-error — submit-time validation re-checks */
        });
      return () => {
        cancelled = true;
      };
    }, 250);
    return () => clearTimeout(timer);
  }, [notePath, name, useWhen, preserveCustomerData, hasProposal]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      setSubmitting(true);
      setSubmitError(null);
      try {
        const result = await createSkillDraftFromNote({
          notePath,
          draftSpec: {
            ...(name.trim().length > 0 ? { name: name.trim() } : {}),
            ...(useWhen.trim().length > 0 ? { useWhen: useWhen.trim() } : {}),
            preserveCustomerData,
          },
        });
        if (result.ok) {
          onCreated(result.created);
        } else {
          setSubmitError(describeError(result.code));
        }
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, notePath, name, useWhen, preserveCustomerData, onCreated],
  );

  return (
    <div className="modal-backdrop">
      <button
        type="button"
        className="modal-backdrop-button"
        aria-label="Modal schließen"
        onClick={onClose}
      />
      <div
        className="modal note-to-skill-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Note als Skill speichern"
      >
        <h2>Note als Skill speichern</h2>
        <p className="note-to-skill-modal__source">
          Quelle: <code>{notePath}</code>
        </p>

        {proposal.loading ? (
          <p>Lade Vorschlag …</p>
        ) : proposal.error !== null ? (
          <div className="banner banner-error" role="alert">
            {proposal.error}
          </div>
        ) : proposal.proposal !== null ? (
          <form onSubmit={handleSubmit}>
            {proposal.proposal.classification === 'customer-confidential' && (
              <div className="skill-diff__sensitive-banner" role="alert">
                <strong>Customer-Confidential</strong> — Quelle berührt Customer-Daten. Body wird
                best-effort PII-redacted; manuelles Review pflicht.
              </div>
            )}

            <label className="modal-form-row">
              <span>Skill-Name (kebab-case)</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                pattern="[a-z0-9][a-z0-9_-]*"
                spellCheck={false}
                disabled={submitting}
              />
            </label>

            <label className="modal-form-row">
              <span>Wann soll der Skill triggern? (description)</span>
              <input
                type="text"
                value={useWhen}
                onChange={(e) => setUseWhen(e.target.value)}
                disabled={submitting}
                placeholder="z.B. Wenn ein M365-License-Reset benötigt wird"
              />
            </label>

            <label className="modal-form-row note-to-skill-modal__checkbox-row">
              <input
                type="checkbox"
                checked={preserveCustomerData}
                onChange={(e) => setPreserveCustomerData(e.target.checked)}
                disabled={submitting}
              />
              <span>PII NICHT redact (Emails/Phones/IPs/Customer-IDs unredacted übernehmen)</span>
            </label>

            <details className="note-to-skill-modal__preview">
              <summary>Vorschau SKILL.md</summary>
              <pre className="modal-code">{proposal.proposal.content}</pre>
            </details>

            <p className="note-to-skill-modal__meta">
              Ziel: <code>{proposal.proposal.targetPath}</code>
              {proposal.proposal.alreadyExists && (
                <span className="note-to-skill-modal__warn">
                  ⚠ Draft mit diesem Namen existiert bereits — bitte umbenennen
                </span>
              )}
            </p>

            {submitError !== null && (
              <div className="banner banner-error" role="alert">
                {submitError}
              </div>
            )}

            <div className="modal-footer">
              <button type="button" onClick={onClose} disabled={submitting}>
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={submitting || proposal.proposal.alreadyExists || name.trim().length === 0}
              >
                {submitting ? 'Erzeuge Draft …' : 'Draft erzeugen'}
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
