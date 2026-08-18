import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import OrgDetail from './OrgDetail';
import { api } from './api';
import * as appIcon from './appIcon';

vi.mock('./api', () => ({
  api: {
    getOrg: vi.fn(),
    saveOrg: vi.fn(),
    archiveOrg: vi.fn(),
    suspendOrg: vi.fn(),
    unsuspendOrg: vi.fn(),
    updateOrgBranding: vi.fn(),
    uploadBrandingAsset: vi.fn(),
    listUsers: vi.fn(),
    inviteUser: vi.fn(),
    deleteUser: vi.fn(),
    forgotPassword: vi.fn(),
  },
}));

const ORG = {
  id: 'org-1',
  name: 'Test Org',
  slug: 'test-org',
  status: 'active',
  sortOrder: 0,
  archivedAt: null,
  branding: {},
};
const DETAIL = { org: ORG, locations: [] };

beforeEach(() => {
  vi.mocked(api.getOrg).mockReset().mockResolvedValue(DETAIL);
  vi.mocked(api.archiveOrg).mockReset();
  vi.mocked(api.suspendOrg)
    .mockReset()
    .mockResolvedValue({ ok: true, org: { ...ORG, status: 'suspended' } });
  vi.mocked(api.unsuspendOrg).mockReset().mockResolvedValue({ ok: true, org: ORG });
  vi.mocked(api.updateOrgBranding)
    .mockReset()
    .mockResolvedValue({ ok: true, org: ORG });
  vi.mocked(api.uploadBrandingAsset).mockReset();
  vi.mocked(api.saveOrg).mockReset().mockResolvedValue({ ok: true, org: ORG });
  vi.mocked(api.listUsers).mockReset().mockResolvedValue([]);
  vi.mocked(api.inviteUser).mockReset();
  vi.mocked(api.deleteUser).mockReset();
  vi.mocked(api.forgotPassword).mockReset().mockResolvedValue({ ok: true });
});

// The three logo fields share this placeholder (no platform default), so
// individual fields are picked by DOM order — Logo (full) renders first.
const NO_DEFAULT_PLACEHOLDER = 'No platform default — upload a file or paste a URL';
const logoUrlInput = () => screen.getAllByPlaceholderText(NO_DEFAULT_PLACEHOLDER)[0];

// Tabs are routes, so a test renders the tab it is about. Default is the
// overview (the org page's index).
function renderOrgDetail(isSuperAdmin: boolean, tab = '') {
  return render(
    <MemoryRouter initialEntries={[`/orgs/org-1${tab}`]}>
      <Routes>
        <Route path="/orgs/:id/*" element={<OrgDetail isSuperAdmin={isSuperAdmin} />} />
      </Routes>
    </MemoryRouter>
  );
}

/** The branding form lives on its own tab now. */
const renderBranding = (isSuperAdmin: boolean) => renderOrgDetail(isSuperAdmin, '/branding');

describe('OrgDetail — super_admin', () => {
  test('the header carries lifecycle only; + Location lives on the Venues tab', async () => {
    renderOrgDetail(true);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    // Adding a venue belongs next to the list of venues, not in a header of
    // otherwise-destructive lifecycle buttons.
    expect(screen.queryByRole('button', { name: '+ Location' })).not.toBeInTheDocument();
  });

  test("the Venues tab lists the org's venues and offers + Location", async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: ORG,
      locations: [{ id: 'loc-1', name: 'Riverside', slug: 'riverside', tzLabel: 'PT' } as never],
    });
    renderOrgDetail(true, '/venues');
    expect(await screen.findByText('Riverside')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Location' })).toBeInTheDocument();
  });

  test('Team is a super-admin-only tab', async () => {
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.getByRole('link', { name: 'Team' })).toBeInTheDocument();
  });

  test('clicking Archive calls api.archiveOrg(id, true)', async () => {
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.archiveOrg).toHaveBeenCalledWith('org-1', true));
  });

  test('an archived org shows Unarchive instead', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...DETAIL.org, archivedAt: '2026-01-01T00:00:00Z' },
      locations: [],
    });
    renderOrgDetail(true);
    expect(await screen.findByRole('button', { name: 'Unarchive' })).toBeInTheDocument();
  });
});

