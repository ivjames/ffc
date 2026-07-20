// Build-time feature flags (see .env.example). Only VITE_-prefixed vars reach
// the client bundle.

// Temporary dev chrome: the skin picker (bottom-left palette) and the build
// stamp (bottom-right hash). Both are scaffolding for the current build-out and
// will be removed once the app ships. Gated here so they can be switched off in
// one place — set VITE_SHOW_DEV_CHROME=false — or deleted wholesale later.
// Defaults on, so behavior is unchanged when the var is unset.
export const SHOW_DEV_CHROME = import.meta.env.VITE_SHOW_DEV_CHROME !== 'false';
