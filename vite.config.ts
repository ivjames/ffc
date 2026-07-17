import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon-32.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Mini Golf Scorecard',
        short_name: 'MiniGolf',
        description: 'Offline scorecard for four themed 18-hole mini golf courses.',
        theme_color: '#15803d',
        background_color: '#052e16',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell + all bundled assets (maps, icons) so the
        // whole PWA works offline. Course maps/rules ship in the build.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        navigateFallback: '/index.html',
        // Never let the SW intercept API calls — those must hit the network
        // (and fail gracefully to the offline write-queue when down).
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 5173,
    // In dev, proxy /api to the local Node/Express server (see server/).
    proxy: {
      '/api': {
        target: 'http://localhost:8060',
        changeOrigin: true,
      },
    },
  },
});
