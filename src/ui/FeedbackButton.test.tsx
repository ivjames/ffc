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
// The real capture renders the DOM through an SVG foreignObject, which jsdom
// cannot paint — so the module is mocked. Default: capture is available (it is,
// on every real device) but returns no frame, which keeps the note-writing
// tests focused on the note.
vi.mock('../lib/screenCapture', () => ({
  CAPTURE_IGNORE_ATTR: 'data-feedback-ignore',
  isScreenCaptureSupported: vi.fn(() => true),
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
  vi.mocked(isScreenCaptureSupported).mockReset().mockReturnValue(true);
  vi.mocked(captureScreen).mockReset().mockResolvedValue(null);
});

/** Have the next press come back with a grabbed frame. */
function withGrabbedFrame(
  shot: File = new File(['px'], 'screen.jpg', { type: 'image/jpeg' })
) {
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

  it('opts back into pointer events — App mounts it in a pass-through overlay', async () => {
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
    const sheet = await screen.findByRole('dialog');
    expect(sheet.className).toContain('pointer-events-auto');
  });

  it('grabs the screen when pressed, and attaches the frame to the note', async () => {
    const shot = withGrabbedFrame();
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

  it('opens the sheet anyway when the grab comes back empty', async () => {
    // A missing screenshot is a far smaller problem than a lost comment, so it
    // is never surfaced as an error.
    await openSheet();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByAltText(/screenshot to attach/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/grabbed the screen/i)).not.toBeInTheDocument();
    // The manual attach path is still right there.
    expect(screen.getByLabelText(/attach a screenshot/i)).toBeInTheDocument();
  });

  it('opens the sheet anyway when the capture throws', async () => {
    vi.mocked(captureScreen).mockRejectedValue(new Error('capture exploded'));
    await openSheet();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('skips the grab where the DOM render cannot run at all', async () => {
    vi.mocked(isScreenCaptureSupported).mockReturnValue(false);
    await openSheet();
    expect(captureScreen).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/attach a screenshot/i)).toBeInTheDocument();
  });

  it('lets a grabbed frame be removed, and a different image attached over it', async () => {
    withGrabbedFrame();
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
