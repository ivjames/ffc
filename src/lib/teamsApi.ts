// Teams API client (/api/teams). All endpoints require the ffc_session cookie
// — callers should route signed-out users to /account first.
import { apiUrl } from '../sync';

export type TeamMember = {
  userId: string;
  role: 'owner' | 'member';
  displayName: string | null;
  defaultTag: string | null;
  email: string;
};

export type Team = {
  id: string;
  name: string;
  ownerUserId: string;
  role: 'owner' | 'member';
  createdAt: string;
  members: TeamMember[];
  pendingInvites: { email: string; expiresAt: string }[];
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string; status: number };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  const res = await fetch(apiUrl(`/api/teams${path}`), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}`, status: res.status };
  return { ok: true, ...data };
}

export function listTeams() {
  return call<{ teams: Team[] }>('/');
}

export function createTeam(name: string) {
  return call<{ team: Team }>('/', { method: 'POST', body: JSON.stringify({ name }) });
}

export function renameTeam(id: string, name: string) {
  return call<{ team: Team }>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}

export function archiveTeam(id: string) {
  return call<object>(`/${id}`, { method: 'DELETE' });
}

export function inviteToTeam(id: string, email: string) {
  return call<object>(`/${id}/invites`, { method: 'POST', body: JSON.stringify({ email }) });
}

export function acceptInvite(token: string) {
  return call<{ team: Team }>('/invites/accept', { method: 'POST', body: JSON.stringify({ token }) });
}

export function removeMember(teamId: string, userId: string) {
  return call<object>(`/${teamId}/members/${userId}`, { method: 'DELETE' });
}
