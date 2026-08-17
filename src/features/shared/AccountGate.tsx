import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { useSession, refreshSession } from '../../lib/session';

// Account gate (layout route) — the sibling of GeofenceGate, for the screens
// that are about a person rather than a place.
//
// The app keeps its walk-up on-ramp: browsing the venue, course info, hours,
// rules, the leaderboard and the photo booth need no account. What sits behind
// this gate is everything that belongs to a persistent identity — the rewards
// card, teams, achievements, the personal profile. Those used to render (or
// advertise themselves) to anyone, which is what made a signed-out visitor see
// "My teams" and a lookup form for cards that weren't theirs.
//
// One gate instead of per-screen improvisation: before this, three screens each
// hand-rolled their own check and the rest simply had none.

export default function AccountGate() {
  const { user, known, loading } = useSession();

  // Inconclusive (offline / server error) is NOT signed out — showing a
  // sign-in wall to someone who already has a session would be a lie, and
  // tapping through it would strand them. Offer a retry instead.
  if (user) return <Outlet />;
  if (loading || !known) return <Pending loading={loading} />;
  return <SignInRequired />;
}

// Still checking, or a check that never resolved authoritatively (offline/5xx).
function Pending({ loading }: { loading: boolean }) {
  const navigate = useNavigate();
  return (
    <Screen>
      <TopBar title="One moment" back="/" />
      <Content>
        <div className="mx-auto mt-10 max-w-sm space-y-5 text-center">
          <div className="text-5xl" aria-hidden="true">
            👤
          </div>
          <h1 className="text-xl font-black text-fairway-50">
            {loading ? 'Checking your account…' : 'Couldn’t reach your account'}
          </h1>
          {!loading && (
            <>
              <p className="text-sm text-fairway-100/80">
                We couldn’t confirm whether you’re signed in. Check your connection and try again.
              </p>
              <div className="space-y-2 pt-2">
                <Button onClick={() => void refreshSession()}>Try again</Button>
                <Button variant="ghost" onClick={() => navigate('/')}>
                  Back to home
                </Button>
              </div>
            </>
          )}
        </div>
      </Content>
    </Screen>
  );
}

function SignInRequired() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  return (
    <Screen>
      <TopBar title="Sign in" back="/" />
      <Content>
        <div className="mx-auto mt-10 max-w-sm space-y-5 text-center">
          <div className="text-5xl" aria-hidden="true">
            ✨
          </div>
          <h1 className="text-xl font-black text-fairway-50">Sign in to continue</h1>
          <p className="text-sm text-fairway-100/80">
            This part of the app is yours — your rewards card, teams and achievements. Sign in
            with your email (no password to remember) and it all follows you between visits and
            devices.
          </p>
          <div className="space-y-2 pt-2">
            {/* Come back here once they're signed in, rather than dumping them
                on the account screen having forgotten what they wanted. */}
            <Button
              onClick={() =>
                navigate(`/me/account?next=${encodeURIComponent(`${pathname}${search}`)}`)
              }
            >
              Sign in / register
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
