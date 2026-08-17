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
    archiveOrg: vi.fn(),
    suspendOrg: vi.fn(),
    unsuspendOrg: vi.fn(),
    updateOrgBranding: vi.fn(),
    uploadBrandingAsset: vi.fn(),
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
});

// The three logo fields share this placeholder (no platform default), so
// individual fields are picked by DOM order — Logo URL renders first.
const NO_DEFAULT_PLACEHOLDER = 'No platform default — upload a file or paste a URL';
const logoUrlInput = () => screen.getAllByPlaceholderText(NO_DEFAULT_PLACEHOLDER)[0];

function renderOrgDetail(isSuperAdmin: boolean) {
  return render(
    <MemoryRouter initialEntries={['/orgs/org-1']}>
      <Routes>
        <Route path="/orgs/:id" element={<OrgDetail isSuperAdmin={isSuperAdmin} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('OrgDetail — super_admin', () => {
  test('shows the Archive button, alongside + Location', async () => {
    renderOrgDetail(true);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Location' })).toBeInTheDocument();
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
    renderOrgDetail(false);
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
    renderOrgDetail(false);
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
    renderOrgDetail(false);
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
    renderOrgDetail(false);
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
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });

    const file = new File(['png-bytes'], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Logo URL file'), file);

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
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    const file = new File(['png-bytes'], 'icon.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Icon 512 URL file'), file);
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
    renderOrgDetail(false);
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

  test('a cross-origin logo explains itself instead of failing silently', async () => {
    vi.spyOn(appIcon, 'deriveAppIcons').mockRejectedValue(
      new Error('That logo is hosted on another domain and cannot be read here.')
    );
    const user = userEvent.setup();
    renderOrgDetail(false);
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
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });
    const file = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
    await user.upload(screen.getByLabelText('Logo URL file'), file);
    expect(await screen.findByText('SVG rejected: contains <script>')).toBeInTheDocument();
    expect(logoUrlInput()).toHaveValue('');
  });

  test('client pre-checks fail fast: non-PNG icon and oversize file never hit the API', async () => {
    // applyAccept off: the icon input's accept attr would otherwise filter the
    // wrong-type file before our own pre-check code ever runs.
    const user = userEvent.setup({ applyAccept: false });
    renderOrgDetail(false);
    await screen.findByRole('heading', { name: 'Test Org' });

    // Icon kinds are PNG-only.
    const jpeg = new File(['jpg-bytes'], 'icon.jpg', { type: 'image/jpeg' });
    await user.upload(screen.getByLabelText('Icon 192 URL file'), jpeg);
    expect(await screen.findByText(/must be a PNG \(exactly 192×192\)/)).toBeInTheDocument();

    // Over the 1 MiB cap (mirrors the server's decode-size limit).
    const big = new File([new Uint8Array(1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Logo URL file'), big);
    expect(await screen.findByText(/too large \(max 1 MiB\)/)).toBeInTheDocument();

    expect(api.uploadBrandingAsset).not.toHaveBeenCalled();
  });
});

describe('OrgDetail — org_admin', () => {
  test('hides the Archive button entirely, keeps + Location', async () => {
    renderOrgDetail(false);
    expect(await screen.findByRole('heading', { name: 'Test Org' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Location' })).toBeInTheDocument();
  });
});
