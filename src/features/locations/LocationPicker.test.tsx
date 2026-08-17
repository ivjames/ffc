// @vitest-environment jsdom
// The location picker after the white-label QA pass: it lists the tenant's
// real Master Control sites and carries NO dev scaffolding — the old
// "Placeholder sites — the client's real locations swap in here." footer
// rendered on every tenant and must never come back.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LocationPicker from './LocationPicker';
import { LOCATIONS } from '../../data/courses';

function renderPicker() {
  return render(
    <MemoryRouter initialEntries={['/locations']}>
      <LocationPicker />
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

describe('LocationPicker', () => {
  it('lists every venue in the catalog', () => {
    renderPicker();
    for (const loc of LOCATIONS) {
      expect(screen.getByText(loc.name)).toBeInTheDocument();
    }
  });

  it('renders no placeholder/dev copy on any tenant', () => {
    renderPicker();
    expect(screen.queryByText(/placeholder/i)).not.toBeInTheDocument();
  });
});
