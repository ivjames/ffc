import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Screen, TopBar, Content, Button } from '../../ui/components';
import { listTeams, createTeam, type Team } from '../../lib/teamsApi';

// Teams — list mine, create a new one. Signed-in only, enforced by AccountGate
// on the route, so this screen no longer carries its own sign-in branch.

const inputClass =
  'surface-sunk w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none';

export default function Teams() {
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await listTeams();
      if (res.ok) setTeams(res.teams);
      else setError(res.error);
      setLoaded(true);
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
    navigate(`/me/teams/${res.team.id}`);
  }

  return (
    <Screen>
      <TopBar title="Teams" back="/" />
      <Content>
        {!loaded && <p className="text-fairway-100/70">Loading…</p>}

        {loaded && (
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
                    onClick={() => navigate(`/me/teams/${t.id}`)}
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
            {error && <p className="mt-2 text-sm text-danger">{error}</p>}
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
