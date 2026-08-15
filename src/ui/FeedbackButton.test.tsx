// @vitest-environment jsdom
// The reviewer commentary widget. What's worth protecting here is the
// contract a reviewer relies on: the note is attached to the screen they were
// looking at, an empty note can't be sent, and a failure never silently eats
// what they typed.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FeedbackButton from './FeedbackButton';
import { submitFeedback, getReviewerName } from '../lib/feedbackApi';

vi.mock('../lib/feedbackApi', async (importOriginal) => {
  // Keep the real name-memory helpers (they're localStorage, which jsdom has)
  // and the char ceiling; only the network call is mocked.
  const actual = await importOriginal<typeof import('../lib/feedbackApi')>();
  return { ...actual, submitFeedback: vi.fn() };
});
// The UI kit's buttons play a click; jsdom has no audio.
vi.mock('../lib/sound', () => ({
  playClick: vi.fn(),
  playStroke: vi.fn(),
  playUndo: vi.fn(),
  playCup: vi.fn(),
}));

// jsdom implements neither half of the object-URL API. The widget uses them
// for the attachment preview, so stub them and assert the pairing (a leaked
// blob URL would outlive the SPA).
const objectUrls = { created: 0, revoked: 0 };
URL.createObjectURL = vi.fn(() => `blob:preview-${++objectUrls.created}`);
URL.revokeObjectURL = vi.fn(() => {
  objectUrls.revoked += 1;
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <FeedbackButton />
    </MemoryRouter>
  );
}

async function openSheet(path = '/golf/play') {
  const user = userEvent.setup();
  renderAt(path);
  await user.click(screen.getByRole('button', { name: /feedback/i }));
  return user;
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(submitFeedback).mockReset().mockResolvedValue({
    ok: true,
    id: 'fb-1',
    createdAt: '2026-08-15T00:00:00Z',
    hasScreenshot: false,
  });
});

afterEach(cleanup);

describe('FeedbackButton', () => {
  it('stays out of the way until tapped', () => {
    renderAt('/golf/play');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the reviewer which screen the note will be filed against', async () => {
    await openSheet('/arcade/skeeball');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('/arcade/skeeball')).toBeInTheDocument();
  });

  it('will not send an empty note', async () => {
    const user = await openSheet();
    const send = screen.getByRole('button', { name: /send note/i });
    expect(send).toBeDisabled();

    // Whitespace is not a comment.
    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), '   ');
    expect(send).toBeDisabled();
  });

  it('sends the comment with its screen and remembers the reviewer name', async () => {
    const user = await openSheet('/golf/play');
    await user.type(
      screen.getByRole('textbox', { name: /what's on your mind/i }),
      'the hole numbers wash out in sunlight'
    );
    await user.type(screen.getByRole('textbox', { name: /your name/i }), 'Sam');
    await user.click(screen.getByRole('button', { name: /send note/i }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith({
        body: 'the hole numbers wash out in sunlight',
        screenPath: '/golf/play',
        reviewer: 'Sam',
        screenshot: null,
      })
    );
    // Confirmed, and the name is kept for the next note.
    expect(await screen.findByText(/noted/i)).toBeInTheDocument();
    expect(getReviewerName()).toBe('Sam');
  });

  it('keeps the typed note on the screen when sending fails', async () => {
    vi.mocked(submitFeedback).mockRejectedValue(new Error('feedback limit exceeded'));
    const user = await openSheet();
    const box = screen.getByRole('textbox', { name: /what's on your mind/i });
    await user.type(box, 'this must not vanish');
    await user.click(screen.getByRole('button', { name: /send note/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('feedback limit exceeded');
    expect(box).toHaveValue('this must not vanish');
    expect(screen.getByRole('button', { name: /send note/i })).toBeEnabled();
  });

  it('tells the reviewer when the comment landed but the screenshot did not', async () => {
    vi.mocked(submitFeedback).mockResolvedValue({
      ok: true,
      id: 'fb-2',
      createdAt: '2026-08-15T00:00:00Z',
      hasScreenshot: false,
      screenshotDropped: true,
    });
    const user = await openSheet();
    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), 'see attached');
    await user.click(screen.getByRole('button', { name: /send note/i }));

    expect(await screen.findByText(/screenshot could not be stored/i)).toBeInTheDocument();
  });

  it('attaches a chosen screenshot and can drop it again', async () => {
    const user = await openSheet();
    const file = new File(['bytes'], 'shot.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/attach a screenshot/i), file);

    expect(await screen.findByAltText(/screenshot to attach/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove/i }));
    expect(screen.queryByAltText(/screenshot to attach/i)).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), 'never mind');
    await user.click(screen.getByRole('button', { name: /send note/i }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ screenshot: null }))
    );
    // Dropping the attachment released its preview URL.
    expect(objectUrls.revoked).toBe(objectUrls.created);
  });

  it('closes on Escape', async () => {
    const user = await openSheet();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
