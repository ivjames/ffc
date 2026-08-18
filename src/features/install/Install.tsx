import { useEffect, useRef, useState } from 'react';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useInstallPrompt } from '../../lib/pwaInstall';
import { useCurrentLocationId } from '../../lib/location';
import { locationById } from '../../data/courses';
import { track } from '../../lib/analytics';
import { getBranding, useBrandingRevision } from '../../lib/branding';
import Icon from '../../ui/Icon';

// §install — landing page for the "install to home screen" QR code. Detects the
// platform and shows the closest thing each one allows:
//   • Android / desktop Chrome/Edge → a real button that fires the native
//     install prompt (captured beforeinstallprompt event).
//   • iOS Safari → step-by-step Share-sheet instructions, because Apple exposes
//     no programmatic install API.
//   • Already installed → a "you're all set" confirmation.
export default function Install() {
  const { platform, installed, canPrompt, promptInstall } = useInstallPrompt();
  // Name the venue, not the platform. This screen used to hardcode "Mini Golf",
  // which is one of five sections (arcade, food, photos and the hunt are the
  // others) and wrong outright at a venue with no course. Same source and same
  // fallback as the Home hero and the nav drawer, so all three agree.
  const venueName = locationById(useCurrentLocationId())?.name ?? 'Family Fun Center';
  const [result, setResult] = useState<'accepted' | 'dismissed' | null>(null);

  // The install page reached a not-yet-installed player — the top of the
  // adoption funnel. Record it ONCE per visit: `canPrompt` flips as
  // beforeinstallprompt arrives or a prompt is dismissed, and refiring on those
  // transitions would inflate the funnel's denominator. The ref latches after
  // the first not-installed render (an already-installed visitor never counts).
  const shownRef = useRef(false);
  useEffect(() => {
    if (shownRef.current || installed) return;
    shownRef.current = true;
    track('install_prompt_shown', { platform, canPrompt });
  }, [installed, platform, canPrompt]);

  async function onInstall() {
    const outcome = await promptInstall();
    setResult(outcome);
    if (outcome === 'accepted') track('install_accepted', { platform });
    else if (outcome === 'dismissed') track('install_dismissed', { platform });
  }

  return (
    <Screen>
      <TopBar title="Install the app" back="/" />
      <Content>
        <div className="mb-6 mt-2 text-center">
          {/* The app's own icon, at size — an install screen's subject is the
              thing being installed, and a section icon (this was the golf
              pennant) claims the app is one section of itself. */}
          <AppIcon className="mx-auto h-16 w-16 shadow-sm" />
          <h2 className="mt-3 text-2xl font-black tracking-tight text-fairway-50">
            Add {venueName} to your phone
          </h2>
          <p className="mt-2 text-sm text-fairway-100/70">
            Installs like a normal app — full screen, works offline, no app store.
          </p>
        </div>

        {installed ? (
          <Card>
            <div className="text-center">
              <Icon name="state.done" className="text-3xl" />
              <p className="mt-2 font-bold text-fairway-50">You&apos;re all set</p>
              <p className="mt-1 text-sm text-fairway-100/70">
                This app is already installed on your device. Look for the <AppIcon /> icon on
                your home screen.
              </p>
              <div className="mt-4">
                <Button onClick={() => (window.location.href = '/')}>Open the app</Button>
              </div>
            </div>
          </Card>
        ) : platform === 'ios' ? (
          <IosInstructions />
        ) : canPrompt ? (
          <Card>
            <p className="mb-4 text-center text-sm text-fairway-100/80">
              One tap installs it to your home screen.
            </p>
            <Button onClick={onInstall}>Install this on my device</Button>
            {result === 'dismissed' && (
              <p className="mt-3 text-center text-xs text-fairway-100/70">
                No worries — tap the button again whenever you&apos;re ready.
              </p>
            )}
          </Card>
        ) : (
          <GenericInstructions platform={platform} />
        )}

        <p className="mt-6 text-center text-xs text-fairway-100/70">
          Nothing to download from a store. It&apos;s the same web app, saved to your device.
        </p>
      </Content>
    </Screen>
  );
}

