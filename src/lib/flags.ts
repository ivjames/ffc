// Build-time feature flags (see .env.example). Only VITE_-prefixed vars reach
// the client bundle.

// General dev mode. Gates development-only affordances that ship disabled:
//   - the skin picker (bottom-left palette) and build stamp (bottom-right hash)
//   - the scorecard/setup "Auto play (test)" buttons
// Add new dev-only UI behind this flag rather than inventing a per-element one.
// Set VITE_DEV_MODE=false to hide all of it in one place. Defaults on, so
// behavior is unchanged when the var is unset.
export const DEV_MODE = import.meta.env.VITE_DEV_MODE !== 'false';
