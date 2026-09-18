import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// CLAUDE.md §4: domain/ must stay framework-free (runs in tools, tests, and a future worker).
const DOMAIN = join(process.cwd(), 'src/app/domain');
const ALLOWED = [/^zod$/, /^\.{1,2}\//];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('domain layer', () => {
  it('imports only zod and relative modules', () => {
    const offenders = sources(DOMAIN).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g)]
        .map((m) => m[1])
        .filter((spec) => !ALLOWED.some((re) => re.test(spec)))
        .map((spec) => `${relative(DOMAIN, file)} → ${spec}`),
    );
    expect(offenders).toEqual([]);
  });
});
