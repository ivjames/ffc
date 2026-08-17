import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Mail from './Mail';
import { api, ApiError, type MailStatus } from './api';

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, api: { mailStatus: vi.fn(), mailTest: vi.fn() } };
});

const HEALTHY: MailStatus = {
  ok: true,
  provider: 'resend',
  note: 'Delivered via the Resend API. The MAIL_FROM domain must be verified there (SPF + DKIM).',
  delivers: true,
  from: 'FFC <noreply@ffc.lab980.com>',
  credentialSet: true,
  linkOrigin: 'https://bullwinkles.ffc.lab980.com',
  publicAppUrl: 'https://bullwinkles.ffc.lab980.com',
  platformFqdn: 'ffc.lab980.com',
  dailyCap: 500,
  globalDailyCap: 2000,
  sendingDomains: ['ffc.lab980.com'],
  liveOrgCount: 3,
  warnings: [],
};

beforeEach(() => {
  vi.mocked(api.mailStatus).mockReset().mockResolvedValue(HEALTHY);
  vi.mocked(api.mailTest).mockReset();
});

describe('Mail', () => {
  test('shows the config an operator needs to check against the Resend dashboard', async () => {
    render(<Mail />);

    expect(await screen.findByText('resend')).toBeInTheDocument();
    expect(screen.getByText('FFC <noreply@ffc.lab980.com>')).toBeInTheDocument();
    expect(screen.getByText('set')).toBeInTheDocument();
    // Twice each on purpose: sending domain + PLATFORM_FQDN, link origin +
    // PUBLIC_APP_URL. Seeing them agree IS the check the operator is making.
    expect(screen.getAllByText('ffc.lab980.com')).toHaveLength(2);
    expect(screen.getAllByText('https://bullwinkles.ffc.lab980.com')).toHaveLength(2);
    expect(screen.getByText('500 per org · 2000 platform-wide')).toBeInTheDocument();
  });

  test('a clean config says so without claiming anything was delivered', async () => {
    render(<Mail />);

    const banner = await screen.findByText(/No configuration problems found/);
    // The distinction the whole screen turns on: config-looks-right is not
    // proof of delivery, and the copy must not let it read as one.
    expect(banner).toHaveTextContent('send a test below');
  });

  test('each warning is rendered with its fix, not just the complaint', async () => {
    vi.mocked(api.mailStatus).mockResolvedValue({
      ...HEALTHY,
      credentialSet: false,
      warnings: [
        {
          code: 'resend_key_missing',
          message: 'MAIL_PROVIDER=resend but RESEND_API_KEY is unset.',
          fix: 'Put the Resend API key in server/.env as RESEND_API_KEY and restart.',
        },
        {
          code: 'mail_from_domain_mismatch',
          message: 'MAIL_FROM sends as @other.example, which is not ffc.lab980.com.',
          fix: 'Either point MAIL_FROM at a ffc.lab980.com address, or set MAIL_SENDING_DOMAINS.',
        },
      ],
    });
    render(<Mail />);

    expect(await screen.findByText(/RESEND_API_KEY is unset/)).toBeInTheDocument();
    expect(screen.getByText(/Put the Resend API key in server\/.env/)).toBeInTheDocument();
    expect(screen.getByText(/which is not ffc.lab980.com/)).toBeInTheDocument();
    expect(screen.getByText(/set MAIL_SENDING_DOMAINS/)).toBeInTheDocument();
    expect(screen.getByText('NOT SET')).toBeInTheDocument();
    expect(screen.queryByText(/No configuration problems/)).not.toBeInTheDocument();
  });

  test('an unreadable org count says the multi-tenant check was skipped, not "0 orgs"', async () => {
    vi.mocked(api.mailStatus).mockResolvedValue({ ...HEALTHY, liveOrgCount: null });
    render(<Mail />);

    expect(await screen.findByText('unknown')).toBeInTheDocument();
    expect(screen.getByText(/could not be read from the database/)).toBeInTheDocument();
  });

  test('a cap of 0 is labelled as the kill switch it is', async () => {
    vi.mocked(api.mailStatus).mockResolvedValue({ ...HEALTHY, dailyCap: 0 });
    render(<Mail />);

    expect(await screen.findByText(/A cap of 0 is the kill switch/)).toBeInTheDocument();
  });

  test('a successful test send reports the note from the server', async () => {
    vi.mocked(api.mailTest).mockResolvedValue({
      ok: true,
      provider: 'resend',
      delivered: true,
      id: 'msg-1',
      note: 'Sent to o***@example.com. Check the inbox (and the spam folder).',
    });
    const user = userEvent.setup();
    render(<Mail />);
    await screen.findByText('resend');

    await user.type(screen.getByPlaceholderText('you@example.com'), 'ops@example.com');
    await user.click(screen.getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText(/Sent to o\*\*\*@example.com/)).toBeInTheDocument();
    expect(api.mailTest).toHaveBeenCalledWith('ops@example.com');
  });

  test("a failed send is a readable failure carrying the provider's own words, not a crash", async () => {
    // The endpoint answers HTTP 200 with ok:false — the REQUEST succeeded and
    // the SEND failed, so the client must branch on it, never throw.
    vi.mocked(api.mailTest).mockResolvedValue({
      ok: false,
      provider: 'resend',
      delivered: false,
      error: 'resend 403: {"message":"The ffc.lab980.com domain is not verified."}',
    });
    const user = userEvent.setup();
    render(<Mail />);
    await screen.findByText('resend');

    await user.type(screen.getByPlaceholderText('you@example.com'), 'ops@example.com');
    await user.click(screen.getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText(/The send failed/)).toBeInTheDocument();
    // The raw provider text is the point — it must survive to the screen intact.
    expect(screen.getByText(/domain is not verified/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test' })).toBeEnabled();
  });

  test('a console-provider send is reported as an info, not a green tick', async () => {
    vi.mocked(api.mailStatus).mockResolvedValue({
      ...HEALTHY,
      provider: 'console',
      delivers: false,
    });
    vi.mocked(api.mailTest).mockResolvedValue({
      ok: true,
      provider: 'console',
      delivered: false,
      id: 'console',
      note: "MAIL_PROVIDER is 'console' — nothing was actually delivered. Set a real provider first.",
    });
    const user = userEvent.setup();
    render(<Mail />);
    await screen.findByText('console');

    await user.type(screen.getByPlaceholderText('you@example.com'), 'ops@example.com');
    await user.click(screen.getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText(/nothing was actually delivered/)).toBeInTheDocument();
  });

  test('a thrown request error still lands on the screen instead of blanking it', async () => {
    vi.mocked(api.mailTest).mockRejectedValue(new ApiError('HTTP 500'));
    const user = userEvent.setup();
    render(<Mail />);
    await screen.findByText('resend');

    await user.type(screen.getByPlaceholderText('you@example.com'), 'ops@example.com');
    await user.click(screen.getByRole('button', { name: 'Send test' }));

    expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
  });

  test('a failed status load shows the error banner', async () => {
    vi.mocked(api.mailStatus).mockRejectedValue(new Error('forbidden: super admin only'));
    render(<Mail />);

    expect(await screen.findByText('forbidden: super admin only')).toBeInTheDocument();
  });

  test('Refresh re-reads the status', async () => {
    const user = userEvent.setup();
    render(<Mail />);
    await screen.findByText('resend');

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(api.mailStatus).toHaveBeenCalledTimes(2));
  });
});
