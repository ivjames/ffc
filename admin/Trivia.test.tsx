import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Trivia from './Trivia';
import { api, type TriviaQuestion, type TriviaPage } from './api';

// What this screen has to get right is scope and scale. The platform pack is
// ~48,000 donated rows that an org_admin may READ but never write — the server
// enforces that, and a button here that 403s is a bug in its own right — and
// the list is paged because handing over the whole bank is not an option.

vi.mock('./api', () => ({
  api: {
    listTriviaQuestions: vi.fn(),
    listTriviaCategories: vi.fn(),
    saveTriviaQuestion: vi.fn(),
    archiveTriviaQuestion: vi.fn(),
  },
}));

const CATEGORIES = [
  { category: 'General Knowledge', n: 8201 },
  { category: 'Sports', n: 2819 },
  { category: 'House Pack', n: 57 },
];

const platform: TriviaQuestion = {
  id: 'q-platform',
  orgId: null,
  locationId: null,
  category: 'Music',
  prompt: 'Which Beatle played bass?',
  choices: ['John', 'Paul', 'George', 'Ringo'],
  answer: 1,
  difficulty: 2,
  active: true,
  source: 'opentriviaqa',
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
};

const mine: TriviaQuestion = {
  id: 'q-mine',
  orgId: 'org-1',
  locationId: null,
  category: 'House Pack',
  prompt: 'What year did this venue open?',
  choices: ['1998', '2004'],
  answer: 0,
  difficulty: 1,
  active: true,
  source: null,
  archivedAt: null,
  createdAt: '2026-08-01T00:00:00Z',
};

const page = (questions: TriviaQuestion[], total = questions.length, offset = 0): TriviaPage => ({
  questions,
  total,
  limit: 25,
  offset,
});

beforeEach(() => {
  vi.mocked(api.listTriviaQuestions).mockReset().mockResolvedValue(page([platform, mine]));
  vi.mocked(api.listTriviaCategories).mockReset().mockResolvedValue({ categories: CATEGORIES });
  vi.mocked(api.saveTriviaQuestion).mockReset();
  vi.mocked(api.archiveTriviaQuestion).mockReset();
});

