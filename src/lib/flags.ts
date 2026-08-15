// Build-time feature flags (see .env.example). Only VITE_-prefixed vars reach
// the client bundle.

// General dev mode. Gates development-only affordances that ship disabled:
//   - the skin picker (bottom-left palette) and build stamp (bottom-right hash)
//   - the reviewer feedback pill (bottom-right, above the build stamp)
//   - the scorecard/setup "Auto play (test)" buttons
// Add new dev-only UI behind this flag rather than inventing a per-element one.
// Set VITE_DEV_MODE=false to hide all of it in one place. Defaults on, so
// behavior is unchanged when the var is unset.
export const DEV_MODE = import.meta.env.VITE_DEV_MODE !== 'false';

// On-location gate. When ON, food, games, and golf require the device to be
// physically within a venue's geofence (src/lib/presence.ts → GeofenceGate).
// DEFAULTS OFF — the presence requirement is SUSPENDED during testing so it
// never blocks development or demos; set VITE_GEOFENCE_ENFORCED=true to turn it
// on. Opt-IN (=== 'true'), unlike DEV_MODE's opt-out, so an unset var is the
// safe suspended state.
export const GEOFENCE_ENFORCED = import.meta.env.VITE_GEOFENCE_ENFORCED === 'true';
