import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Account from './Account';
import { api, type CurrentUser } from './api';

vi.mock('./api', () => ({
  api: {
    changePassword: vi.fn(),
  },
}));

const LOGIN_USER: CurrentUser = {
  id: 'u-1',
  email: 'admin@example.com',
  role: 'super_admin',
  orgId: null,
  viaToken: false,
};
const TOKEN_USER: CurrentUser = {
  id: null,
  email: null,
  role: 'super_admin',
  orgId: null,
  viaToken: true,
};

beforeEach(() => {
  vi.mocked(api.changePassword).mockReset().mockResolvedValue({ ok: true });
});

async function fill(current: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText(/^New password/), next);
  await user.type(screen.getByLabelText('Confirm new password'), confirm);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  return user;
}

describe('Account — change password', () => {
  test('happy path calls the endpoint and clears the form', async () => {
    render(<Account user={LOGIN_USER} />);
    expect(screen.getByText(/Signed in as admin@example.com/)).toBeInTheDocument();

    await fill('old-secret', 'new-secret-1', 'new-secret-1');

    await waitFor(() =>
      expect(api.changePassword).toHaveBeenCalledWith('old-secret', 'new-secret-1')
    );
    // Success resets every field (a fresh form, no stale secrets on screen).
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    expect(screen.getByLabelText(/^New password/)).toHaveValue('');
    expect(screen.getByLabelText('Confirm new password')).toHaveValue('');
  });

  test('a short new password fails client-side, before any request', async () => {
    render(<Account user={LOGIN_USER} />);
    await fill('old-secret', 'short7c', 'short7c');
    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  test('a mismatched confirmation fails client-side, before any request', async () => {
    render(<Account user={LOGIN_USER} />);
    await fill('old-secret', 'new-secret-1', 'new-secret-2');
    expect(await screen.findByText(/do not match/)).toBeInTheDocument();
    expect(api.changePassword).not.toHaveBeenCalled();
  });

  test('a wrong current password (401) surfaces the server message inline', async () => {
    const { AuthError } = await vi.importActual<typeof import('./api')>('./api');
    vi.mocked(api.changePassword).mockRejectedValue(new AuthError('current password is incorrect'));
    render(<Account user={LOGIN_USER} />);

    await fill('wrong-old', 'new-secret-1', 'new-secret-1');

    expect(await screen.findByText('current password is incorrect')).toBeInTheDocument();
    // The typed values survive the failure so the operator can just fix the
    // current-password field.
    expect(screen.getByLabelText(/^New password/)).toHaveValue('new-secret-1');
  });

  test('APP_TOKEN pseudo-auth gets the notice instead of the form', () => {
    render(<Account user={TOKEN_USER} />);
    expect(screen.getByText(/shared admin token has no account password/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
  });

  test('an unresolved user (token path mid-/me) is treated like token auth', () => {
    render(<Account user={null} />);
    expect(screen.queryByRole('button', { name: 'Change password' })).not.toBeInTheDocument();
  });
});