describe('Trivia', () => {
  test('lists questions with their correct answer marked', async () => {
    render(<Trivia isSuperAdmin={true} />);
    expect(await screen.findByText('Which Beatle played bass?')).toBeInTheDocument();
    expect(screen.getByText('✓ Paul')).toBeInTheDocument();
    expect(screen.getByText('· John')).toBeInTheDocument();
  });

  test('credits imported rows and says where they came from', async () => {
    render(<Trivia isSuperAdmin={true} />);
    await screen.findByText('Which Beatle played bass?');
    expect(screen.getByText('from opentriviaqa')).toBeInTheDocument();
    // The CC BY-SA credit has to be visible wherever the pack is surfaced.
    expect(screen.getByRole('link', { name: 'OpenTriviaQA' })).toHaveAttribute(
      'href',
      'https://github.com/uberspot/OpenTriviaQA'
    );
  });

  test('an org_admin cannot edit or archive the platform pack', async () => {
    // The server returns 403 for this; rendering the buttons anyway would just
    // be an error message with extra steps.
    render(<Trivia isSuperAdmin={false} />);
    const row = (await screen.findByText('Which Beatle played bass?')).closest('div')!
      .parentElement!.parentElement!;
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(within(row).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.getByText(/Platform pack — read-only/)).toBeInTheDocument();
  });

  test("an org_admin can still edit their own venue's questions", async () => {
    render(<Trivia isSuperAdmin={false} />);
    const row = (await screen.findByText('What year did this venue open?')).closest('div')!
      .parentElement!.parentElement!;
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  test('a super_admin can edit the platform pack', async () => {
    render(<Trivia isSuperAdmin={true} />);
    const row = (await screen.findByText('Which Beatle played bass?')).closest('div')!
      .parentElement!.parentElement!;
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  test('searching debounces and passes the term to the API', async () => {
    const user = userEvent.setup();
    render(<Trivia isSuperAdmin={true} />);
    await screen.findByText('Which Beatle played bass?');
    vi.mocked(api.listTriviaQuestions).mockClear();

    await user.type(screen.getByPlaceholderText('lennon, capital of, 1969…'), 'lennon');

    // One request for the settled term, not one per keystroke — this is an
    // ILIKE over 48,000 rows.
    await waitFor(() =>
      expect(api.listTriviaQuestions).toHaveBeenCalledWith(expect.objectContaining({ q: 'lennon' }))
    );
    const withTerm = vi.mocked(api.listTriviaQuestions).mock.calls.filter((c) => c[0]?.q);
    expect(withTerm).toHaveLength(1);
  });

  test('filtering by category resets to the first page', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTriviaQuestions).mockResolvedValue(page([platform, mine], 200, 25));
    render(<Trivia isSuperAdmin={true} />);
    await screen.findByText('Which Beatle played bass?');

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.listTriviaQuestions).toHaveBeenCalledWith(expect.objectContaining({ offset: 25 }))
    );

    await user.selectOptions(screen.getByRole('combobox'), 'Sports');
    await waitFor(() =>
      expect(api.listTriviaQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'Sports', offset: 0 })
      )
    );
  });

  test('paging reports the window and stops at the ends', async () => {
    vi.mocked(api.listTriviaQuestions).mockResolvedValue(page([platform, mine], 47710, 0));
    render(<Trivia isSuperAdmin={true} />);
    expect(await screen.findByText(/1–25 of 47,710/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  test('archiving a question calls the API and reloads', async () => {
    const user = userEvent.setup();
    vi.mocked(api.archiveTriviaQuestion).mockResolvedValue({ ok: true, question: mine });
    render(<Trivia isSuperAdmin={false} />);
    const row = (await screen.findByText('What year did this venue open?')).closest('div')!
      .parentElement!.parentElement!;

    await user.click(within(row).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveTriviaQuestion).toHaveBeenCalledWith('q-mine', true));
    await waitFor(() => expect(api.listTriviaQuestions).toHaveBeenCalledTimes(2));
  });

  test('an archived row offers Restore rather than Archive', async () => {
    const user = userEvent.setup();
    vi.mocked(api.listTriviaQuestions).mockResolvedValue(
      page([{ ...mine, archivedAt: '2026-08-10T00:00:00Z' }])
    );
    render(<Trivia isSuperAdmin={false} />);
    // The screen shows a spinner until the first page lands.
    await user.click(await screen.findByRole('button', { name: 'Show archived' }));
    await waitFor(() =>
      expect(api.listTriviaQuestions).toHaveBeenCalledWith(
        expect.objectContaining({ includeArchived: true })
      )
    );
    await screen.findByText('What year did this venue open?');
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });
});

describe('the question form', () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>) {
    render(<Trivia isSuperAdmin={true} />);
    await screen.findByText('Which Beatle played bass?');
    await user.click(screen.getByRole('button', { name: 'New question' }));
  }

  test('refuses to save until the question is actually answerable', async () => {
    const user = userEvent.setup();
    await openForm(user);
    const submit = screen.getByRole('button', { name: 'Add question' });
    expect(submit).toBeDisabled();

    await user.type(screen.getByPlaceholderText('Which planet is closest to the sun?'), 'Capital of France?');
    expect(screen.getByText('Give at least two options.')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Option 1 (required)'), 'Paris');
    await user.type(screen.getByPlaceholderText('Option 2 (required)'), 'Lyon');
    await user.type(screen.getByPlaceholderText('General Knowledge'), 'Geography');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add question' })).toBeEnabled());
  });

  test('rejects two identical options, which would make the answer ambiguous', async () => {
    const user = userEvent.setup();
    await openForm(user);
    await user.type(screen.getByPlaceholderText('Which planet is closest to the sun?'), 'Pick one');
    await user.type(screen.getByPlaceholderText('Option 1 (required)'), 'Same');
    await user.type(screen.getByPlaceholderText('Option 2 (required)'), 'same');
    expect(screen.getByText('Options must be different from each other.')).toBeInTheDocument();
  });

  test('the answer index follows the option text when blank slots are trimmed', async () => {
    // The form shows four slots but sends only the filled ones. Marking slot 3
    // correct and leaving slot 2 empty must send answer 1, not 2.
    const user = userEvent.setup();
    vi.mocked(api.saveTriviaQuestion).mockResolvedValue({ ok: true, question: mine });
    await openForm(user);

    await user.type(screen.getByPlaceholderText('Which planet is closest to the sun?'), 'Capital of France?');
    await user.type(screen.getByPlaceholderText('Option 1 (required)'), 'Lyon');
    await user.type(screen.getByPlaceholderText('Option 3 (optional)'), 'Paris');
    await user.click(screen.getByLabelText('Option 3 is correct'));
    await user.type(screen.getByPlaceholderText('General Knowledge'), 'Geography');
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await waitFor(() =>
      expect(api.saveTriviaQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ choices: ['Lyon', 'Paris'], answer: 1 })
      )
    );
  });

  test('editing preserves the fields the form does not show', async () => {
    // The save endpoint replaces the whole row, so anything this form omits is
    // reset: a house question would lose its venue scope and become org-wide,
    // and a deactivated one would go back into the deal pool. Fixing a typo
    // must not do either.
    const houseRow: TriviaQuestion = {
      ...mine,
      locationId: 'loc-7',
      active: false,
    };
    vi.mocked(api.listTriviaQuestions).mockResolvedValue(page([houseRow]));
    vi.mocked(api.saveTriviaQuestion).mockResolvedValue({ ok: true, question: houseRow });
    const user = userEvent.setup();
    render(<Trivia isSuperAdmin={true} />);
    const row = (await screen.findByText('What year did this venue open?')).closest('div')!
      .parentElement!.parentElement!;

    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.saveTriviaQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q-mine', locationId: 'loc-7', active: false })
      )
    );
  });

  test('a new question is org-wide and live by default', async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveTriviaQuestion).mockResolvedValue({ ok: true, question: mine });
    await openForm(user);
    await user.type(screen.getByPlaceholderText('Which planet is closest to the sun?'), 'Capital of France?');
    await user.type(screen.getByPlaceholderText('Option 1 (required)'), 'Paris');
    await user.type(screen.getByPlaceholderText('Option 2 (required)'), 'Lyon');
    await user.type(screen.getByPlaceholderText('General Knowledge'), 'Geography');
    await user.click(screen.getByRole('button', { name: 'Add question' }));

    await waitFor(() =>
      expect(api.saveTriviaQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: null, active: true })
      )
    );
  });

  test('editing an existing question sends its id', async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveTriviaQuestion).mockResolvedValue({ ok: true, question: platform });
    render(<Trivia isSuperAdmin={true} />);
    const row = (await screen.findByText('Which Beatle played bass?')).closest('div')!
      .parentElement!.parentElement!;

    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.saveTriviaQuestion).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'q-platform', prompt: 'Which Beatle played bass?', answer: 1 })
      )
    );
  });
});
