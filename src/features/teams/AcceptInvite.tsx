import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { fetchMe } from '../../lib/authApi';
import { acceptInvite } from '../../lib/teamsApi';

// Team-invite deep link target (/teams/accept?token=...). If the visitor is
// signed in the invite is accepted immediately; otherwise they're sent through
// /account first and can re-open the emailed link after (the token survives —
// it's only consumed on a successful accept).
export default function AcceptInvite() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'checking' | 'needsSignIn' | 'accepted' | 'failed'>(
    'checking',
  );
  const [teamName, setTeamName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    // StrictMode double-mount guard — accepting twice consumes then 410s.
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      if (!/^[0-9a-f]{64}$/.test(token)) {
        setError('This invite link is malformed — ask for a fresh one.');
        setState('failed');
        return;
      }
      const me = await fetchMe();
      if (!me) {
        setState('needsSignIn');
        return;
      }
      const res = await acceptInvite(token);
      if (!res.ok) {
        setError(
          res.status === 410
            ? 'This invite has expired or was already used — ask for a fresh one.'
            : res.error,
        );
        setState('failed');
        return;
      }
      setTeamName(res.team.name);
      setState('accepted');
    })();
  }, [token]);

  return (
    <Screen>
      <TopBar title="Team invite" back="/" />
      <Content>
        {state === 'checking' && <p className="text-fairway-100/70">Checking your invite…</p>}

        {state === 'needsSignIn' && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              You've been invited to a team! Sign in (or register) first, then open the
              invite link from your email again to join.
            </p>
            <Button onClick={() => navigate('/account')}>Sign in / register</Button>
          </>
        )}

        {state === 'accepted' && (
          <>
            <p className="mb-4 text-fairway-50">
              You're in — welcome to <span className="font-bold">{teamName}</span>! 🎉
            </p>
            <Button onClick={() => navigate('/teams')}>See my teams</Button>
          </>
        )}

        {state === 'failed' && (
          <>
            <p className="mb-4 text-sm text-red-400">{error}</p>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Back home
            </Button>
          </>
        )}
      </Content>
    </Screen>
  );
}
