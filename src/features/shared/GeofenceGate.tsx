import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { GEOFENCE_ENFORCED } from '../../lib/flags';
import { usePresence, refreshPresence, type Presence } from '../../lib/presence';
import Icon from '../../ui/Icon';

// On-location gate (layout route). Food, games, and golf are only playable at a
// venue: this wraps those routes and requires a GPS-confirmed presence inside a
// venue geofence before rendering them.
//
// SUSPENDED DURING TESTING: when VITE_GEOFENCE_ENFORCED isn't 'true' (the
// default), the gate is transparent — it renders the wrapped routes with no
// check at all, so development and demos are never blocked. Flip the flag on per
// deployment once venue coords/geofenceKm are configured in Master Control.

export default function GeofenceGate() {
  // The flag is a build constant, so this branch is stable across renders — no
  // hooks run in the suspended path, keeping the two branches Rules-of-Hooks
  // clean (the guard's hooks live in its own component).
  if (!GEOFENCE_ENFORCED) return <Outlet />;
  return <GeofenceGuard />;
}

function GeofenceGuard() {
  const presence = usePresence();

  // Kick off one check when first entering a gated route this session. Once
  // 'on-site' it stays cached, so normal navigation between gated screens
  // doesn't re-prompt for GPS.
  useEffect(() => {
    if (presence.status === 'idle') void refreshPresence();
  }, [presence.status]);

  if (presence.status === 'on-site') return <Outlet />;
  return <Blocked presence={presence} />;
}

function Blocked({ presence }: { presence: Presence }) {
  const navigate = useNavigate();
  const checking = presence.status === 'checking' || presence.status === 'idle';

  const { title, body } =
    presence.status === 'off-site'
      ? {
          title: 'Head to the venue',
          body: 'Games, food, and golf are only available while you’re at one of our locations. Come on in and try again!',
        }
      : checking
        ? { title: 'Checking you’re here…', body: 'One moment while we confirm you’re at the venue.' }
        : {
            // unconfirmed: denied / unavailable / timeout
            title: 'Turn on location',
            body: 'We couldn’t confirm you’re at the venue. Allow location access on this device, then try again.',
          };

  return (
    <Screen>
      <TopBar title="At the venue?" back="/" />
      <Content>
        <div className="mx-auto mt-10 max-w-sm space-y-5 text-center">
          <Icon name="state.located" className="text-5xl" />
          <h1 className="text-xl font-black text-fairway-50">{title}</h1>
          <p className="text-sm text-fairway-100/80">{body}</p>
          <div className="space-y-2 pt-2">
            <Button
              disabled={checking}
              onClick={() => {
                void refreshPresence();
              }}
            >
              {checking ? (
              'Checking…'
            ) : (
              <>
                <Icon name="state.located" /> Try again
              </>
            )}
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Back to home
            </Button>
          </div>
        </div>
      </Content>
    </Screen>
  );
}
