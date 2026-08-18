import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppPreview, InstallPreview, ContrastNotes } from './OrgBrandingPreview';

// The previews exist to answer questions an operator cannot answer by reading
// hex codes and URLs. These tests pin the two judgements they make on the
// operator's behalf — contrast and truncation — plus the one thing a preview
// must never do, which is show a brand the org hasn't got.

describe('AppPreview', () => {
  test('renders the org name as neutral chrome when there is no logo', () => {
    // The logo trio has NO platform default. A preview that substituted the
    // default client's mark would tell the operator a comforting lie about
    // what their players will see.
    const { container } = render(<AppPreview values={{ appName: 'Putt Palace' }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('Putt Palace').length).toBeGreaterThan(0);
  });

  test('prefers the wordmark over the full logo for the header slot', () => {
    const { container } = render(
      <AppPreview
        values={{ logoUrl: '/api/brand-assets/full.png', logoWordmarkUrl: '/api/brand-assets/word.png' }}
      />,
    );
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'));
    expect(srcs).toContain('/api/brand-assets/word.png');
    expect(srcs).not.toContain('/api/brand-assets/full.png');
  });

  test('a half-typed hex previews as the platform default rather than blanking', () => {
    // Mid-edit values reach this component on every keystroke.
    const { container } = render(<AppPreview values={{ backgroundColor: '#0f4' }} />);
    const styled = container.querySelector('[style*="background"]');
    expect(styled).not.toBeNull();
  });
});

describe('InstallPreview', () => {
  test('warns when the short name will be clipped on a home screen', () => {
    render(<InstallPreview values={{ shortName: 'Bullwinkles Family Fun' }} />);
    expect(screen.getByText(/will be cut off/)).toBeInTheDocument();
  });

  test('stays quiet for a short name that fits', () => {
    render(<InstallPreview values={{ shortName: 'Putt Pal' }} />);
    expect(screen.queryByText(/will be cut off/)).not.toBeInTheDocument();
  });

  test('falls back to an initial when no icon is uploaded', () => {
    render(<InstallPreview values={{ shortName: 'Zebra' }} />);
    expect(screen.getByText('Z')).toBeInTheDocument();
  });
});

describe('ContrastNotes', () => {
  test('flags an accent that will be unreadable on the background', () => {
    // The classic failure: a pale brand accent on a light background makes
    // every primary button in the app disappear.
    render(<ContrastNotes values={{ accentColor: '#eeeeee', backgroundColor: '#ffffff' }} />);
    expect(screen.getByText(/Low contrast/)).toBeInTheDocument();
  });

  test('says nothing when the pairing is fine', () => {
    render(<ContrastNotes values={{ accentColor: '#38bdf8', backgroundColor: '#052e16' }} />);
    expect(screen.queryByText(/Low contrast/)).not.toBeInTheDocument();
  });
});
