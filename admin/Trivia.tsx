import { useEffect, useState } from 'react';
import { api, type TriviaQuestion, type TriviaCategory } from './api';
import {
  Banner, Button, Card, EmptyState, Field, Input, PageHeader, Pill, Select, Spinner,
  useAsync, useToast,
} from './ui';

// The live-trivia question bank (server/routes/admin/triviaQuestions.js).
//
// This screen exists because the bank stopped being small. The OpenTriviaQA
// import puts ~48,000 donated questions in the platform pack, and until now the
// only way to see what a host would actually deal was psql. So the three things
// it has to do are review-shaped, not authoring-shaped: narrow the pile, find
// one specific question, and retire anything that shouldn't be on a screen.
//
// Three scopes share one table and the server decides who may touch what:
//   org_id null              the platform pack — read-only to an org_admin,
//                            because one venue's edit would change what every
//                            other venue's trivia night deals
//   org_id set               that client's own questions
//   org_id + location_id     house questions for one venue
// The UI mirrors those rules so a button never appears that the API will
// refuse, but the API is the enforcement — see the org-scoping tests.

const PAGE = 25;

/** Choices are 2..6 options; the form always shows four slots and trims blanks. */
const BLANK_CHOICES = ['', '', '', ''];

const DIFFICULTIES = [
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Hard' },
];

function difficultyLabel(n: number): string {
  return DIFFICULTIES.find((d) => d.value === n)?.label ?? `Level ${n}`;
}

function QuestionForm({
  initial,
  categories,
  onDone,
  onCancel,
}: {
  initial: TriviaQuestion | null;
  categories: TriviaCategory[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  const [choices, setChoices] = useState<string[]>(
    initial ? [...initial.choices, ...BLANK_CHOICES].slice(0, Math.max(4, initial.choices.length)) : BLANK_CHOICES
  );
  const [answer, setAnswer] = useState(initial?.answer ?? 0);
  const [category, setCategory] = useState(initial?.category ?? '');
  const [difficulty, setDifficulty] = useState(initial?.difficulty ?? 2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();

  const filled = choices.map((c) => c.trim()).filter(Boolean);
  // The answer indexes into the TRIMMED list the server will receive, so a
  // blank slot above the marked answer would otherwise shift it silently.
  const answerText = choices[answer]?.trim() ?? '';
  const answerIndex = filled.indexOf(answerText);
  const duplicated = new Set(filled.map((c) => c.toLowerCase())).size !== filled.length;
  const problem =
    prompt.trim().length < 3 ? 'Prompt must be at least 3 characters.'
    : prompt.trim().length > 300 ? 'Prompt must be 300 characters or fewer.'
    : filled.length < 2 ? 'Give at least two options.'
    : duplicated ? 'Options must be different from each other.'
    : answerIndex === -1 ? 'Mark which option is correct.'
    : !category.trim() ? 'Pick or type a category.'
    : null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.saveTriviaQuestion({
        ...(initial ? { id: initial.id } : {}),
        prompt: prompt.trim(),
        choices: filled,
        answer: answerIndex,
        category: category.trim(),
        difficulty,
      });
      toast(initial ? 'Question updated.' : 'Question added.');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      {err && <Banner kind="error">{err}</Banner>}
      <Field label="Question" hint={`${prompt.trim().length}/300 characters.`}>
        <Input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Which planet is closest to the sun?"
        />
      </Field>

      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-medium text-slate-600">
          Options — click the circle to mark the correct one
        </legend>
        {choices.map((c, i) => (
          <label key={i} className="flex items-center gap-2">
            <input
              type="radio"
              name="trivia-answer"
              checked={answer === i}
              onChange={() => setAnswer(i)}
              aria-label={`Option ${i + 1} is correct`}
              className="h-4 w-4"
            />
            <Input
              value={c}
              onChange={(e) => setChoices(choices.map((v, j) => (i === j ? e.target.value : v)))}
              placeholder={i < 2 ? `Option ${i + 1} (required)` : `Option ${i + 1} (optional)`}
            />
          </label>
        ))}
        {choices.length < 6 && (
          <Button type="button" variant="ghost" onClick={() => setChoices([...choices, ''])}>
            Add an option
          </Button>
        )}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Category" hint="Pick an existing one or type a new one.">
          <Input
            list="trivia-categories"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="General Knowledge"
          />
          <datalist id="trivia-categories">
            {categories.map((c) => (
              <option key={c.category} value={c.category} />
            ))}
          </datalist>
        </Field>
        <Field label="Difficulty">
          <Select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {problem && <p className="text-xs text-slate-500">{problem}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || problem !== null}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Add question'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function QuestionRow({
  q,
  editable,
  onEdit,
  onChanged,
}: {
  q: TriviaQuestion;
  editable: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Card className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{q.prompt}</span>
          {q.archivedAt && <Pill tone="amber">Archived</Pill>}
        </div>
        <ol className="mt-1 space-y-0.5 text-sm">
          {q.choices.map((c, i) => (
            <li key={i} className={i === q.answer ? 'font-semibold text-slate-800' : 'text-slate-500'}>
              {i === q.answer ? '✓ ' : '· '}
              {c}
            </li>
          ))}
        </ol>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>{q.category}</span>
          <span>·</span>
          <span>{difficultyLabel(q.difficulty)}</span>
          {q.orgId === null && (
            <>
              <span>·</span>
              {/* Says why the Edit button is missing, rather than leaving an
                  org_admin to wonder. */}
              <span>{editable ? 'Platform pack' : 'Platform pack — read-only'}</span>
            </>
          )}
          {q.source && (
            <>
              <span>·</span>
              <span>from {q.source}</span>
            </>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex shrink-0 gap-2">
          {!q.archivedAt && (
            <Button variant="ghost" onClick={onEdit}>
              Edit
            </Button>
          )}
          <Button
            variant={q.archivedAt ? 'ghost' : 'danger'}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.archiveTriviaQuestion(q.id, !q.archivedAt);
                toast(q.archivedAt ? 'Question restored.' : 'Question archived.');
                onChanged();
              } finally {
                setBusy(false);
              }
            }}
          >
            {q.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        </div>
      )}
    </Card>
  );
}

