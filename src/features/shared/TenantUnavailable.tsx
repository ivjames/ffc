import { Screen, Content } from '../../ui/components';
import Icon from '../../ui/Icon';

// Tenant dead-end (MULTI-VENUE.md §1/§3). Rendered by the app root INSTEAD of
// the router when /api/content answered `unavailable: true` — an unknown/typo
// platform subdomain, or a suspended/archived org's slug. This host serves no
// venue, so the page must say so explicitly rather than pretend to be an app
// with nothing in it.
//
// Deliberately platform-neutral and nav-free: no BrandLogo (there is no tenant
// to brand for, and the neutral default look must not read as some venue's
// app), no TopBar/NavDrawer (there is nothing to navigate to), default theme
// tokens only. Screen/Content keep it on the app's visual idiom without
// dragging in any chrome.
export default function TenantUnavailable() {
  return (
    <Screen>
      <Content>
        <div className="mx-auto flex min-h-[70vh] max-w-sm flex-col items-center justify-center space-y-5 text-center">
          <Icon name="state.no-venue" className="text-5xl" />
          <h1 className="text-xl font-black text-fairway-50">
            There&rsquo;s no venue at this address.
          </h1>
          <p className="text-sm text-fairway-100/80">
            Check the link or QR code you followed — or ask the front desk for the right one.
          </p>
        </div>
      </Content>
    </Screen>
  );
}
