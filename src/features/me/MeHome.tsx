import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { fetchSession, type AppUser } from '../../lib/authApi';
import { usePos } from '../../lib/pos';
import { isStandalone } from '../../lib/pwaInstall';

// "Me" section hub — the personal/account corner of the app. Gathers everything
// that's about the player rather than an attraction: sign-in/profile, teams,
// the rewards card (POS-gated), achievements, install, and privacy. Split out of
// the old catch-all Home button stack so identity lives in one predictable place.
export default function MeHome() {
  const navigate = useNavigate();
  const [me, setMe] = useState<AppUser | null>(null);
  const pos = usePos();

  useEffect(() => {
    void fetchSession().then((s) => setMe(s.user));
  }, []);

  return (
    <Screen>
      <TopBar title="Me" back="/" />
      <Content>
        {/* Identity card — signed-in profile or a sign-in call to action. */}
        <button
          onClick={() => navigate('/me/account')}
          className="surface-1 mb-4 flex w-full items-center gap-3 rounded-2xl border border-fairway-800/60 px-4 py-3.5 text-left transition-transform active:translate-y-px"
        >
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-xl"
            style={{ background: '#16653422', border: '1px solid #16653455' }}
            aria-hidden="true"
          >
            {me ? '👤' : '✨'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold text-fairway-50">
              {me ? me.displayName || me.defaultTag || me.email : 'Sign in / register'}
            </span>
            <span className="block truncate text-xs text-fairway-100/70">
              {me ? 'View your profile' : 'Save your scores and teams across visits'}
            </span>
          </span>
          <span className="text-sm font-semibold text-fairway-400">›</span>
        </button>

        <div className="space-y-2">
          <Button variant="ghost" onClick={() => navigate('/me/achievements')}>
            🏅 Achievements
          </Button>
          <Button variant="ghost" onClick={() => navigate('/me/teams')}>
            👥 My teams
          </Button>
          {pos.loyalty && (
            <Button variant="ghost" onClick={() => navigate('/me/rewards')}>
              🎟️ Rewards card
            </Button>
          )}
          {!isStandalone() && (
            <Button variant="ghost" onClick={() => navigate('/install')}>
              ⬇️ Install app
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/me/privacy')}>
            🔒 Privacy
          </Button>
        </div>
      </Content>
    </Screen>
  );
}