export default function Trivia({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  // Debounced separately from `search` so typing doesn't fire a query per
  // keystroke against a 48,000-row ILIKE.
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<TriviaQuestion | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const cats = useAsync(async () => (await api.listTriviaCategories()).categories, []);
  const page = useAsync(
    () =>
      api.listTriviaQuestions({
        category: category || undefined,
        q: query || undefined,
        includeArchived: showArchived,
        limit: PAGE,
        offset,
      }),
    [category, query, showArchived, offset]
  );

  const reload = () => {
    page.reload();
    cats.reload();
  };

  if (page.loading && !page.data) return <Spinner />;
  if (page.error) return <Banner kind="error">{page.error.message}</Banner>;
  if (!page.data) return null;

  const { questions, total } = page.data;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + PAGE, total);
  // No client-side archived filter: the server honours includeArchived, and
  // re-filtering here would make the "1–25 of 47,710" line disagree with the
  // rows underneath it.
  const rows = questions;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trivia"
        actions={
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-slate-500 underline hover:text-slate-700"
              onClick={() => {
                setShowArchived((v) => !v);
                setOffset(0);
              }}
            >
              {showArchived ? 'Hide archived' : 'Show archived'}
            </button>
            <Button
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              New question
            </Button>
          </div>
        }
      />

      <Banner kind="info">
        Questions credited to <strong>opentriviaqa</strong> come from{' '}
        <a
          className="underline"
          href="https://github.com/uberspot/OpenTriviaQA"
          target="_blank"
          rel="noreferrer noopener"
        >
          OpenTriviaQA
        </a>
        , CC BY-SA 4.0, and have been filtered and edited. Archiving one stops it being dealt
        without deleting it.
      </Banner>

      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Search" hint="Matches anywhere in the question text.">
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="lennon, capital of, 1969…"
            />
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">All categories</option>
              {(cats.data ?? []).map((c) => (
                <option key={c.category} value={c.category}>
                  {c.category} ({c.n})
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      {(adding || editing) && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {editing ? 'Edit question' : 'New question'}
          </h2>
          <QuestionForm
            key={editing?.id ?? 'new'}
            initial={editing}
            categories={cats.data ?? []}
            onDone={() => {
              setEditing(null);
              setAdding(false);
              reload();
            }}
            onCancel={() => {
              setEditing(null);
              setAdding(false);
            }}
          />
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {total === 0 ? 'No matches' : `${from}–${to} of ${total.toLocaleString()}`}
          {query && ` matching “${query}”`}
        </span>
        <span className="flex gap-2">
          <Button
            variant="ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE))}
          >
            Previous
          </Button>
          <Button variant="ghost" disabled={to >= total} onClick={() => setOffset(offset + PAGE)}>
            Next
          </Button>
        </span>
      </div>

      <div className="space-y-2">
        {rows.map((q) => (
          <QuestionRow
            key={q.id}
            q={q}
            // The server refuses an org_admin writing the platform pack, so the
            // buttons that would 403 are simply not rendered.
            editable={isSuperAdmin || q.orgId !== null}
            onEdit={() => {
              setAdding(false);
              setEditing(q);
            }}
            onChanged={reload}
          />
        ))}
        {rows.length === 0 && (
          <EmptyState>
            {query || category
              ? 'Nothing matches that filter.'
              : 'The bank is empty. Add a question, or run the OpenTriviaQA import.'}
          </EmptyState>
        )}
      </div>
    </div>
  );
}
