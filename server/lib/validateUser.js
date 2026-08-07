// Player-account input validation (email, phone, display name, default tag).
// Keep the rules in sync with the client mirror (src/lib/validateUser.ts) —
// the client check is only UX; anything reaching /api/auth is re-validated here.
import { isValidTag } from "./sanitize.js";

// Same pragmatic shape check the admin console uses: something@something.tld.
// Deliverability is proven by the OTP email itself, so anything stricter here
// only rejects real addresses.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!EMAIL_RE.test(trimmed) || trimmed.length > 254) return null;
  return trimmed;
}

/**
 * Normalize a phone number to E.164-ish form: strip separators, require 7-15
 * digits with optional leading +, and default bare 10-digit numbers to +1
 * (all current venues are US). Format check only — nothing is sent to it.
 * @returns {string|null} normalized number, or null if invalid.
 */
export function normalizePhone(phone) {
  if (typeof phone !== "string") return null;
  const stripped = phone.replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]{7,15}$/.test(stripped)) return null;
  if (stripped.startsWith("+")) return stripped;
  if (stripped.length === 10) return `+1${stripped}`;
  return `+${stripped}`;
}

/**
 * Validate the optional profile fields riding along on /api/auth/request-code
 * (and PATCH /api/auth/me). Unknown keys are dropped; absent keys are left
 * undefined so callers can distinguish "not provided" from "clear".
 * @returns {{ error: string } | { row: {phone?, displayName?, defaultTag?} }}
 */
export function normalizeProfile(body) {
  if (body == null) return { row: {} };
  if (typeof body !== "object" || Array.isArray(body)) {
    return { error: "profile must be an object" };
  }
  const row = {};
  if (body.phone !== undefined) {
    if (body.phone === null || body.phone === "") {
      row.phone = null;
    } else {
      const phone = normalizePhone(body.phone);
      if (!phone) return { error: "phone must be a valid number (7-15 digits)" };
      row.phone = phone;
    }
  }
  if (body.displayName !== undefined) {
    if (body.displayName === null || body.displayName === "") {
      row.displayName = null;
    } else {
      if (typeof body.displayName !== "string" || body.displayName.trim().length > 40) {
        return { error: "displayName must be 1-40 characters" };
      }
      const trimmed = body.displayName.trim();
      if (trimmed.length === 0) {
        row.displayName = null;
      } else {
        row.displayName = trimmed;
      }
    }
  }
  if (body.defaultTag !== undefined) {
    if (body.defaultTag === null || body.defaultTag === "") {
      row.defaultTag = null;
    } else {
      if (!isValidTag(body.defaultTag)) {
        return { error: "defaultTag must be 3 characters A-Z 0-9" };
      }
      row.defaultTag = body.defaultTag;
    }
  }
  return { row };
}