describe('OrgDetail — suspend lifecycle', () => {
  test('confirmed Suspend calls the endpoint and re-renders the suspended state', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    // After the suspend, the reload sees the org suspended.
    vi.mocked(api.getOrg)
      .mockResolvedValueOnce(DETAIL)
      .mockResolvedValue({ org: { ...ORG, status: 'suspended' }, locations: [] });
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.queryByText('Suspended')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Suspend' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/goes dark for players/));
    await waitFor(() => expect(api.suspendOrg).toHaveBeenCalledWith('org-1'));
    // Re-rendered from the reload: status badge + the verb flips.
    expect(await screen.findByText('Suspended')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsuspend' })).toBeInTheDocument();
    confirm.mockRestore();
  });

  test('a declined confirm changes nothing', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.click(screen.getByRole('button', { name: 'Suspend' }));
    expect(api.suspendOrg).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  test('Unsuspend needs no confirm and calls the endpoint', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...ORG, status: 'suspended' },
      locations: [],
    });
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.getByText('Suspended')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Unsuspend' }));

    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => expect(api.unsuspendOrg).toHaveBeenCalledWith('org-1'));
    confirm.mockRestore();
  });

  test('the default-org 400 surfaces inline (never auto-forced)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(api.suspendOrg).mockRejectedValue(
      new Error(
        "refusing to suspend the default org ('acme-family-fun'): it serves every unmatched host " +
          '(apex/staging included), so suspending it blanks those hosts. Pass ?force=1 to do it anyway.'
      )
    );
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });

    await user.click(screen.getByRole('button', { name: 'Suspend' }));

    expect(await screen.findByText(/refusing to suspend the default org/)).toBeInTheDocument();
    // The failure never reloads and only ever hit the plain (no-force) call.
    expect(api.suspendOrg).toHaveBeenCalledTimes(1);
    expect(api.getOrg).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });

  test('org_admin sees no Suspend control', async () => {
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unsuspend' })).not.toBeInTheDocument();
  });
});

describe('OrgDetail — branding', () => {
  test('renders the branding form: stored values prefilled, platform defaults as placeholders', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...ORG, branding: { appName: 'Putt Palace', themeColor: '#112233' } },
      locations: [],
    });
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.getByRole('heading', { name: 'Branding' })).toBeInTheDocument();
    // Stored overrides prefill their fields (the swatch mirrors the text
    // input's value, so scope the color check to the text input).
    expect(screen.getByDisplayValue('Putt Palace')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('#15803d')).toHaveValue('#112233');
    // …while unset fields sit empty with the §2 defaults as placeholders.
    expect(screen.getByPlaceholderText('MiniGolf')).toHaveValue('');
    expect(screen.getByPlaceholderText('#052e16')).toHaveValue('');
    expect(screen.getByPlaceholderText('#38bdf8')).toHaveValue('');
    expect(screen.getByPlaceholderText('/icons/icon-512.png')).toHaveValue('');
    expect(screen.getByPlaceholderText('Come beat this score')).toHaveValue('');
    // The logo trio has NO platform default — its placeholder says so instead
    // of showing a default URL.
    const logoInputs = screen.getAllByPlaceholderText(NO_DEFAULT_PLACEHOLDER);
    expect(logoInputs).toHaveLength(3);
    for (const input of logoInputs) expect(input).toHaveValue('');
  });

  test('save submits ONLY the non-empty fields as the full replacement object', async () => {
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(screen.getByPlaceholderText('Mini Golf Scorecard'), 'Putt Palace');
    await user.type(screen.getByPlaceholderText('#15803d'), '#123abc');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() =>
      expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', {
        appName: 'Putt Palace',
        themeColor: '#123abc',
      })
    );
    // Success path refetches the org (toasts are provider-backed no-ops here).
    await waitFor(() => expect(api.getOrg).toHaveBeenCalledTimes(2));
  });

  test('clearing every field saves {} (all platform defaults)', async () => {
    vi.mocked(api.getOrg).mockResolvedValue({
      org: { ...ORG, branding: { appName: 'Putt Palace' } },
      locations: [],
    });
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.clear(screen.getByDisplayValue('Putt Palace'));
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', {}));
  });

  test('a server validation error surfaces inline', async () => {
    vi.mocked(api.updateOrgBranding).mockRejectedValue(
      new Error('themeColor must be a #rrggbb color')
    );
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(screen.getByPlaceholderText('#15803d'), 'not-a-color');
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    expect(await screen.findByText('themeColor must be a #rrggbb color')).toBeInTheDocument();
    // The save failed, so no reload happened (initial load only).
    expect(api.getOrg).toHaveBeenCalledTimes(1);
  });
});

