import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';
import vibeVisualEditor, { hAdapter } from '@vibe-visual-editor/vite-plugin';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// The deploy workflow passes the published app's name (see deploy.yml); local
// builds use a generic one.
const appName = process.env.APP_NAME?.trim() || 'Kiosk';

/**
 * GitHub Pages project sites live under `/<repo>/`. The deploy workflow passes the
 * path reported by actions/configure-pages (e.g. "/kiosk-video-nfc-website", or "" for a
 * user site) in BASE_PATH; locally we default to the repo name.
 */
function resolveBase(raw: string | undefined): string {
  const trimmed = (raw ?? '/kiosk-video-nfc-website/').trim().replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? '/' : `/${trimmed}/`;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export default defineConfig({
  base: resolveBase(process.env.BASE_PATH),
  define: {
    // The deploy workflow passes the release number (see deploy.yml); anything
    // built locally is marked as a dev build.
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION?.trim() || `${pkg.version}-dev`),
    __APP_NAME__: JSON.stringify(appName),
  },
  plugins: [
    {
      name: 'app-name',
      transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', escapeHtml(appName)),
    },
    // Dev server only (apply: 'serve'): maps rendered text back to source for the
    // Vibe Visual Editor preview in VS Code. Production builds contain none of it.
    vibeVisualEditor({ adapters: [hAdapter({ factory: 'h', from: '/src/ui/dom.ts' })] }),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: appName,
        short_name: appName,
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
        // Downloads (config.json, the .sh setup scripts), not pages: the fallback
        // would otherwise save index.html under their name.
        navigateFallbackDenylist: [/\/config\.json$/, /\.sh$/],
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
