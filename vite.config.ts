import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const BOOT_PLACEHOLDER = '<!-- boot-script -->';

/**
 * Bundles `src/boot.ts` and inlines it in place of the placeholder in index.html.
 *
 * The boot script must run synchronously before the first paint, so it cannot be a module
 * script (those are deferred). Bundling it from TypeScript, instead of hand-writing inline
 * JavaScript, means it shares the storage format, validation and DOM code with the app, so the
 * two can never drift apart.
 */
function inlineBootScript(entry: string): Plugin {
  return {
    name: 'inline-boot-script',
    async transformIndexHtml(html) {
      if (!html.includes(BOOT_PLACEHOLDER)) {
        throw new Error(`index.html must contain ${BOOT_PLACEHOLDER}`);
      }
      const result = await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: 'iife',
        minify: true,
        target: 'es2020',
        legalComments: 'none',
      });
      const code = (result.outputFiles[0]?.text ?? '').trim().replace(/<\/script/gi, '<\\/script');
      return html.replace(BOOT_PLACEHOLDER, `<script>${code}</script>`);
    },
  };
}

export default defineConfig({
  // Relative asset URLs, so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [inlineBootScript(fileURLToPath(new URL('./src/boot.ts', import.meta.url)))],
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
  },
});