describe('OrgDetail — branding asset upload', () => {
  test('Upload fills the URL field and the save payload carries it', async () => {
    const url = '/api/brand-assets/org-1/logo-0123456789ab.png';
    vi.mocked(api.uploadBrandingAsset).mockResolvedValue({ ok: true, url });
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });

    const file = new File(['png-bytes'], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Logo (full) file'), file);

    await waitFor(() => expect(api.uploadBrandingAsset).toHaveBeenCalledWith('org-1', 'logo', file));
    // The returned served URL lands in the text field (the img preview keys
    // off the same value)…
    expect(logoUrlInput()).toHaveValue(url);
    // …and rides the normal full-replace save (upload alone saved nothing).
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() => expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', { logoUrl: url }));
  });

  test('each field maps to its own asset kind (icon512 → icon512)', async () => {
    vi.mocked(api.uploadBrandingAsset).mockResolvedValue({
      ok: true,
      url: '/api/brand-assets/org-1/icon512-0123456789ab.png',
    });
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    const file = new File(['png-bytes'], 'icon.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Icon 512×512 file'), file);
    await waitFor(() =>
      expect(api.uploadBrandingAsset).toHaveBeenCalledWith('org-1', 'icon512', file)
    );
  });

  // "Use logo as app icon" — the icon kinds must be PNG at exactly 192/512, so
  // a logo can never be uploaded into them directly. The button converts in the
  // browser (appIcon.ts) and then walks the SAME upload path a hand-made file
  // takes, which is what keeps the server's validation meaningful.
  test('derives both icons from the logo and fills both icon fields', async () => {
    const files = [
      { kind: 'icon192' as const, file: new File(['a'], 'icon-192.png', { type: 'image/png' }) },
      { kind: 'icon512' as const, file: new File(['b'], 'icon-512.png', { type: 'image/png' }) },
    ];
    vi.spyOn(appIcon, 'deriveAppIcons').mockResolvedValue(files);
    vi.mocked(api.uploadBrandingAsset)
      .mockResolvedValueOnce({ ok: true, url: '/api/brand-assets/org-1/icon192-aaaaaaaaaaaa.png' })
      .mockResolvedValueOnce({ ok: true, url: '/api/brand-assets/org-1/icon512-bbbbbbbbbbbb.png' });

    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });

    // Nothing to derive from until a logo exists.
    const button = screen.getByRole('button', { name: 'Use logo as app icon' });
    expect(button).toBeDisabled();

    await user.type(logoUrlInput(), '/api/brand-assets/org-1/logo-cccccccccccc.png');
    expect(button).toBeEnabled();
    await user.click(button);

    await waitFor(() =>
      expect(api.uploadBrandingAsset).toHaveBeenCalledWith('org-1', 'icon192', files[0].file)
    );
    expect(api.uploadBrandingAsset).toHaveBeenCalledWith('org-1', 'icon512', files[1].file);

    // Generating fills the fields but commits nothing — Save is still explicit,
    // exactly as for a manual upload.
    expect(api.updateOrgBranding).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save branding' }));
    await waitFor(() =>
      expect(api.updateOrgBranding).toHaveBeenCalledWith('org-1', {
        logoUrl: '/api/brand-assets/org-1/logo-cccccccccccc.png',
        icon192Url: '/api/brand-assets/org-1/icon192-aaaaaaaaaaaa.png',
        icon512Url: '/api/brand-assets/org-1/icon512-bbbbbbbbbbbb.png',
      })
    );
    vi.restoreAllMocks();
  });

  // Saving mid-generation would submit the OLD icon urls and then unmount this
  // card via onSaved() → reload, so the in-flight uploads land nowhere — with a
  // success toast still on screen. Both buttons lock each other out.
  test('Save is locked while icons are being generated', async () => {
    let release: (v: { kind: 'icon192'; file: File }[]) => void = () => {};
    vi.spyOn(appIcon, 'deriveAppIcons').mockReturnValue(
      new Promise((res) => {
        release = res as never;
      })
    );
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(logoUrlInput(), '/api/brand-assets/org-1/logo-cccccccccccc.png');

    const save = screen.getByRole('button', { name: 'Save branding' });
    expect(save).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Use logo as app icon' }));
    await waitFor(() => expect(save).toBeDisabled());

    release([]);
    await waitFor(() => expect(save).toBeEnabled());
    expect(api.updateOrgBranding).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test('a cross-origin logo explains itself instead of failing silently', async () => {
    vi.spyOn(appIcon, 'deriveAppIcons').mockRejectedValue(
      new Error('That logo is hosted on another domain and cannot be read here.')
    );
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    await user.type(logoUrlInput(), 'https://cdn.example/logo.png');
    await user.click(screen.getByRole('button', { name: 'Use logo as app icon' }));
    expect(await screen.findByText(/another domain/i)).toBeInTheDocument();
    expect(api.uploadBrandingAsset).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  test('a server rejection surfaces inline and leaves the field untouched', async () => {
    vi.mocked(api.uploadBrandingAsset).mockRejectedValue(
      new Error('SVG rejected: contains <script>')
    );
    const user = userEvent.setup();
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByLabelText('Logo (full) file'), file);
    expect(await screen.findByText('SVG rejected: contains <script>')).toBeInTheDocument();
    expect(logoUrlInput()).toHaveValue('');
  });

  test('client pre-checks fail fast: non-PNG icon and oversize file never hit the API', async () => {
    // applyAccept off: the icon input's accept attr would otherwise filter the
    // wrong-type file before our own pre-check code ever runs.
    const user = userEvent.setup({ applyAccept: false });
    renderBranding(false);
    await screen.findByRole('heading', { name: 'Test Org' });

    // Icon kinds are PNG-only.
    const jpeg = new File(['jpg-bytes'], 'icon.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Icon 192×192 file'), jpeg);
    expect(await screen.findByText(/must be a PNG \(exactly 192×192\)/)).toBeInTheDocument();

    // Over the 1 MiB cap (mirrors the server's decode-size limit).
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Logo (full) file'), big);
    expect(await screen.findByText(/too large \(max 1 MiB\)/)).toBeInTheDocument();

    expect(api.uploadBrandingAsset).not.toHaveBeenCalled();
  });
});

