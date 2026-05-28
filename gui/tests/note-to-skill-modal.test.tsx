import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoteToSkillModal } from '../src/components/note-to-skill-modal';

type Fn = (...args: unknown[]) => unknown;
const rpcMocks: { proposeNoteAsSkill: Fn; createSkillDraftFromNote: Fn } = {
  proposeNoteAsSkill: vi.fn() as Fn,
  createSkillDraftFromNote: vi.fn() as Fn,
};

vi.mock('../src/lib/rpc', () => ({
  proposeNoteAsSkill: (...args: unknown[]) => rpcMocks.proposeNoteAsSkill(...args),
  createSkillDraftFromNote: (...args: unknown[]) => rpcMocks.createSkillDraftFromNote(...args),
}));

const NOTE_PATH = '/vault/Claude-OS/workspaces/personal/notes/2026-05-28-m365.md';

const HAPPY_PROPOSAL = {
  ok: true as const,
  proposed: {
    name: 'm365-reset',
    workspace: 'personal',
    classification: 'personal',
    content: '---\nname: m365-reset\n---\n\n# M365 Reset\n\nbody',
    targetPath: '/vault/.../skills/_drafts/m365-reset/SKILL.md',
    alreadyExists: false,
  },
};

beforeEach(() => {
  rpcMocks.proposeNoteAsSkill = vi.fn() as Fn;
  rpcMocks.createSkillDraftFromNote = vi.fn() as Fn;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoteToSkillModal', () => {
  it('shows the loading state while the proposal is in-flight', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockReturnValue(
      new Promise(() => {
        /* never resolves */
      }),
    );
    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    expect(screen.getByText('Lade Vorschlag …')).toBeTruthy();
  });

  it('renders the proposal + pre-populates the name field', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce(HAPPY_PROPOSAL);

    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => {
      const nameInput = screen.getByLabelText(/Skill-Name/) as HTMLInputElement;
      expect(nameInput.value).toBe('m365-reset');
    });
    expect(screen.getByText(/M365 Reset/)).toBeTruthy();
  });

  it('shows sensitive-banner for customer-confidential proposals', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      proposed: { ...HAPPY_PROPOSAL.proposed, classification: 'customer-confidential' },
    });

    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(screen.getByText(/Customer-Confidential/)).toBeTruthy();
    });
  });

  it('warns when target draft already exists and disables submit', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      proposed: { ...HAPPY_PROPOSAL.proposed, alreadyExists: true },
    });

    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/existiert bereits/)).toBeTruthy();
      const submit = screen.getByRole('button', { name: /Draft erzeugen/ }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
    });
  });

  it('submits createSkillDraftFromNote and triggers onCreated on success', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce(HAPPY_PROPOSAL);
    (rpcMocks.createSkillDraftFromNote as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      created: { name: 'm365-reset', workspace: 'personal', path: '/p/SKILL.md' },
    });

    const onCreated = vi.fn();
    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={onCreated} />);
    await waitFor(() => screen.getByLabelText(/Skill-Name/));
    fireEvent.click(screen.getByRole('button', { name: /Draft erzeugen/ }));
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledWith({
        name: 'm365-reset',
        workspace: 'personal',
        path: '/p/SKILL.md',
      });
    });
  });

  it('surfaces draft-exists error on submit', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce(HAPPY_PROPOSAL);
    (rpcMocks.createSkillDraftFromNote as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'draft-exists',
      message: 'already there',
    });

    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => screen.getByLabelText(/Skill-Name/));
    fireEvent.click(screen.getByRole('button', { name: /Draft erzeugen/ }));
    await waitFor(() => {
      expect(screen.getByText(/Draft mit diesem Namen existiert bereits/)).toBeTruthy();
    });
  });

  it('shows note-not-found error from the initial proposal', async () => {
    (rpcMocks.proposeNoteAsSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'note-not-found',
      message: 'gone',
    });

    render(<NoteToSkillModal notePath={NOTE_PATH} onClose={() => {}} onCreated={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/Note nicht gefunden/)).toBeTruthy();
    });
  });
});
