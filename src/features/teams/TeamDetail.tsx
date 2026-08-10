import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Screen, TopBar, Content, Button, TagChip } from '../../ui/components';
import { emailError } from '../../lib/validateUser';
import { fetchMe, type AppUser } from '../../lib/authApi';
import {
  listTeams,
  renameTeam,
  archiveTeam,
  inviteToTeam,
  removeMember,
  type Team,
} from '../../lib/teamsApi';

// One team: roster, invites (owner), rename/archive (owner), leave (member).

const inputClass =
  'surface-sunk w-full rounded-xl border border-fairway-800/60 px-4 py-2.5 text-base text-fairway-50 placeholder:text-fairway-100/40 focus:border-fairway-500 focus:outline-none';

export default function TeamDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [me, setMe] = useState<AppUser | null>(null);
  const [team, setTeam] = useState<Team | null | 'missing'>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const user = await fetchMe();
    if (!user) {
      navigate('/me/teams', { replace: true });
      return;
    }
    setMe(user);
    const res = await listTeams();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const found = res.teams.find((t) => t.id === id);
    setTeam(found ?? 'missing');
    if (found) setNewName(found.name);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (team === null) {
    return (
      <Screen>
        <TopBar title="Team" back="/me/teams" />
        <Content>
          <p className="text-fairway-100/70">Loading…</p>
        </Content>
      </Screen>
    );
  }

  if (team === 'missing') {
    return (
      <Screen>
        <TopBar title="Team" back="/me/teams" />
        <Content>
          <p className="text-fairway-100/70">
            Team not found — it may have been archived, or you're not a member.
          </p>
        </Content>
      </Screen>
    );
  }

  // Narrowed binding — TS can't narrow the `team` state var inside the async
  // closures below, so hand them this one.
  const current = team;
  const isOwner = current.role === 'owner';
  const inviteErr = emailError(inviteEmail);

  async function sendInvite() {
    if (busy || inviteEmail.trim() === '' || inviteErr) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await inviteToTeam(current.id, inviteEmail.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(`Invite emailed to ${inviteEmail.trim()}.`);
    setInviteEmail('');
    void load();
  }

  async function saveRename() {
    if (busy || newName.trim() === '' || newName.trim() === current.name) return;
    setBusy(true);
    setError(null);
    const res = await renameTeam(current.id, newName.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice('Renamed.');
    void load();
  }

  async function remove(userId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await removeMember(current.id, userId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (userId === me?.id) {
      navigate('/me/teams', { replace: true });
      return;
    }
    void load();
  }

  async function archive() {
    if (busy) return;
    // Archiving hides the team for everyone — make the tap deliberate.
    if (!window.confirm(`Archive "${current.name}"? Members will lose access.`)) return;
    setBusy(true);
    const res = await archiveTeam(current.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    navigate('/me/teams', { replace: true });
  }

  return (
    <Screen>
      <TopBar title={team.name} back="/me/teams" />
      <Content>
        <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">Members</label>
        <div className="mb-5 space-y-2">
          {team.members.map((m) => (
            <div
              key={m.userId}
              className="surface-1 flex items-center justify-between rounded-2xl border border-fairway-800/60 px-4 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {m.defaultTag && <TagChip tag={m.defaultTag} />}
                <span className="min-w-0">
                  <span className="block truncate font-bold text-fairway-50">
                    {m.displayName || m.email}
                    {m.userId === me?.id ? ' (you)' : ''}
                  </span>
                  <span className="block text-xs text-fairway-100/60">
                    {m.role === 'owner' ? 'Owner' : 'Member'}
                  </span>
                </span>
              </span>
              {/* Owner removes others; a member removes only themself (leave). */}
              {((isOwner && m.userId !== me?.id) || (!isOwner && m.userId === me?.id)) && (
                <button
                  onClick={() => void remove(m.userId)}
                  className="text-sm font-semibold text-red-400"
                  disabled={busy}
                >
                  {m.userId === me?.id ? 'Leave' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>

        {isOwner && (
          <>
            {team.pendingInvites.length > 0 && (
              <div className="mb-5">
                <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
                  Invited (pending)
                </label>
                <div className="space-y-1">
                  {team.pendingInvites.map((inv, i) => (
                    <p key={i} className="truncate text-sm text-fairway-100/70">
                      {inv.email}
                    </p>
                  ))}
                </div>
              </div>
            )}

            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              Invite by email
            </label>
            <input
              value={inviteEmail}
              onChange={(e) => {
                setInviteEmail(e.target.value);
                setError(null);
              }}
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="friend@example.com"
              className={inputClass}
            />
            {inviteErr && <p className="mt-1.5 text-sm text-red-400">{inviteErr}</p>}
            <div className="mt-3 mb-6">
              <Button
                onClick={() => void sendInvite()}
                disabled={busy || inviteEmail.trim() === '' || !!inviteErr}
              >
                Send invite
              </Button>
            </div>

            <label className="mb-1.5 block text-sm font-semibold text-fairway-100/80">
              Team name
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={40}
              className={inputClass}
            />
            <div className="mt-3 space-y-2">
              <Button
                variant="ghost"
                onClick={() => void saveRename()}
                disabled={busy || newName.trim() === '' || newName.trim() === team.name}
              >
                Rename
              </Button>
              <Button variant="danger" onClick={() => void archive()} disabled={busy}>
                Archive team
              </Button>
            </div>
          </>
        )}

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-4 text-sm text-fairway-400">{notice}</p>}
      </Content>
    </Screen>
  );
}
