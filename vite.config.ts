import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * GitHub Pages project sites live under `/<repo>/`. The deploy workflow passes the
 * path reported by actions/configure-pages (e.g. "/topps-nfc-kiosk", or "" for a
 * user site) in BASE_PATH; locally we default to the repo name.
 */
function resolveBase(raw: string | undefined): string {
  const trimmed = (raw ?? '/topps-nfc-kiosk/').trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

export default defineConfig({
  base: resolveBase(process.env.BASE_PATH),
  define: {
    // The deploy workflow passes the release number (see deploy.yml); anything
    // built locally is marked as a dev build.
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION?.trim() || `${pkg.version}-dev`),
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'Topps Kiosk',
        short_name: 'Topps Kiosk',
        description: 'Plays a looping video and switches to tag-specific videos on NFC scans.',
        start_url: './',
        scope: './',
        display: 'fullscreen',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell only. config.json is deliberately not matched so "Update from
        // published config" always reaches the network.
        globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'],
        globIgnores: ['**/config.json'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/config\.json$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.endsWith('/config.json'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
