// @vitest-environment jsdom
// The attribution the trivia pack's licence actually requires.
//
// CC BY-SA 4.0 makes credit a condition of USE, not of redistribution — its
// definition of "Share" covers public display and public performance, so a
// venue running these questions on a screen is inside the licence's scope. The
// four elements below are §3(a)(1): identify the source, name the licence and
// link its text, link back to the material, and state that it was modified.
// Losing any of them silently is the failure this file exists to catch, since
// nothing else in the build would notice.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Credits, { QuestionCredit } from './Credits';

afterEach(cleanup);

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

describe('the credits page', () => {
  const show = () =>
    render(
      <MemoryRouter>
        <Credits />
      </MemoryRouter>
    );

  test('identifies the source and links to it', () => {
    show();
    const link = screen.getByRole('link', { name: 'OpenTriviaQA' });
    expect(link).toHaveAttribute('href', 'https://github.com/uberspot/OpenTriviaQA');
  });

  test('names the licence and links its text', () => {
    show();
    const link = screen.getByRole('link', { name: /Attribution-ShareAlike 4\.0 International/ });
    expect(link).toHaveAttribute('href', 'https://creativecommons.org/licenses/by-sa/4.0/');
    expect(screen.getAllByText(/CC BY-SA 4\.0/).length).toBeGreaterThan(0);
  });

  test('states that the questions were modified', () => {
    // §3(a)(1)(B): "indicate if You modified the Licensed Material". This is
    // the element people drop, and we modified the corpus heavily.
    show();
    expect(screen.getByText('modified')).toBeInTheDocument();
    expect(screen.getByText(/filtered for content and length/)).toBeInTheDocument();
  });

  test('offers the adapted collection under the same licence, as ShareAlike requires', () => {
    show();
    expect(screen.getByText(/available under the same CC BY-SA 4\.0 licence/)).toBeInTheDocument();
  });

  test('credits the vendored icon sets too', () => {
    show();
    expect(screen.getByRole('link', { name: 'Lucide' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Phosphor Icons' })).toBeInTheDocument();
  });

  test('external links do not hand the target window an opener', () => {
    show();
    for (const link of screen.getAllByRole('link')) {
      if (link.getAttribute('href')?.startsWith('http')) {
        expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
        expect(link).toHaveAttribute('target', '_blank');
      }
    }
  });
});

describe('the inline credit', () => {
  test('names the source and licence, and points at the page', () => {
    // §3(a)(2) lets a hyperlink carry the full notice — but the link has to
    // actually go somewhere, and /credits has to be a real route.
    render(
      <MemoryRouter>
        <QuestionCredit />
      </MemoryRouter>
    );
    expect(screen.getByText(/OpenTriviaQA, CC BY-SA 4\.0/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits' })).toHaveAttribute('href', '/credits');
    cleanup();
    expect(read('App.tsx')).toContain('path="/credits"');
  });
});

// Structural, not behavioural, and deliberately so. TriviaLive and TriviaHost
// each return from several branches (joining, connecting, setting up, playing),
// and mounting all of them would mean standing up an SSE stream, a session and
// a location for what is really a one-line invariant: every screen that can
// show a dealt question carries the credit. A new branch added without one is
// exactly the regression worth failing the build over.
describe('the screens that deal from the platform pack', () => {
  for (const file of ['features/fun/TriviaLive.tsx', 'features/fun/TriviaHost.tsx']) {
    test(`${file} credits the pack in every branch it renders`, () => {
      const source = read(file);
      const branches = source.match(/<\/Content>/g)?.length ?? 0;
      const credits = source.match(/<QuestionCredit \/>/g)?.length ?? 0;
      expect(branches).toBeGreaterThan(0);
      expect(credits).toBe(branches);
      expect(source).toContain("from '../shared/Credits'");
    });
  }

  test('the single-player game carries no credit — that deck is the house\'s own', () => {
    // /arcade/trivia deals src/data/funContent.ts, written in-house. Crediting
    // OpenTriviaQA there would be a false statement about where it came from.
    const source = read('features/fun/Trivia.tsx');
    expect(source).toContain("from '../../data/funContent'");
    expect(source).not.toContain('QuestionCredit');
  });
});
