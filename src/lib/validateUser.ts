// Account-field validation (email, phone). Client-side copy for instant form
// feedback — keep in sync with server/lib/validateUser.js, which re-validates
// everything server-side (this check is bypassable).

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

/** Strip separators; require 7-15 digits with optional +; bare 10-digit → +1. */
export function normalizePhone(phone: string): string | null {
  const stripped = phone.replace(/[\s().-]/g, '');
  if (!/^\+?[0-9]{7,15}$/.test(stripped)) return null;
  if (stripped.startsWith('+')) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  return `+${stripped}`;
}

export function emailError(email: string): string | null {
  if (email.trim() === '') return null; // empty field shows no error, just disables submit
  return normalizeEmail(email) ? null : 'Enter a valid email address';
}

export function phoneError(phone: string): string | null {
  if (phone.trim() === '') return null; // phone is optional
  return normalizePhone(phone) ? null : 'Enter a valid phone number';
}
