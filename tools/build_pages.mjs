/**
 * Builds for GitHub Pages (CLAUDE.md §11).
 *
 *   BASE_HREF=/my-repo/ npm run build:pages
 *
 * Project pages live under https://<user>.github.io/<repo>/, so the app needs that base href;
 * everything in the manifest and ngsw is relative, so they follow. Two Pages quirks are handled:
 * `404.html` (a copy of index.html) so deep links like /room/ABC123 reach the router on a cold
 * visit, and `.nojekyll` so files starting with `_` are served.
 *
 * Supabase config: `environment.local.ts` is gitignored, so CI writes it from repository secrets
 * before building (see .github/workflows/pages.yml). Without it rooms fall back to loopback.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const base = process.env['BASE_HREF'] ?? '/';
const outDir = join('dist', 'deckfit', 'browser');
const configuration = process.env['SUPABASE_ENV'] === 'local' ? 'local' : 'production';

console.log(`Building for GitHub Pages (base href ${base}, configuration ${configuration})`);
execFileSync('npx', ['ng', 'build', '--configuration', configuration, '--base-href', base], { stdio: 'inherit' });

copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'));
writeFileSync(join(outDir, '.nojekyll'), '');
console.log(`Done: ${outDir} (index.html copied to 404.html for deep links)`);
