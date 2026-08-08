// Account-field validation (email). Client-side copy for instant form
// feedback — keep in sync with server/lib/validateUser.js, which re-validates
// everything server-side (this check is bypassable).

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

export function emailError(email: string): string | null {
  if (email.trim() === '') return null; // empty field shows no error, just disables submit
  return normalizeEmail(email) ? null : 'Enter a valid email address';
}
