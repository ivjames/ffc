// Player-account API client (/api/auth). The session rides in an httpOnly
// same-origin cookie the server sets on verify — nothing is stored client-side,
// so fetch's default same-origin credentials are all that's needed.
import { apiUrl } from '../sync';

export type AppUser = {
  id: string;
  email: string;
  displayName: string | null;
  defaultTag: string | null;
  emailVerifiedAt: string | null;
};

export type Profile = {
  displayName?: string | null;
  defaultTag?: string | null;
};

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Ask the server to email a sign-in code. Resolves ok even for unknown
 *  addresses (the server never reveals which emails have accounts).
 *  `bypassCode` is present while the server has no real mail provider
 *  configured — sign in with it directly instead of waiting for an email. */
export async function requestCode(
  email: string,
  profile?: Profile,
  /** Where the player was headed before the gate stopped them. The emailed
   *  link carries it, so tapping it lands them there instead of the app root.
   *  Server-validated to a same-app path (server/lib/appOrigin.js). */
  next?: string | null,
): Promise<{ ok: boolean; error?: string; bypassCode?: string }> {
  const res = await post('/api/auth/request-code', { email, profile, next });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
  return { ok: true, bypassCode: data.bypassCode };
}

/** Trade a typed 6-digit code for a session. */
export async function verifyCode(email: string, code: string): Promise<{ user?: AppUser; error?: string }> {
  const res = await post('/api/auth/verify', { email, code });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
  return { user: data.user };
}

/** Session check that distinguishes "definitively signed out" from "couldn't
 *  tell" (offline / server error) — a null user alone can't tell them apart,
 *  and treating an unreachable check as signed-out would nudge an
 *  already-signed-in-but-offline player to sign in. `known` is true only for an
 *  authoritative answer: a 401 (signed out) or a 200 (whatever user it says). */
export type SessionCheck = { user: AppUser | null; known: boolean };

export async function fetchSession(): Promise<SessionCheck> {
  try {
    const res = await fetch(apiUrl('/api/auth/me'));
    if (res.status === 401) return { user: null, known: true }; // authoritatively signed out
    if (!res.ok) return { user: null, known: false }; // 5xx etc. — inconclusive
    const data = await res.json();
    return { user: data.user ?? null, known: true };
  } catch {
    return { user: null, known: false }; // offline — inconclusive
  }
}

/** Who am I? Null when signed out (or offline/unknown). */
export async function fetchMe(): Promise<AppUser | null> {
  return (await fetchSession()).user;
}

export async function updateProfile(profile: Profile): Promise<{ user?: AppUser; error?: string }> {
  const res = await fetch(apiUrl('/api/auth/me'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { error: data.error ?? `HTTP ${res.status}` };
  return { user: data.user };
}

export async function logout(): Promise<void> {
  await post('/api/auth/logout').catch(() => {});
}