/**
 * The icon the player will actually find on their home screen — as this
 * screen's hero, and inline in the two sentences that promise it.
 *
 * Deliberately NOT an <Icon>. This screen's subject is a real artefact: the
 * installed PWA's launcher icon, which is the tenant's uploaded `icon192`
 * (server/lib/brandAssets.js) or the platform default. It has nothing to do
 * with the icon set — pointing at any glyph here, emoji or vector, describes
 * something the player will never see. The copy used to say "the ⛳️ icon" and
 * the hero used to be a golf pennant; both were wrong at every venue, the
 * mini-golf ones included.
 *
 * Decorative in every placement: the heading names the venue and the sentences
 * already say "icon", so it is hidden from assistive tech rather than announced
 * twice.
 */
function AppIcon({
  /** Size and layout. The squircle radius is not overridable — it is what makes
   *  this read as a home-screen icon rather than a picture. */
  className = 'mx-0.5 inline-block h-5 w-5 align-text-bottom',
}: {
  className?: string;
}) {
  useBrandingRevision();
  return (
    <img
      src={getBranding().icon192Url}
      alt=""
      aria-hidden="true"
      // ~22% is the squircle masking both iOS and Android apply.
      className={`rounded-[22%] ${className}`}
    />
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-fairway-800 bg-fairway-900/40 p-5">{children}</div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-fairway-100/90">
      <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-fairway-700 text-xs font-bold text-fairway-50">
        {n}
      </span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function IosInstructions() {
  return (
    <Card>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fairway-400">
        On iPhone &amp; iPad (Safari)
      </h3>
      <ol className="space-y-4">
        <Step n={1}>
          Tap the <span className="font-semibold text-fairway-50">Share</span> button{' '}
          <span aria-hidden className="mx-0.5 inline-block align-middle text-lg">
            &#x2191;&#xFE0E;
          </span>
          <span className="text-fairway-100/70"> (the square with an up-arrow, in the toolbar).</span>
        </Step>
        <Step n={2}>
          Scroll down and tap{' '}
          <span className="font-semibold text-fairway-50">Add to Home Screen</span>{' '}
          <span aria-hidden>➕</span>.
        </Step>
        <Step n={3}>
          Tap <span className="font-semibold text-fairway-50">Add</span> in the top-right corner.
        </Step>
      </ol>
      <p className="mt-4 rounded-lg bg-fairway-950/60 p-3 text-xs text-fairway-100/70">
        Must be opened in <span className="font-semibold">Safari</span> — Chrome and other
        browsers on iPhone can&apos;t add to the home screen.
      </p>
    </Card>
  );
}

function GenericInstructions({ platform }: { platform: string }) {
  return (
    <Card>
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-fairway-400">
        {platform === 'android' ? 'On Android' : 'In your browser'}
      </h3>
      <ol className="space-y-4">
        <Step n={1}>
          Open the browser menu{' '}
          <span className="text-fairway-100/70">(⋮ or ⋯, usually top-right).</span>
        </Step>
        <Step n={2}>
          Tap{' '}
          <span className="font-semibold text-fairway-50">
            {platform === 'android' ? 'Add to Home screen' : 'Install app'}
          </span>
          <span className="text-fairway-100/70"> (also shown as “Install”).</span>
        </Step>
        <Step n={3}>
          Confirm, and the <AppIcon /> icon lands on your home screen.
        </Step>
      </ol>
      <p className="mt-4 rounded-lg bg-fairway-950/60 p-3 text-xs text-fairway-100/70">
        Don&apos;t see the option? Your browser may not support installing — try Chrome or Edge.
      </p>
    </Card>
  );
}
