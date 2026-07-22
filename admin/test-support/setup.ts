// Vitest setup for admin component tests: adds jest-dom's DOM matchers
// (toBeInTheDocument, etc.) and cleans up the DOM between tests.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
