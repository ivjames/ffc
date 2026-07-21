// Self-hosted display fonts for the CSS skins (bundled by Vite — no external
// CDN, so they work offline in the PWA). Latin subset only, to keep the bundle
// small. Each maps to `--theme-font` in index.css (applied to titles/buttons):
// Candy → Baloo 2, Quirky Blocky → Luckiest Guy, UV Party → Orbitron.
import '@fontsource/orbitron/latin-400.css';
import '@fontsource/orbitron/latin-700.css';
import '@fontsource/baloo-2/latin-400.css';
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/luckiest-guy/latin-400.css';