describe('OrgDetail — org_admin', () => {
  test('hides the Archive button entirely, keeps the Venues tab', async () => {
    renderOrgDetail(false);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Venues (0)' })).toBeInTheDocument();
  });

  test('never asks for the accounts list (every /users route 403s for them)', async () => {
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(api.listUsers).not.toHaveBeenCalled();
    // …so Team isn't offered either.
    expect(screen.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument();
  });

  test('the rename form is super_admin only', async () => {
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    expect(screen.queryByRole('button', { name: 'Save org' })).not.toBeInTheDocument();
  });
});

// The org page's index: the facts that make an org a tenant, and what is still
// missing before it is a finished one.
describe('OrgDetail — overview', () => {
  test("shows the org's address, status and setup gaps", async () => {
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    // No admin.<domain> hostname under jsdom, so the host renders in its
    // honest "we cannot derive the domain" form rather than a made-up URL.
    expect(screen.getAllByText(/test-org\.<platform domain>/).length).toBeGreaterThan(0);
    expect(screen.getByText('Active')).toBeInTheDocument();
    // Branding is {} and there are no locations: both call themselves out.
    expect(screen.getByText(/still on the platform default look/)).toBeInTheDocument();
    expect(screen.getByText(/none yet, so players see an empty catalog/)).toBeInTheDocument();
  });

  test('a super_admin with no accounts for the org is told nobody can sign in', async () => {
    renderOrgDetail(true);
    expect(await screen.findByText(/nobody at this org can sign in/)).toBeInTheDocument();
  });

  test('renaming posts the org WITHOUT branding, so the branding tab is never clobbered', async () => {
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    const name = screen.getByDisplayValue('Test Org');
    await user.clear(name);
    await user.type(name, 'Renamed Org');
    await user.click(screen.getByRole('button', { name: 'Save org' }));
    await waitFor(() =>
      expect(api.saveOrg).toHaveBeenCalledWith({
        id: 'org-1',
        name: 'Renamed Org',
        slug: 'test-org',
        sortOrder: 0,
      })
    );
  });

  test('changing the slug demands a confirm — it moves the subdomain', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderOrgDetail(true);
    await screen.findByRole('heading', { name: 'Test Org' });
    const slug = screen.getByDisplayValue('test-org');
    await user.clear(slug);
    await user.type(slug, 'moved-org');
    await user.click(screen.getByRole('button', { name: 'Save org' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/stop reaching this org/));
    expect(api.saveOrg).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});

// The accounts panel — /api/admin/users has been full CRUD all along with no
// UI over it; these lock the wiring in.
describe('OrgDetail — team tab', () => {
  const MEMBER = {
    id: 'user-1',
    email: 'manager@example.com',
    role: 'org_admin' as const,
    orgId: 'org-1',
    createdAt: '2026-01-01T00:00:00Z',
  };

  test("lists only this org's accounts", async () => {
    vi.mocked(api.listUsers).mockResolvedValue([
      MEMBER,
      { ...MEMBER, id: 'user-2', email: 'other@example.com', orgId: 'org-2' },
      { ...MEMBER, id: 'user-3', email: 'platform@example.com', role: 'super_admin', orgId: null },
    ]);
    renderOrgDetail(true, '/team');
    expect(await screen.findByText('manager@example.com')).toBeInTheDocument();
    expect(screen.queryByText('other@example.com')).not.toBeInTheDocument();
    expect(screen.queryByText('platform@example.com')).not.toBeInTheDocument();
  });

  test('inviting sends email + role + org, and never a password', async () => {
    vi.mocked(api.inviteUser).mockResolvedValue({ ok: true, user: MEMBER, inviteSent: true });
    const user = userEvent.setup();
    renderOrgDetail(true, '/team');
    await screen.findByRole('heading', { name: 'Invite an org admin' });
    await user.type(screen.getByPlaceholderText('manager@example.com'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    await waitFor(() =>
      expect(api.inviteUser).toHaveBeenCalledWith({
        email: 'new@example.com',
        role: 'org_admin',
        orgId: 'org-1',
      })
    );
  });

  test('a returned invite link (no mail provider) is shown for relaying', async () => {
    vi.mocked(api.inviteUser).mockResolvedValue({
      ok: true,
      user: MEMBER,
      inviteSent: false,
      inviteLink: 'https://admin.example/set-password?token=abc',
    });
    const user = userEvent.setup();
    renderOrgDetail(true, '/team');
    await screen.findByRole('heading', { name: 'Invite an org admin' });
    await user.type(screen.getByPlaceholderText('manager@example.com'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));
    expect(
      await screen.findByText('https://admin.example/set-password?token=abc')
    ).toBeInTheDocument();
  });

  test('removing an account confirms first', async () => {
    vi.mocked(api.listUsers).mockResolvedValue([MEMBER]);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    renderOrgDetail(true, '/team');
    await screen.findByText('manager@example.com');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/lose Master Control access/));
    expect(api.deleteUser).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  test('"Resend link" reuses the forgot-password mailer', async () => {
    vi.mocked(api.listUsers).mockResolvedValue([MEMBER]);
    const user = userEvent.setup();
    renderOrgDetail(true, '/team');
    await screen.findByText('manager@example.com');
    await user.click(screen.getByRole('button', { name: 'Resend link' }));
    await waitFor(() => expect(api.forgotPassword).toHaveBeenCalledWith('manager@example.com'));
  });
});
