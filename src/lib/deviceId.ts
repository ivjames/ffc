// A stable per-install identifier for this device/browser, minted once and kept
// in localStorage. It attributes anonymous, offline-first activity (e.g.
// announcement view memory) without forcing a player to sign in — the app is a
// walk-up product, so most viewers never authenticate. This is NOT a security
// token: it's a best-effort "same device" marker the user can reset by clearing
// storage, and the server treats it as untrusted client input.
const DEVICE_ID_KEY = 'ffc_device_id';

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Private mode / storage disabled: return a fresh ephemeral id so the
    // beacon still works this session; it just won't be stable across reloads.
    return crypto.randomUUID();
  }
}
