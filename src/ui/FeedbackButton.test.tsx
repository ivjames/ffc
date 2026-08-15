// @vitest-environment jsdom
// The reviewer commentary widget. What's worth protecting here is the
// contract a reviewer relies on: the note is attached to the screen they were
// looking at, an empty note can't be sent, and a failure never silently eats
// what they typed.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import FeedbackButton from './FeedbackButton';
import { submitFeedback, getReviewerName } from '../lib/feedbackApi';
import { captureScreen, isScreenCaptureSupported } from '../lib/screenCapture';

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
// jsdom implements no screen-capture API. Default to "unsupported", which is
// also the truth on every phone — the tests that care opt in per case.
vi.mock('../lib/screenCapture', () => ({
  isScreenCaptureSupported: vi.fn(() => false),
  captureScreen: vi.fn(async () => null),
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
  vi.mocked(isScreenCaptureSupported).mockReset().mockReturnValue(false);
  vi.mocked(captureScreen).mockReset().mockResolvedValue(null);
});

/** Put the suite on a browser that can grab the screen, returning the frame it
 *  will hand back (desktop reviewers; phones never take this path). */
function onCapableBrowser(shot: File | null = new File(['px'], 'screen.png', { type: 'image/png' })) {
  vi.mocked(isScreenCaptureSupported).mockReturnValue(true);
  vi.mocked(captureScreen).mockResolvedValue(shot);
  return shot;
}

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

  it('drops a previously attached screenshot when a replacement is rejected', async () => {
    const user = await openSheet();
    const good = new File(['bytes'], 'good.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/attach a screenshot/i), good);
    expect(await screen.findByAltText(/screenshot to attach/i)).toBeInTheDocument();

    // Oversized replacement: the input now shows the rejected file's name, so
    // keeping the old one staged would send evidence the reviewer believes
    // they replaced.
    const huge = new File([new Uint8Array(2)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 26 * 1024 * 1024 });
    await user.upload(screen.getByLabelText(/attach a screenshot/i), huge);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large/i);
    expect(screen.queryByAltText(/screenshot to attach/i)).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), 'no shot then');
    await user.click(screen.getByRole('button', { name: /send note/i }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ screenshot: null }))
    );
  });

  it('opts back into pointer events — App mounts it in a pass-through overlay', () => {
    // The sheet renders inside App's `pointer-events-none` corner overlay. If
    // it doesn't opt back in, it paints perfectly and ignores every tap, which
    // rendering the widget bare (as these tests do) would never reveal.
    render(
      <MemoryRouter initialEntries={['/golf/play']}>
        <div className="pointer-events-none">
          <FeedbackButton />
        </div>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /feedback/i }));
    expect(screen.getByRole('dialog').className).toContain('pointer-events-auto');
  });

  it('grabs the screen when pressed, and attaches the frame to the note', async () => {
    const shot = onCapableBrowser();
    const user = await openSheet('/golf/play');

    // Captured on press — before the sheet exists, so the shot shows the
    // screen the reviewer was looking at rather than the sheet over it.
    expect(captureScreen).toHaveBeenCalledTimes(1);
    expect(await screen.findByAltText(/screenshot to attach/i)).toBeInTheDocument();
    expect(screen.getByText(/grabbed the screen when you opened this note/i)).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), 'look at this');
    await user.click(screen.getByRole('button', { name: /send note/i }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ screenshot: shot }))
    );
  });

  it('opens the sheet anyway when the reviewer dismisses the capture prompt', async () => {
    // Declining to share your screen is a choice, not a failure.
    onCapableBrowser(null);
    await openSheet();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByAltText(/screenshot to attach/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/grabbed the screen/i)).not.toBeInTheDocument();
  });

  it('opens the sheet anyway when the capture throws', async () => {
    vi.mocked(isScreenCaptureSupported).mockReturnValue(true);
    vi.mocked(captureScreen).mockRejectedValue(new Error('capture exploded'));
    await openSheet();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never asks to capture on a browser that cannot (every phone)', async () => {
    await openSheet();
    expect(captureScreen).not.toHaveBeenCalled();
    // The manual attach path is still right there.
    expect(screen.getByLabelText(/attach a screenshot/i)).toBeInTheDocument();
  });

  it('lets a grabbed frame be removed, and a different image attached over it', async () => {
    onCapableBrowser();
    const user = await openSheet();
    expect(await screen.findByAltText(/screenshot to attach/i)).toBeInTheDocument();

    const own = new File(['bytes'], 'mine.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText(/attach a different screenshot/i), own);
    // Replacing the grab drops the "we took this for you" note.
    await waitFor(() =>
      expect(screen.queryByText(/grabbed the screen/i)).not.toBeInTheDocument()
    );

    await user.type(screen.getByRole('textbox', { name: /what's on your mind/i }), 'mine instead');
    await user.click(screen.getByRole('button', { name: /send note/i }));
    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(expect.objectContaining({ screenshot: own }))
    );
  });

  it('closes on Escape', async () => {
    const user = await openSheet();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
