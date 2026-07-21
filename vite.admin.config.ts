// Vite config for the Master Control admin SPA — a SEPARATE bundle from the
// player PWA. No vite-plugin-pwa here (no service worker, no offline), and its
// own entry (admin/index.html) so admin code never ships in the player build.
// Output goes to dist-admin/, served on its own vhost (admin.<fqdn>) that
// proxies /api to the same Express backend. See master-control-plan.md §6.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'admin',
  plugins: [react(), tailwindcss()],
  build: {
    // Relative to `root` (admin/), so this lands at repo-root dist-admin/.
    outDir: '../dist-admin',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:8060', changeOrigin: true },
    },
  },
});
