import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { fetchMe } from '../../lib/authApi';
import { listTeams, createTeam, type Team } from '../../lib/teamsApi';

// Teams — list mine, create a new one. Signed-in only; signed-out visitors are
// pointed at /account (no auto-redirect — explain first, then send).

const inputClass =
  'surface-sunk w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none';

export default function Teams() {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const me = await fetchMe();
      if (!me) {
        setSignedIn(false);
        return;
      }
      setSignedIn(true);
      const res = await listTeams();
      if (res.ok) setTeams(res.teams);
      else setError(res.error);
    })();
  }, []);

  async function create() {
    const trimmed = name.trim();
    if (trimmed === '' || creating) return;
    setCreating(true);
    setError(null);
    const res = await createTeam(trimmed);
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate(`/teams/${res.team.id}`);
  }

  return (
    <Screen>
      <TopBar title="Teams" back="/" />
      <Content>
        {signedIn === null && <p className="text-fairway-100/70">Loading…</p>}

        {signedIn === false && (
          <>
            <p className="mb-4 text-sm text-fairway-100/70">
              Teams let you keep a regular group together — invite friends by email, then
              start shared games everyone scores from their own phone. Sign in to create or
              see your teams.
            </p>
            <Button onClick={() => navigate('/account')}>Sign in / register</Button>
          </>
        )}

        {signedIn && (
          <>
            {teams.length === 0 ? (
              <p className="mb-5 text-sm text-fairway-100/70">
                No teams yet — name one below and invite your regulars.
              </p>
            ) : (
              <div className="mb-5 space-y-2">
                {teams.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => navigate(`/teams/${t.id}`)}
                    className="surface-1 flex w-full items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-3 text-left transition-transform active:translate-y-px"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-fairway-50">{t.name}</span>
                      <span className="block text-sm text-fairway-100/70">
                        {t.members.length} {t.members.length === 1 ? 'member' : 'members'}
                        {t.role === 'owner' ? ' · yours' : ''}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-fairway-400">›</span>
                  </button>
                ))}
              </div>
            )}

            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              New team
            </label>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              maxLength={40}
              placeholder="The Putters"
              className={inputClass}
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-3">
              <Button onClick={() => void create()} disabled={creating || name.trim() === ''}>
                {creating ? 'Creating…' : 'Create team'}
              </Button>
            </div>
          </>
        )}
      </Content>
    </Screen>
  );
}
